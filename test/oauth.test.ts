/**
 * One OAuth grant, from the button to the stored token.
 *
 * Nothing here reaches a provider. Every call takes a fetcher, so this drives
 * each answer a provider can give, including the ones a live grant never
 * produces on demand: a refused code, a revoked refresh token, and a revoke
 * endpoint that does not answer.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { after, before, beforeEach, describe, test } from 'node:test';
import type { ClientBase } from 'pg';
import { fingerprint } from '../src/auth/session.ts';
import {
  CALLBACK_PATH,
  GRANTS,
  LIFETIME_MINUTES,
  begin,
  challengeFor,
  claim,
  clientFor,
  exchange,
  grantFor,
  installationUrl,
  redirectUri,
  renew,
  revoke,
  scopesFor,
  sweepExpired,
  whoami,
  type Fetcher,
} from '../src/connections/oauth.ts';
import { connect, refuseProduction } from '../src/db/connect.ts';
import { down, up } from '../src/db/migrate.ts';

const MIGRATIONS = path.join(import.meta.dirname, '..', 'migrations');
const url = process.env['DATABASE_URL_TEST'];

const REDIRECT = `http://localhost:3000${CALLBACK_PATH}`;
/** Every service the Google card offers, which is what the old flat list
 *  asked for on every grant. */
const ALL = ['gmail', 'calendar', 'meet', 'drive', 'keep'];
const NOW = new Date('2026-09-09T00:00:00Z');

/** `minutes` after `NOW`, for a test that has to outlive a grant. */
function later(minutes: number): Date {
  return new Date(NOW.getTime() + minutes * 60 * 1000);
}

/** A fetcher answering one canned body, and recording what it was asked. */
function answers(
  status: number,
  body: unknown,
): { fetcher: Fetcher; asked: { url: string; body: URLSearchParams }[] } {
  const asked: { url: string; body: URLSearchParams }[] = [];
  const fetcher: Fetcher = (where, init) => {
    asked.push({
      url: where,
      body: new URLSearchParams(typeof init.body === 'string' ? init.body : ''),
    });
    return Promise.resolve(
      new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }),
    );
  };
  return { fetcher, asked };
}

describe('an OAuth grant', { skip: url ? false : 'DATABASE_URL_TEST is unset' }, () => {
  let client: ClientBase & { end: () => Promise<void> };

  before(async () => {
    client = connect('DATABASE_URL_TEST');
    await client.connect();
    await refuseProduction(client);
    await down(client, MIGRATIONS);
    await up(client, MIGRATIONS);
    // The suite must not depend on what the developer happens to have set.
    process.env['GOOGLE_OAUTH_CLIENT_ID'] = 'a-client-id.apps.googleusercontent.com';
    process.env['GOOGLE_OAUTH_CLIENT_SECRET'] = 'a-client-secret';
  });

  after(async () => {
    await down(client, MIGRATIONS);
    await client.end();
  });

  beforeEach(async () => {
    await client.query('DELETE FROM oauth_grants');
  });

  describe('the provider record', () => {
    test('every service asks the whole grant asked, and no more', () => {
      // The seven in the Data Access list of the Google console. Every one is
      // reachable, and no eighth exists in the record at all.
      const SEVEN = [
        'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
        'https://www.googleapis.com/auth/calendar.events',
        'https://www.googleapis.com/auth/calendar.events.freebusy',
        'https://www.googleapis.com/auth/drive',
        'https://www.googleapis.com/auth/gmail.modify',
        'https://www.googleapis.com/auth/userinfo.email',
        'openid',
      ].sort();
      const whole = scopesFor(grantFor('google'), ALL);
      assert.deepEqual(whole, SEVEN);

      const record = grantFor('google');
      const everything = new Set([
        ...record.baseScopes,
        ...Object.values(record.scopesByService).flat(),
      ]);
      assert.deepEqual([...everything].sort(), SEVEN, 'the record can ask for an eighth scope');
    });

    test('the address is asked for on every grant, whatever was chosen', () => {
      // It is what tells three Google accounts apart. A grant without it
      // produces one connection nobody can name.
      const email = 'https://www.googleapis.com/auth/userinfo.email';
      assert.ok(scopesFor(grantFor('google'), []).includes(email));
      assert.ok(scopesFor(grantFor('google'), ['gmail']).includes(email));
      assert.ok(scopesFor(grantFor('google'), ALL).includes(email));
    });

    test('mail alone asks for mail alone', () => {
      const mail = scopesFor(grantFor('google'), ['gmail']);
      assert.equal(mail.length, 3, 'two base scopes and one for mail');
      assert.equal(
        mail.some((scope) => scope.includes('/drive')),
        false,
        'choosing mail asked for Drive',
      );
      assert.equal(
        mail.some((scope) => scope.includes('/calendar')),
        false,
        'choosing mail asked for Calendar',
      );
    });

    test('two services sharing a scope ask for it once', () => {
      // Meet is reached through the event that held it, so it and Calendar
      // both name the calendar events scope.
      const both = scopesFor(grantFor('google'), ['calendar', 'meet']);
      assert.equal(new Set(both).size, both.length, 'a scope was asked for twice');
      assert.deepEqual(both, [...both].sort(), 'the list is unsorted, so two equal asks differ');
    });

    test('a service the record does not answer for adds nothing and throws nothing', () => {
      // A card gaining a service must not break the grant for the four beside
      // it. `check-connections.ts` is what catches the gap instead.
      assert.deepEqual(
        scopesFor(grantFor('google'), ['gmail', 'a-service-nobody-mapped']),
        scopesFor(grantFor('google'), ['gmail']),
      );
    });

    test('keep is mapped and empty, rather than missing', () => {
      // Google restricts `keep.readonly` to Workspace Enterprise and
      // workspace-mcp holds none, so asking would fail the whole grant.
      assert.deepEqual(grantFor('google').scopesByService['keep'], []);
    });

    test('google asks for a refresh token, which it returns to nobody who does not', () => {
      assert.equal(grantFor('google').extra['access_type'], 'offline');
      assert.equal(grantFor('google').extra['prompt'], 'consent');
    });

    test('microsoft is absent, because the brief refuses it', () => {
      // All three mailboxes are Google, so the Microsoft surface is customer
      // tenants where Shane is a guest, and the brief rules that out.
      assert.equal(GRANTS['microsoft'], undefined);
      assert.throws(() => grantFor('microsoft'), /no OAuth grant is configured/);
    });

    test('a provider nobody configured throws by name', () => {
      assert.throws(() => grantFor('friendface'), /friendface/);
    });

    test('the redirect is built from SUKKAL_URL and one path', () => {
      // A provider compares this to its console character for character, so
      // the two routes read it from here rather than each building a string.
      const held = process.env['SUKKAL_URL'];
      process.env['SUKKAL_URL'] = 'https://kpa.example/';
      assert.equal(redirectUri(), `https://kpa.example${CALLBACK_PATH}`);
      assert.equal(installationUrl(), 'https://kpa.example', 'a trailing slash survived');

      delete process.env['SUKKAL_URL'];
      assert.equal(redirectUri(), `http://localhost:3000${CALLBACK_PATH}`);

      if (held === undefined) delete process.env['SUKKAL_URL'];
      else process.env['SUKKAL_URL'] = held;
    });

    test('the callback path is what the route file answers at', () => {
      // `apps/web/app/(app)/oauth2/callback/route.ts` is the file. A rename
      // that misses one of the two leaves the provider redirecting to a 404,
      // which reads as the grant failing for no reason anybody can see.
      assert.equal(CALLBACK_PATH, '/oauth2/callback');
    });

    test('the client comes from the environment, and says which variable is missing', () => {
      const google = grantFor('google');
      assert.deepEqual(clientFor(google), {
        id: 'a-client-id.apps.googleusercontent.com',
        secret: 'a-client-secret',
      });

      const held = process.env['GOOGLE_OAUTH_CLIENT_SECRET'];
      delete process.env['GOOGLE_OAUTH_CLIENT_SECRET'];
      assert.throws(() => clientFor(google), /GOOGLE_OAUTH_CLIENT_SECRET/);
      process.env['GOOGLE_OAUTH_CLIENT_SECRET'] = held;
    });
  });

  describe('the challenge', () => {
    test('is the base64url SHA-256 of the verifier, with no padding', () => {
      // RFC 7636 names exactly this. A test computing it a second way is what
      // catches a hex digest or a padded encoding, both of which a provider
      // refuses with a message that names neither.
      const verifier = 'a'.repeat(43);
      const expected = createHash('sha256').update(verifier, 'ascii').digest('base64url');
      assert.equal(challengeFor(verifier), expected);
      assert.equal(challengeFor(verifier).includes('='), false, 'the challenge is padded');
      assert.equal(challengeFor(verifier).length, 43);
    });

    test('differs for two verifiers', () => {
      assert.notEqual(challengeFor('a'.repeat(43)), challengeFor('b'.repeat(43)));
    });
  });

  describe('the start', () => {
    test('builds a url carrying everything the provider needs', async () => {
      const started = await begin(client, 'google', REDIRECT, ALL, NOW);
      const url = new URL(started.url);

      assert.equal(url.origin + url.pathname, grantFor('google').authorize);
      assert.equal(url.searchParams.get('client_id'), 'a-client-id.apps.googleusercontent.com');
      assert.equal(url.searchParams.get('redirect_uri'), REDIRECT);
      assert.equal(url.searchParams.get('response_type'), 'code');
      assert.equal(url.searchParams.get('state'), started.state);
      assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
      assert.equal(url.searchParams.get('access_type'), 'offline');
      assert.equal(url.searchParams.get('prompt'), 'consent');
      assert.deepEqual(
        url.searchParams.get('scope')?.split(' '),
        scopesFor(grantFor('google'), ALL),
      );
    });

    test('the url asks only for what was chosen', async () => {
      const started = await begin(client, 'google', REDIRECT, ['gmail'], NOW);
      const scope = new URL(started.url).searchParams.get('scope') ?? '';
      assert.equal(scope.includes('/auth/drive'), false, 'a mail grant asked for Drive');
      assert.ok(scope.includes('/auth/gmail.modify'));
    });

    test('carries no client secret to the browser', async () => {
      // The authorize url is opened in the browser and lands in history, so
      // the secret may not be on it. The exchange is where it belongs.
      const started = await begin(client, 'google', REDIRECT, ALL, NOW);
      assert.equal(started.url.includes('a-client-secret'), false);
    });

    test('stores the state as a fingerprint and never as the state', async () => {
      const started = await begin(client, 'google', REDIRECT, ALL, NOW);

      const { rows } = await client.query<{ id: string; verifier: string }>(
        'SELECT id, verifier FROM oauth_grants',
      );
      assert.equal(rows.length, 1);
      assert.equal(rows[0]?.id, fingerprint(started.state));
      assert.notEqual(rows[0]?.id, started.state);
      assert.match(rows[0]?.id ?? '', /^[0-9a-f]{64}$/);
    });

    test('stores the verifier as it is, and the url carries only its challenge', async () => {
      const started = await begin(client, 'google', REDIRECT, ALL, NOW);
      const { rows } = await client.query<{ verifier: string }>(
        'SELECT verifier FROM oauth_grants',
      );
      const verifier = rows[0]?.verifier ?? '';

      assert.ok(verifier.length >= 43, 'the verifier is too short for RFC 7636');
      assert.equal(
        new URL(started.url).searchParams.get('code_challenge'),
        challengeFor(verifier),
      );
      assert.equal(started.url.includes(verifier), false, 'the verifier was sent');
    });

    test('lasts ten minutes', async () => {
      const started = await begin(client, 'google', REDIRECT, ALL, NOW);
      assert.equal(
        started.expiresAt.getTime() - NOW.getTime(),
        LIFETIME_MINUTES * 60 * 1000,
      );
      assert.equal(LIFETIME_MINUTES, 10);
    });

    test('two grants never share a state', async () => {
      const first = await begin(client, 'google', REDIRECT, ALL, NOW);
      const second = await begin(client, 'google', REDIRECT, ALL, NOW);
      assert.notEqual(first.state, second.state);

      const { rows } = await client.query('SELECT id FROM oauth_grants');
      assert.equal(rows.length, 2, 'a second grant replaced the first');
    });

    test('a verifier the table would refuse never reaches it', async () => {
      // The constraint is the backstop. This proves the generator clears it,
      // so the check fires on a caller that invents its own rather than on
      // this one.
      await begin(client, 'google', REDIRECT, ALL, NOW);
      // `created_at` is named rather than defaulted. The default is `now()`,
      // which sits years after this suite's fixed clock, so the expiry check
      // would fire first and prove the wrong thing.
      await assert.rejects(
        () =>
          client.query(
            `INSERT INTO oauth_grants (id, provider, verifier, created_at, expires_at)
             VALUES ($1, 'google', 'too-short', $2, $3)`,
            ['0'.repeat(64), NOW, later(10)],
          ),
        /oauth_grants_verifier_is_long_enough/,
      );
    });
  });

  describe('the claim', () => {
    test('returns what was waiting, once', async () => {
      const started = await begin(client, 'google', REDIRECT, ALL, NOW, '/connections');

      const first = await claim(client, started.state, NOW);
      assert.ok(!('refused' in first));
      assert.equal(first.provider, 'google');
      assert.equal(first.returnsTo, '/connections');
      assert.ok(first.verifier.length >= 43);

      const again = await claim(client, started.state, NOW);
      assert.deepEqual(again, { refused: 'unknown' }, 'the state worked twice');
    });

    test('an expired grant is refused, one minute after its ten', async () => {
      const started = await begin(client, 'google', REDIRECT, ALL, NOW);
      assert.deepEqual(
        await claim(client, started.state, later(LIFETIME_MINUTES + 1)),
        { refused: 'expired' },
      );
    });

    test('the last minute still works, and the first minute after does not', async () => {
      const inTime = await begin(client, 'google', REDIRECT, ALL, NOW);
      assert.ok(!('refused' in (await claim(client, inTime.state, later(LIFETIME_MINUTES - 1)))));

      const onTheMinute = await begin(client, 'google', REDIRECT, ALL, NOW);
      assert.deepEqual(
        await claim(client, onTheMinute.state, later(LIFETIME_MINUTES)),
        { refused: 'expired' },
      );
    });

    test('a state nobody issued is refused', async () => {
      assert.deepEqual(await claim(client, 'not-a-state', NOW), { refused: 'unknown' });
      assert.deepEqual(await claim(client, '', NOW), { refused: 'unknown' });
      assert.deepEqual(await claim(client, null, NOW), { refused: 'unknown' });
    });

    test('one grant does not claim another', async () => {
      const mine = await begin(client, 'google', REDIRECT, ALL, NOW);
      const other = await begin(client, 'google', REDIRECT, ALL, NOW);

      await claim(client, mine.state, NOW);
      assert.ok(!('refused' in (await claim(client, other.state, NOW))), 'the wrong row went');
    });
  });

  describe('the exchange', () => {
    const GOOGLE_SAYS = {
      access_token: 'an-access-token',
      refresh_token: 'a-refresh-token',
      expires_in: 3599,
      scope: 'https://www.googleapis.com/auth/gmail.modify openid',
      token_type: 'Bearer',
    };

    test('sends the code, the verifier and the client, and reads the answer', async () => {
      const { fetcher, asked } = answers(200, GOOGLE_SAYS);
      const tokens = await exchange(
        grantFor('google'), 'a-code', 'v'.repeat(43), REDIRECT, NOW, fetcher,
      );

      assert.equal(asked.length, 1);
      assert.equal(asked[0]?.url, grantFor('google').token);
      assert.equal(asked[0]?.body.get('code'), 'a-code');
      assert.equal(asked[0]?.body.get('code_verifier'), 'v'.repeat(43));
      assert.equal(asked[0]?.body.get('grant_type'), 'authorization_code');
      assert.equal(asked[0]?.body.get('redirect_uri'), REDIRECT);
      assert.equal(asked[0]?.body.get('client_secret'), 'a-client-secret');

      assert.equal(tokens.accessToken, 'an-access-token');
      assert.equal(tokens.refreshToken, 'a-refresh-token');
      assert.deepEqual(tokens.scopes, [
        'https://www.googleapis.com/auth/gmail.modify',
        'openid',
      ]);
    });

    test('derives the expiry from the answer, not from a guess', async () => {
      const { fetcher } = answers(200, GOOGLE_SAYS);
      const tokens = await exchange(
        grantFor('google'), 'a-code', 'v'.repeat(43), REDIRECT, NOW, fetcher,
      );
      assert.equal(tokens.expiresAt.getTime(), NOW.getTime() + 3599 * 1000);
    });

    test('a provider naming no lifetime gets an expiry of now, not forever', async () => {
      const { fetcher } = answers(200, { access_token: 'a', token_type: 'Bearer' });
      const tokens = await exchange(
        grantFor('google'), 'a-code', 'v'.repeat(43), REDIRECT, NOW, fetcher,
      );
      assert.equal(tokens.expiresAt.getTime(), NOW.getTime());
      assert.equal(tokens.refreshToken, null);
    });

    test('a refused code throws with the provider’s own words', async () => {
      const { fetcher } = answers(400, {
        error: 'invalid_grant',
        error_description: 'Bad Request',
      });
      await assert.rejects(
        () => exchange(grantFor('google'), 'stale', 'v'.repeat(43), REDIRECT, NOW, fetcher),
        /invalid_grant: Bad Request/,
      );
    });

    test('an answer that is not JSON throws and names the status', async () => {
      const { fetcher } = answers(502, '<html>upstream is down</html>');
      await assert.rejects(
        () => exchange(grantFor('google'), 'a-code', 'v'.repeat(43), REDIRECT, NOW, fetcher),
        /answered 502 and no JSON/,
      );
    });

    test('an answer carrying no access token throws', async () => {
      const { fetcher } = answers(200, { token_type: 'Bearer', expires_in: 3599 });
      await assert.rejects(
        () => exchange(grantFor('google'), 'a-code', 'v'.repeat(43), REDIRECT, NOW, fetcher),
        /without an access token/,
      );
    });
  });

  describe('the renewal', () => {
    test('sends the refresh token and asks for nothing else', async () => {
      const { fetcher, asked } = answers(200, { access_token: 'a-new-one', expires_in: 3599 });
      const tokens = await renew(grantFor('google'), 'a-refresh-token', NOW, fetcher);

      assert.equal(asked[0]?.body.get('grant_type'), 'refresh_token');
      assert.equal(asked[0]?.body.get('refresh_token'), 'a-refresh-token');
      assert.equal(asked[0]?.body.get('code'), null);

      assert.equal(tokens.accessToken, 'a-new-one');
      // Google returns no new refresh token, so the caller keeps the one it
      // holds. Null says that rather than an empty string nobody can store.
      assert.equal(tokens.refreshToken, null);
      assert.equal(tokens.expiresAt.getTime(), NOW.getTime() + 3599 * 1000);
    });

    test('a rotated refresh token comes back, so the caller stores it', async () => {
      const { fetcher } = answers(200, {
        access_token: 'a-new-one',
        refresh_token: 'a-rotated-one',
        expires_in: 3599,
      });
      const tokens = await renew(grantFor('google'), 'the-old-one', NOW, fetcher);
      assert.equal(tokens.refreshToken, 'a-rotated-one');
    });

    test('a revoked refresh token throws with what the provider said', async () => {
      // The answer Google gave for shane.dolley@collibra.com on 9 September
      // 2026, recorded so the message stays the one a person will read.
      const { fetcher } = answers(400, {
        error: 'invalid_grant',
        error_description: 'Token has been expired or revoked.',
      });
      await assert.rejects(
        () => renew(grantFor('google'), 'a-dead-one', NOW, fetcher),
        /Token has been expired or revoked/,
      );
    });
  });

  describe('the revoke', () => {
    test('tells the provider, and says it agreed', async () => {
      const { fetcher, asked } = answers(200, {});
      assert.deepEqual(await revoke(grantFor('google'), 'a-token', fetcher), {
        revoked: true,
        said: 'the provider forgot the token.',
      });
      assert.equal(asked[0]?.url, 'https://oauth2.googleapis.com/revoke');
      assert.equal(asked[0]?.body.get('token'), 'a-token');
    });

    test('a token the provider already refuses counts as revoked', async () => {
      // Google answers 400 `invalid_token` for a token revoked elsewhere or
      // long expired. Reading that as a failure would strand the row: nothing
      // could remove a connection whose token had already died, which is
      // exactly the connection somebody wants rid of.
      const { fetcher } = answers(400, { error: 'invalid_token' });
      const said = await revoke(grantFor('google'), 'a-dead-one', fetcher);
      assert.equal(said.revoked, true);
      assert.match(said.said, /already stopped working/);
    });

    test('a refusal reports itself rather than throwing', async () => {
      // KPA-103 requires a failed revoke to leave the row standing. A throw
      // here would make the caller choose between losing the row and losing
      // the reason.
      const { fetcher } = answers(503, { error: 'backend_error' });
      const said = await revoke(grantFor('google'), 'a-token', fetcher);
      assert.equal(said.revoked, false);
      assert.match(said.said, /answered 503/);
    });

    test('a network failure is not a revoked token', async () => {
      const fetcher: Fetcher = () => Promise.reject(new Error('getaddrinfo ENOTFOUND'));
      const said = await revoke(grantFor('google'), 'a-token', fetcher);
      assert.equal(said.revoked, false);
      assert.match(said.said, /ENOTFOUND/);
    });

    test('a provider with no revoke endpoint says so, and that is not a failure', async () => {
      const { fetcher, asked } = answers(200, {});
      const said = await revoke(
        { ...grantFor('google'), revoke: null }, 'a-token', fetcher,
      );
      assert.equal(said.revoked, false);
      assert.match(said.said, /publishes no revoke endpoint/);
      assert.equal(asked.length, 0, 'it called something anyway');
    });
  });

  describe('who consented', () => {
    test('is the address, read with the token in the header', async () => {
      const { fetcher, asked } = answers(200, {
        sub: '1',
        email: 'shane@koinon.com.au',
        email_verified: true,
      });
      assert.equal(
        await whoami(grantFor('google'), 'an-access-token', fetcher),
        'shane@koinon.com.au',
      );
      assert.equal(asked[0]?.url, 'https://openidconnect.googleapis.com/v1/userinfo');
    });

    test('the token never reaches the url', async () => {
      // A URL reaches the vendor's access log and this project's own.
      const seen: string[] = [];
      const fetcher: Fetcher = (where, init) => {
        seen.push(where);
        assert.equal(
          (init.headers as Record<string, string>)['authorization'],
          'Bearer an-access-token',
        );
        return Promise.resolve(new Response(JSON.stringify({ email: 'a@b.co' }), { status: 200 }));
      };
      await whoami(grantFor('google'), 'an-access-token', fetcher);
      assert.equal(seen[0]?.includes('an-access-token'), false);
    });

    test('an answer naming no account throws', async () => {
      const { fetcher } = answers(200, { sub: '1' });
      await assert.rejects(
        () => whoami(grantFor('google'), 'a-token', fetcher),
        /carried no email/,
      );
    });

    test('a refused read throws and names the status', async () => {
      const { fetcher } = answers(401, { error: 'invalid_token' });
      await assert.rejects(
        () => whoami(grantFor('google'), 'a-token', fetcher),
        /answered 401 and named no account/,
      );
    });
  });

  test('the sweep clears what has run out and leaves what has not', async () => {
    await begin(client, 'google', REDIRECT, ALL, NOW);
    assert.equal(await sweepExpired(client, later(LIFETIME_MINUTES - 1)), 0);
    assert.equal(await sweepExpired(client, later(LIFETIME_MINUTES + 1)), 1);
    assert.equal(await sweepExpired(client, later(LIFETIME_MINUTES + 1)), 0);
  });
});
