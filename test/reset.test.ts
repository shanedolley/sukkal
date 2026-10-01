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
  fromHeader,
  issueFor,
  mailSender,
  request,
  setPassword,
  spend,
} from '../src/auth/reset.ts';
import { fingerprint, issue, read } from '../src/auth/session.ts';
import { KEY_VARIABLE } from '../src/connections/crypto.ts';
import { addConnection, renameConnection, setCredential } from '../src/connections/store.ts';
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

/** The address the card sends from, which KPA-158 moved out of the name. It is
 *  not the owner's address, so the mail can be searched for that. */
const FROM = 'no-reply@sukkal.app';

/** The name beside it, which is the display name recipients read. Shane typed
 *  exactly this on 1 October 2026, and KPA-143 would have sent it as the whole
 *  `from`, which Resend refuses. */
const DISPLAY = 'Sukkal Resend';

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

  /** A Resend card holding a sealed key, named the way a person names one and
   *  carrying the address in its own field. `name` takes an override, because
   *  the name is what reaches a mail header and the header is the boundary. */
  async function resendCard(name = DISPLAY, sendFrom: string | null = FROM): Promise<string> {
    const id = await addConnection(client, {
      provider: 'resend',
      name,
      method: 'key',
      sendFrom,
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
    // The two fields come back apart, which is the whole of KPA-158.
    assert.equal(sender?.name, DISPLAY);
    assert.equal(sender?.sendFrom, FROM);
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
      // The card's two fields, in one header: the display name quoted, then
      // the address it actually sends from. KPA-143 put the name here alone
      // and Resend would have refused it.
      assert.equal(mail.from, `"${DISPLAY}" <${FROM}>`);
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

  // ── The from header. KPA-158. ──────────────────────────────────────────────
  //
  // The display name comes out of a column somebody typed into and goes into a
  // mail header, so it is a trust boundary. A carriage return or a line feed in
  // it would end the `from` line and start one the typist chose, which is
  // header injection and the one failure here that matters.

  test('the display name is quoted, and a quote and a backslash are escaped', () => {
    assert.equal(fromHeader('Sukkal Resend', FROM), `"Sukkal Resend" <${FROM}>`);
    // A comma and a colon are ordinary inside a quoted-string, so neither is
    // escaped and neither splits the header into two addresses.
    assert.equal(fromHeader('Koinon, Sukkal: mail', FROM), `"Koinon, Sukkal: mail" <${FROM}>`);
    // The two that would end the string or escape what follows it.
    assert.equal(fromHeader('He said "hi"', FROM), `"He said \\"hi\\"" <${FROM}>`);
    assert.equal(fromHeader('back\\slash', FROM), `"back\\\\slash" <${FROM}>`);
  });

  test('a newline in the display name never reaches the header', () => {
    // The injection itself: a second header, smuggled through the name.
    const crafted = 'Sukkal\r\nBcc: them@example.com';
    assert.equal(
      fromHeader(crafted, FROM),
      FROM,
      'a crafted name reached the header rather than being dropped for the bare address',
    );
    // Dropped rather than stripped, so no part of what was crafted survives.
    for (const name of [crafted, 'Sukkal\nBcc: them@example.com', 'Sukkal\rX', 'a\tb']) {
      const header = fromHeader(name, FROM);
      assert.ok(!/[\r\n]/.test(header), `${JSON.stringify(name)} put a newline in the header`);
      assert.ok(
        !header.includes('Bcc'),
        `${JSON.stringify(name)} left its crafted header behind: ${header}`,
      );
      assert.equal(header, FROM, `${JSON.stringify(name)} was stripped rather than dropped`);
    }
  });

  test('no hostile display name survives into the header', () => {
    // Written after attacking fromHeader with 24 names on 1 October 2026, which
    // found U+2028 and U+2029 passing a check that named only `Cc`. Neither
    // could ever have ended a header, since a header ends at CR or LF, but a
    // line separator belongs in no display name. Every separator is built from
    // its code point, because writing a real U+2028 into a regex breaks the
    // file that holds it.
    const CR = String.fromCharCode(13);
    const LF = String.fromCharCode(10);
    const SEPARATORS = [CR, LF, String.fromCharCode(0x85), String.fromCharCode(0x2028), String.fromCharCode(0x2029)];

    const hostile = [
      `Sukkal${CR}${LF}Bcc: them@example.com`,
      `${CR}${LF}Bcc: them@example.com`,
      `Sukkal${CR}${LF}${CR}${LF}Injected body`,
      `Sukkal${String.fromCharCode(0)}Resend`,
      `Sukkal${String.fromCharCode(11)}Resend`,
      `Sukkal${String.fromCharCode(12)}Resend`,
      `Sukkal${String.fromCharCode(0x85)}Bcc: x@example.com`,
      `Sukkal${String.fromCharCode(0x2028)}Bcc: x@example.com`,
      `Sukkal${String.fromCharCode(0x2029)}Bcc: x@example.com`,
    ];

    for (const name of hostile) {
      const header = fromHeader(name, FROM);
      for (const separator of SEPARATORS) {
        assert.ok(
          !header.includes(separator),
          `${JSON.stringify(name)} put a separator in the header: ${JSON.stringify(header)}`,
        );
      }
      assert.equal(header, FROM, `${JSON.stringify(name)} was not dropped for the bare address`);
    }

    // A name that is merely awkward is kept, quoted and escaped. Dropping these
    // would be the other failure: a header with no name where one was asked for.
    for (const name of ['Evil <attacker@example.com>', 'Bcc: them@example.com', 'a, b; c']) {
      const header = fromHeader(name, FROM);
      assert.ok(header.endsWith(`<${FROM}>`), `${JSON.stringify(name)} lost its address`);
      assert.ok(header.startsWith('"'), `${JSON.stringify(name)} was not quoted`);
      // One balanced quoted-string, so nothing broke out of the quotes.
      assert.equal(
        (header.match(/(?<!\\)"/g) ?? []).length % 2,
        0,
        `${JSON.stringify(name)} left the quotes unbalanced: ${header}`,
      );
    }
  });

  test('no name at all is the bare address rather than an empty pair', () => {
    assert.equal(fromHeader(null, FROM), FROM);
    assert.equal(fromHeader('', FROM), FROM);
    assert.equal(fromHeader('   ', FROM), FROM);
    // Spaces around a real name are trimmed and the name is kept.
    assert.equal(fromHeader('  Sukkal Resend  ', FROM), `"Sukkal Resend" <${FROM}>`);
  });

  test('a card whose name holds a newline sends from the bare address', async () => {
    // `connections_every_field_says_something` only refuses a blank name, and
    // btrim does not strip a carriage return, so this row is storable. The row
    // is the realistic route to the header, which is why this runs through one
    // rather than through `fromHeader` alone.
    await resendCard('Sukkal\r\nBcc: them@example.com', FROM);
    const { fetcher, seen } = answering(200);
    const sent = await deliver(client, EMAIL, TOKEN, fetcher);

    // A missing name is not a failure: there is still an address to send from.
    assert.equal(sent.ok, true, sent.log);
    const mail = message(seen[0]?.init);
    assert.equal(mail.from, FROM, 'a crafted display name reached the from header');
    assert.ok(!mail.from.includes('Bcc'), `the header carried a second one: ${mail.from}`);
  });

  // KPA-162. Renaming the card the mail is sent from is the one way the
  // header anybody reads can change, so the rename has to reach it rather
  // than stopping at the row.
  test('a renamed Resend card changes what the From header reads', async () => {
    const id = await resendCard(DISPLAY, FROM);

    const before = await mailSender(client);
    assert.ok(before);
    const headerBefore = fromHeader(before.name, FROM);
    assert.equal(headerBefore, fromHeader(DISPLAY, FROM));

    await renameConnection(client, id, 'Koinon Resend');

    const after = await mailSender(client);
    assert.ok(after);
    const headerAfter = fromHeader(after.name, FROM);
    assert.equal(headerAfter, fromHeader('Koinon Resend', FROM));
    assert.notEqual(headerAfter, headerBefore, 'the rename did not change the From header');
    // Still one quoted-string and one address, escaped the same way as before.
    assert.equal(headerAfter, `"Koinon Resend" <${FROM}>`);
  });

  test('a Resend card with no address sends nothing and says so', async () => {
    // The row `sukkal_local` already holds: a card written before migration 032
    // gave the address a column. Migration 032 leaves it null rather than
    // failing on it, so this is the state the route and this path refuse.
    await resendCard(DISPLAY, null);
    const { fetcher, seen } = answering(200);
    const sent = await deliver(client, EMAIL, TOKEN, fetcher);

    // Unlike a missing name, a missing address is a failure: there is nothing
    // to put in `from`, so the vendor is never reached.
    assert.equal(sent.ok, false, 'a card with no address read as a send');
    assert.match(sent.log, /no Send from address/);
    assert.match(sent.log, /reset-password\.sh --link/);
    assert.equal(seen.length, 0, 'a message was sent with nothing in from');
  });

  test('no log line carries the token or the key, on any path', async () => {
    await resendCard();
    for (const status of [200, 401, 422, 429, 500]) {
      const sent = await deliver(client, EMAIL, TOKEN, answering(status).fetcher);
      assert.ok(!sent.log.includes(TOKEN), `${String(status)} logged the token`);
      assert.ok(!sent.log.includes(RESEND_KEY), `${String(status)} logged the key`);
    }
  });

  // ── The log line. KPA-161. ─────────────────────────────────────────────────
  //
  // KPA-162 made the connection's name a box a person types into, so a name
  // reaching one of the four log lines below is no longer one a provider
  // reported. Each case drives a different one of the four, and each holds a
  // different separator `fromHeader` already refuses in the header.

  /** No `\r`, `\n`, U+2028 or U+2029 anywhere in `log`, and the name is still
   *  readable in it. */
  function assertOneLine(log: string, nameFragment: string): void {
    assert.ok(!/[\r\n\u2028\u2029]/.test(log), `the log held a line break: ${JSON.stringify(log)}`);
    assert.ok(log.includes(nameFragment), `the log lost the name: ${JSON.stringify(log)}`);
  }

  test('a newline in a non-Resend connection name writes one log line', async () => {
    const id = await addConnection(client, {
      provider: 'google',
      name: 'Koinon Google\nBcc: them@example.com',
      method: 'oauth',
      services: ['gmail'],
    });
    await setCredential(client, id, 'a-refresh-token-shaped-string');

    const sent = await deliver(client, EMAIL, TOKEN, answering(200).fetcher);
    assertOneLine(sent.log, 'Koinon Google');
  });

  test('a carriage return in a Resend card with no address writes one log line', async () => {
    await resendCard('Sukkal Resend\rsecond line', null);

    const sent = await deliver(client, EMAIL, TOKEN, answering(200).fetcher);
    assertOneLine(sent.log, 'Sukkal Resend');
  });

  test('U+2028 in a card whose key will not open writes one log line', async () => {
    const id = await resendCard(`Sukkal Resend${String.fromCharCode(0x2028)}second line`);
    await client.query(
      `UPDATE connection_credentials
          SET ciphertext = set_byte(ciphertext, 40, get_byte(ciphertext, 40) # 1)
        WHERE connection = $1`,
      [id],
    );

    const sent = await deliver(client, EMAIL, TOKEN, answering(200).fetcher);
    assertOneLine(sent.log, 'Sukkal Resend');
  });

  test('U+2029 in a card whose credential vanished writes one log line', async () => {
    await resendCard(`Sukkal Resend${String.fromCharCode(0x2029)}second line`);

    // `mailSender` already joined the credential by the time `secretFor` asks
    // for it again, so the row has to go missing in between to reach the
    // branch `deliver`'s own comment names, rather than a card left half
    // filled in. The same stand-in client `test/gates.test.ts` uses makes
    // that window.
    const real = client.query.bind(client);
    const racing = Object.create(client) as ClientBase;
    racing.query = (async (text: unknown, ...rest: unknown[]) => {
      if (typeof text === 'string' && text.startsWith('SELECT ciphertext')) {
        await client.query('DELETE FROM connection_credentials');
      }
      return (real as (...args: unknown[]) => unknown)(text, ...rest);
    }) as ClientBase['query'];

    const sent = await deliver(racing, EMAIL, TOKEN, answering(200).fetcher);
    assertOneLine(sent.log, 'Sukkal Resend');
  });
});
