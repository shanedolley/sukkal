/**
 * Resetting a forgotten password.
 *
 * The three KPA-79 asks for are here by name: a used token fails, an expired
 * one fails, and a reset ends a session that was open. `now` is an argument to
 * every call, so an hour passes in one line and no test waits for a clock.
 */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { after, before, beforeEach, describe, test } from 'node:test';
import type { ClientBase } from 'pg';
import { hash, verify } from '../src/auth/password.ts';
import {
  LIFETIME_MINUTES,
  deliver,
  issueFor,
  mailSender,
  request,
  setPassword,
  spend,
} from '../src/auth/reset.ts';
import { fingerprint, issue, read } from '../src/auth/session.ts';
import { KEY_VARIABLE } from '../src/connections/crypto.ts';
import { addConnection, setCredential } from '../src/connections/store.ts';
import { connect, refuseProduction } from '../src/db/connect.ts';
import { down, up } from '../src/db/migrate.ts';

const MIGRATIONS = path.join(import.meta.dirname, '..', 'migrations');
const url = process.env['DATABASE_URL_TEST'];

/** The seeded owner, from migration 001. */
const OWNER = '1';
const EMAIL = 'shane@koinon.com.au';
const OLD = 'The-Old-Password9!!';
const NEW = 'A-Whole-New-Password9!';
const NOW = new Date('2026-09-03T00:00:00Z');

/** `minutes` after `NOW`, for a test that has to outlive a token. */
function later(minutes: number): Date {
  return new Date(NOW.getTime() + minutes * 60 * 1000);
}

/** The token the send tests hand `deliver`. Its shape is what `issueFor` mints
 *  and its value is nobody's: every log line is searched for it. */
const TOKEN = 'a-token-shaped-string-nobody-holds';

/** The Resend key the send tests seal. Every log line is searched for it too. */
const RESEND_KEY = 're_a-key-shaped-string';

/** What the card sends as, which is the connection's name. It is not the
 *  owner's address, so the mail can be searched for that. */
const FROM = 'no-reply@sukkal.app';

describe('a password reset', { skip: url ? false : 'DATABASE_URL_TEST is unset' }, () => {
  let client: ClientBase & { end: () => Promise<void> };
  let heldSealKey: string | undefined;

  before(async () => {
    client = connect('DATABASE_URL_TEST');
    await client.connect();
    await refuseProduction(client);
    await down(client, MIGRATIONS);
    await up(client, MIGRATIONS);
    // A key made here and thrown away, so the send tests can seal a Resend
    // key and `deliver` can open it. No key ever enters this repository.
    heldSealKey = process.env[KEY_VARIABLE];
    process.env[KEY_VARIABLE] = randomBytes(32).toString('base64');
  });

  after(async () => {
    await down(client, MIGRATIONS);
    await client.end();
    if (heldSealKey === undefined) delete process.env[KEY_VARIABLE];
    else process.env[KEY_VARIABLE] = heldSealKey;
  });

  beforeEach(async () => {
    await client.query('DELETE FROM password_resets');
    await client.query('DELETE FROM sessions');
    // The credential goes with it, by the cascade migration 020 declares.
    await client.query('DELETE FROM connections');
    // An account, so `request` has an address to find. The four columns move
    // together, because `users_the_account_is_whole` refuses a subset.
    await client.query(
      `UPDATE users
          SET name = 'Shane Dolley', email = $2, assistant_name = 'Kestrel',
              password_hash = $3, created_at = now()
        WHERE id = $1`,
      [OWNER, EMAIL, await hash(OLD)],
    );
  });

  test('the row holds a fingerprint and never the token', async () => {
    const issued = await issueFor(client, OWNER, NOW);

    const { rows } = await client.query<{ id: string }>('SELECT id FROM password_resets');
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.id, fingerprint(issued.token));
    assert.notEqual(rows[0]?.id, issued.token);
    assert.match(rows[0]?.id ?? '', /^[0-9a-f]{64}$/);
  });

  test('it lasts an hour, and the hour is the one the screen promises', async () => {
    const issued = await issueFor(client, OWNER, NOW);
    assert.equal(issued.expiresAt.getTime() - NOW.getTime(), LIFETIME_MINUTES * 60 * 1000);
    assert.equal(LIFETIME_MINUTES, 60);
  });

  test('an address nobody holds issues nothing, and says so as null', async () => {
    const issued = await request(client, 'nobody@evil.example', NOW);
    assert.equal(issued, null);

    const { rows } = await client.query('SELECT id FROM password_resets');
    assert.equal(rows.length, 0, 'a stranger left a row behind');
  });

  test('a capital letter reaches the same account it signs in', async () => {
    const issued = await request(client, 'Shane@Koinon.COM.AU', NOW);
    assert.notEqual(issued, null);
    assert.equal(issued?.ownerId, OWNER);
  });

  test('asking twice leaves one live token, and the first one stops working', async () => {
    const first = await issueFor(client, OWNER, NOW);
    const second = await issueFor(client, OWNER, NOW);

    const { rows } = await client.query('SELECT id FROM password_resets');
    assert.equal(rows.length, 1, 'two keys were left under the mat');

    const stale = await spend(client, first.token, NEW, NOW);
    assert.deepEqual(stale, { refused: 'unknown' });

    const fresh = await spend(client, second.token, NEW, NOW);
    assert.deepEqual(fresh, { ownerId: OWNER });
  });

  test('a token works once, and the second use fails', async () => {
    const issued = await issueFor(client, OWNER, NOW);

    const first = await spend(client, issued.token, NEW, NOW);
    assert.deepEqual(first, { ownerId: OWNER }, 'the first use was refused');

    const again = await spend(client, issued.token, 'A-Third-Password9!!', NOW);
    assert.deepEqual(again, { refused: 'unknown' }, 'the token worked twice');

    // The second attempt changed nothing, so the password is still the one the
    // first attempt set.
    const { rows } = await client.query<{ password_hash: string }>(
      'SELECT password_hash FROM users WHERE id = $1',
      [OWNER],
    );
    assert.equal(await verify(NEW, rows[0]?.password_hash ?? null), true);
  });

  test('an expired token fails, one minute after its hour', async () => {
    const issued = await issueFor(client, OWNER, NOW);

    const late = await spend(client, issued.token, NEW, later(LIFETIME_MINUTES + 1));
    assert.deepEqual(late, { refused: 'expired' });

    // The old password still stands, because nothing was written.
    const { rows } = await client.query<{ password_hash: string }>(
      'SELECT password_hash FROM users WHERE id = $1',
      [OWNER],
    );
    assert.equal(await verify(OLD, rows[0]?.password_hash ?? null), true);
  });

  test('the last minute still works, and the first minute after does not', async () => {
    const inTime = await issueFor(client, OWNER, NOW);
    assert.deepEqual(
      await spend(client, inTime.token, NEW, later(LIFETIME_MINUTES - 1)),
      { ownerId: OWNER },
    );

    const onTheHour = await issueFor(client, OWNER, NOW);
    assert.deepEqual(
      await spend(client, onTheHour.token, NEW, later(LIFETIME_MINUTES)),
      { refused: 'expired' },
      'a token that expires at the hour worked at the hour',
    );
  });

  test('a token nobody issued fails', async () => {
    assert.deepEqual(await spend(client, 'not-a-token', NEW, NOW), { refused: 'unknown' });
    assert.deepEqual(await spend(client, '', NEW, NOW), { refused: 'unknown' });
  });

  test('a reset ends a session that was open', async () => {
    const open = await issue(client, OWNER, NOW);
    assert.notEqual(await read(client, open.token, NOW), null, 'the session never opened');

    const issued = await issueFor(client, OWNER, NOW);
    await spend(client, issued.token, NEW, NOW);

    assert.equal(
      await read(client, open.token, NOW),
      null,
      'the browser that was signed in stayed signed in',
    );
    const { rows } = await client.query('SELECT id FROM sessions');
    assert.equal(rows.length, 0, 'a session survived the reset');
  });

  test('the new password signs in and the old one does not', async () => {
    const issued = await issueFor(client, OWNER, NOW);
    await spend(client, issued.token, NEW, NOW);

    const { rows } = await client.query<{ password_hash: string }>(
      'SELECT password_hash FROM users WHERE id = $1',
      [OWNER],
    );
    const stored = rows[0]?.password_hash ?? null;
    assert.equal(await verify(NEW, stored), true, 'the new password was refused');
    assert.equal(await verify(OLD, stored), false, 'the old password still works');
  });

  test('the command line sets a password with no token at all', async () => {
    // What `scripts/reset-password.sh` does. It answers how many sessions it
    // closed, which is the number the command prints.
    const open = await issue(client, OWNER, NOW);
    const ended = await setPassword(client, OWNER, NEW);

    assert.equal(ended, 1);
    assert.equal(await read(client, open.token, NOW), null);
    const { rows } = await client.query<{ password_hash: string }>(
      'SELECT password_hash FROM users WHERE id = $1',
      [OWNER],
    );
    assert.equal(await verify(NEW, rows[0]?.password_hash ?? null), true);
  });

  test('one row per owner is what the table holds, so nothing accumulates', async () => {
    // Why there is no sweep. `issueFor` deletes before it inserts and the
    // constraint makes that true rather than remembered, so an expired row is
    // replaced by the next request rather than piling up beside it.
    await issueFor(client, OWNER, NOW);
    await issueFor(client, OWNER, later(LIFETIME_MINUTES + 1));
    await issueFor(client, OWNER, later(LIFETIME_MINUTES * 2));

    const { rows } = await client.query('SELECT id FROM password_resets');
    assert.equal(rows.length, 1);
  });

  test('removing the account takes its outstanding token', async () => {
    await issueFor(client, OWNER, NOW);
    await client.query('DELETE FROM users WHERE id = $1', [OWNER]);

    const { rows } = await client.query('SELECT id FROM password_resets');
    assert.equal(rows.length, 0, 'a token outlived the account it opened');
  });

  test('no mail sender is the ordinary answer on a fresh installation', async () => {
    assert.equal(await mailSender(client), null);
  });

  test('a Gmail connection holding a secret is the sender', async () => {
    const added = await client.query<{ id: string }>(
      `INSERT INTO connections (provider, name, method, services)
       VALUES ('google', 'Koinon Google', 'oauth', ARRAY['gmail','calendar'])
       RETURNING id::text AS id`,
    );
    const id = added.rows[0]?.id;
    assert.ok(id);

    // A connection with no credential is a card somebody started filling in,
    // so it cannot carry the mail.
    assert.equal(await mailSender(client), null, 'a connection with no secret was chosen');

    await client.query(
      `INSERT INTO connection_credentials (connection, ciphertext) VALUES ($1, $2)`,
      [id, Buffer.from('sealed bytes stand in for a real one')],
    );

    const sender = await mailSender(client);
    assert.equal(sender?.id, id);
    assert.equal(sender?.provider, 'google');

    await client.query('DELETE FROM connections WHERE id = $1', [id]);
  });

  test('a connection that carries no mail is never the sender', async () => {
    const added = await client.query<{ id: string }>(
      `INSERT INTO connections (provider, name, method, services)
       VALUES ('google', 'Drive only', 'oauth', ARRAY['drive'])
       RETURNING id::text AS id`,
    );
    const id = added.rows[0]?.id;
    assert.ok(id);
    await client.query(
      `INSERT INTO connection_credentials (connection, ciphertext) VALUES ($1, $2)`,
      [id, Buffer.from('sealed bytes stand in for a real one')],
    );

    assert.equal(await mailSender(client), null, 'a Drive connection was asked to send mail');

    await client.query('DELETE FROM connections WHERE id = $1', [id]);
  });

  // ── Sending it. KPA-143. ───────────────────────────────────────────────────
  //
  // Nothing here reaches Resend. `deliver` takes its fetcher as an argument,
  // the way `src/connections/verify.ts` does, so every answer the vendor can
  // give is driven from here and a real send needs a real key nobody has.

  /** A fetcher answering one status, and recording what it was handed. */
  function answering(status: number): {
    fetcher: typeof fetch;
    seen: { url: string; init: RequestInit | undefined }[];
  } {
    const seen: { url: string; init: RequestInit | undefined }[] = [];
    const fetcher = ((target: string, init?: RequestInit) => {
      seen.push({ url: target, init });
      return Promise.resolve(new Response('{"id":"1"}', { status }));
    }) as unknown as typeof fetch;
    return { fetcher, seen };
  }

  /** A Resend card holding a sealed key, named after the address it sends as. */
  async function resendCard(): Promise<string> {
    const id = await addConnection(client, {
      provider: 'resend',
      name: FROM,
      method: 'key',
    });
    await setCredential(client, id, RESEND_KEY);
    return id;
  }

  /** A Gmail card holding a credential, which is a sender that cannot send. */
  async function gmailCard(): Promise<string> {
    const id = await addConnection(client, {
      provider: 'google',
      name: 'Koinon Google',
      method: 'oauth',
      services: ['gmail'],
    });
    await setCredential(client, id, 'a-refresh-token-shaped-string');
    return id;
  }

  /** What the message carried, from the one request the fetcher recorded. */
  function message(init: RequestInit | undefined): {
    from: string;
    to: string[];
    subject: string;
    html: string;
  } {
    return JSON.parse(String(init?.body)) as {
      from: string;
      to: string[];
      subject: string;
      html: string;
    };
  }

  /** Runs `body` with `SUKKAL_URL` set, and puts back whatever was there. */
  async function at(value: string, body: () => Promise<void>): Promise<void> {
    const held = process.env['SUKKAL_URL'];
    process.env['SUKKAL_URL'] = value;
    try {
      await body();
    } finally {
      if (held === undefined) delete process.env['SUKKAL_URL'];
      else process.env['SUKKAL_URL'] = held;
    }
  }

  test('Resend outranks Gmail, because it is the only one that sends', async () => {
    // The Gmail card is made first, so `created_at` alone would choose it and
    // the link would go nowhere. Reaching Gmail needs the OAuth mail scopes
    // KPA-103 and KPA-105 carry, and neither has landed.
    await gmailCard();
    const resend = await resendCard();

    const sender = await mailSender(client);
    assert.equal(sender?.provider, 'resend', 'a sender that cannot send was chosen');
    assert.equal(sender?.id, resend);
  });

  test('a box with no sender answers as it did, and reaches no vendor', async () => {
    const { fetcher, seen } = answering(200);
    const sent = await deliver(client, EMAIL, TOKEN, fetcher);

    assert.equal(sent.ok, true, 'a fresh installation read as a failure');
    assert.equal(seen.length, 0, 'a box with nothing configured reached a vendor');
    assert.match(sent.log, /reset-password\.sh --link/);
  });

  test('a Gmail sender is named and nothing is sent', async () => {
    await gmailCard();
    const { fetcher, seen } = answering(200);
    const sent = await deliver(client, EMAIL, TOKEN, fetcher);

    assert.equal(sent.ok, true);
    assert.equal(seen.length, 0, 'a Google connection was asked to carry the mail');
    assert.match(sent.log, /nothing sends through google yet/);
  });

  test('the link goes to Resend, under the key sealed against the card', async () => {
    await resendCard();
    const { fetcher, seen } = answering(200);

    await at('https://kpa.example/', async () => {
      const sent = await deliver(client, EMAIL, TOKEN, fetcher);
      assert.equal(sent.ok, true, sent.log);
      assert.equal(seen.length, 1);
      assert.equal(seen[0]?.url, 'https://api.resend.com/emails');
      assert.equal(seen[0]?.init?.method, 'POST');

      const headers = seen[0]?.init?.headers as Record<string, string>;
      assert.equal(headers['authorization'], `Bearer ${RESEND_KEY}`);
      // The key goes in a header and never in the url, which reaches the
      // vendor's access log and this project's own.
      assert.ok(!(seen[0]?.url ?? '').includes(RESEND_KEY));

      const mail = message(seen[0]?.init);
      // The connection's name is the address it sends as, the way a Google
      // card is named after the account that consented.
      assert.equal(mail.from, FROM);
      assert.deepEqual(mail.to, [EMAIL]);
      // Configured rather than guessed, and the trailing slash is dropped.
      assert.ok(
        mail.html.includes(`https://kpa.example/reset?token=${TOKEN}`),
        `the mail carried no link this box issued: ${mail.html}`,
      );
    });
  });

  test('the mail carries the link and nothing else about the account', async () => {
    // A reset mail naming the owner confirms the address to whoever received
    // it, and whoever received it is not always the owner: the address may
    // have been typed wrong, or the mailbox shared.
    await resendCard();
    const { fetcher, seen } = answering(200);
    await deliver(client, EMAIL, TOKEN, fetcher);

    const mail = message(seen[0]?.init);
    const shown = `${mail.subject} ${mail.html}`;
    assert.ok(!shown.includes(EMAIL), 'the mail named the address');
    assert.ok(!/shane/i.test(shown), 'the mail named the owner');
    assert.ok(!/kestrel/i.test(shown), 'the mail named the assistant');
  });

  test('a refused key is a log line, not a throw and not a different answer', async () => {
    await resendCard();
    const { fetcher } = answering(401);
    const sent = await deliver(client, EMAIL, TOKEN, fetcher);

    assert.equal(sent.ok, false);
    assert.match(sent.log, /401/);
    assert.match(sent.log, /reset-password\.sh --link/);
  });

  test('a vendor that cannot be reached is a log line rather than a throw', async () => {
    await resendCard();
    const failing = (() =>
      Promise.reject(new Error('getaddrinfo ENOTFOUND'))) as unknown as typeof fetch;
    const sent = await deliver(client, EMAIL, TOKEN, failing);

    assert.equal(sent.ok, false);
    assert.match(sent.log, /could not be reached/);
  });

  test('sealed bytes that will not open are a log line rather than a throw', async () => {
    const id = await resendCard();
    // One byte changed, which is what a tampered row and a rotated key both
    // look like from here.
    await client.query(
      `UPDATE connection_credentials
          SET ciphertext = set_byte(ciphertext, 40, get_byte(ciphertext, 40) # 1)
        WHERE connection = $1`,
      [id],
    );

    const { fetcher, seen } = answering(200);
    const sent = await deliver(client, EMAIL, TOKEN, fetcher);

    assert.equal(sent.ok, false);
    assert.match(sent.log, /will not open/);
    assert.equal(seen.length, 0, 'a message was sent with a key that would not open');
  });

  test('no log line carries the token or the key, on any path', async () => {
    await resendCard();
    for (const status of [200, 401, 422, 429, 500]) {
      const sent = await deliver(client, EMAIL, TOKEN, answering(status).fetcher);
      assert.ok(!sent.log.includes(TOKEN), `${String(status)} logged the token`);
      assert.ok(!sent.log.includes(RESEND_KEY), `${String(status)} logged the key`);
    }
  });
});
