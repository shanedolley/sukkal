/**
 * The live inference: the subscription through the CLI, the API key as the
 * fallback, and the rule that the subscription token travels in one place.
 * ADR-0027. KPA-86.
 *
 * No test here reaches Anthropic. The CLI is a fake runner or a fake script
 * run as a real child, and Anthropic's API is a fake fetcher. The first real
 * call is the live proof recorded in the story.
 */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { after, afterEach, before, beforeEach, describe, mock, test } from 'node:test';
import type { ClientBase } from 'pg';

import { KEY_VARIABLE } from '../src/connections/crypto.ts';
import { recheck } from '../src/connections/recheck.ts';
import { addConnection, listConnections, setCredential } from '../src/connections/store.ts';
import { verifySubscription } from '../src/connections/verify.ts';
import { connect, refuseProduction } from '../src/db/connect.ts';
import { down, up } from '../src/db/migrate.ts';
import {
  type Child,
  MODEL,
  NOTHING_STORED,
  type Path,
  type Runner,
  InferenceError,
  kindOf,
  live,
  preference,
  spawnChild,
  storedSecret,
  viaCli,
  viaMessages,
} from '../src/memory/inference-live.ts';

const MIGRATIONS = path.join(import.meta.dirname, '..', 'migrations');
const FAKE_CLAUDE = path.join(import.meta.dirname, 'fixtures', 'fake-claude.ts');
const url = process.env['DATABASE_URL_TEST'];

const TOKEN = 'sk-ant-oat01-SUBSCRIPTION-TOKEN-that-must-not-leak';
const API_KEY = 'sk-ant-api03-API-KEY-that-must-not-leak';
const PROMPT = 'Is this still true in a month? candidate: the office is in Sydney.';

const reply = (result: string): Child => ({
  code: 0,
  stdout: JSON.stringify({ type: 'result', subtype: 'success', is_error: false, api_error_status: null, result }),
  stderr: '',
});

const failure = (status: number | null, result: string): Child => ({
  code: 1,
  stdout: JSON.stringify({ type: 'result', subtype: 'success', is_error: true, api_error_status: status, result }),
  stderr: '',
});

interface Call {
  command: string;
  args: string[];
  input: string;
  env: Record<string, string>;
}

/** A child that answers from a list, in order, and records what it was given. */
function fakeChild(...answers: (Child | Error)[]): { run: Runner; calls: Call[] } {
  const calls: Call[] = [];
  const run: Runner = (command, args, { input, env }) => {
    calls.push({ command, args, input, env });
    const answer = answers[calls.length - 1] ?? answers[answers.length - 1];
    if (answer === undefined) throw new Error('the fake child has no answer');
    return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
  };
  return { run, calls };
}

/** Anthropic's API, answering from a list and recording every request whole. */
function fakeApi(...answers: Response[]): { fetcher: typeof fetch; seen: string[] } {
  const seen: string[] = [];
  const fetcher = ((input: string | URL | Request, init?: RequestInit) => {
    seen.push(JSON.stringify({ url: String(input), init }));
    const answer = answers[seen.length - 1] ?? answers[answers.length - 1];
    if (answer === undefined) throw new Error('the fake api has no answer');
    return Promise.resolve(answer.clone());
  }) as typeof fetch;
  return { fetcher, seen };
}

const message = (text: string): Response =>
  Response.json({ content: [{ type: 'text', text }], stop_reason: 'end_turn' });

const secrets =
  (held: Partial<Record<Path, string>>) =>
  (path: Path): Promise<string | null> =>
    Promise.resolve(held[path] ?? null);

describe('the subscription path', () => {
  test('answers through the CLI with the token in the child environment', async () => {
    const child = fakeChild(reply('PASS - nothing here changes'));
    const answer = await viaCli(TOKEN, PROMPT, { run: child.run });

    assert.equal(answer, 'PASS - nothing here changes');
    assert.equal(child.calls.length, 1);
    assert.equal(child.calls[0]?.command, 'claude');
    assert.equal(child.calls[0]?.env['CLAUDE_CODE_OAUTH_TOKEN'], TOKEN);
  });

  test('keeps the token out of the arguments and the prompt on stdin', async () => {
    const child = fakeChild(reply('ok'));
    await viaCli(TOKEN, PROMPT, { run: child.run });

    const call = child.calls[0];
    assert.ok(call);
    assert.ok(call.args.every((arg) => !arg.includes(TOKEN)), 'the token is in an argument');
    assert.ok(call.args.every((arg) => !arg.includes('Sydney')), 'the prompt is in an argument');
    assert.equal(call.input, PROMPT);
    // Tools off and nothing saved: the child is a completion.
    assert.deepEqual(call.args.slice(call.args.indexOf('--tools'), call.args.indexOf('--tools') + 2), ['--tools', '']);
    assert.ok(call.args.includes('--no-session-persistence'));
    assert.ok(call.args.includes('--safe-mode'));
    assert.equal(call.args[call.args.indexOf('--model') + 1], MODEL);
  });

  test('hands the child an allow-listed environment, so an API key cannot outrank the token', async () => {
    const held = { ...process.env };
    process.env['ANTHROPIC_API_KEY'] = API_KEY;
    process.env['DATABASE_URL'] = 'postgresql://user:password@host/db';
    process.env['SUKKAL_SECRET_KEY'] = 'sealing-key';
    try {
      const child = fakeChild(reply('ok'));
      await viaCli(TOKEN, PROMPT, { run: child.run });

      const env = child.calls[0]?.env ?? {};
      assert.deepEqual(
        Object.keys(env).filter((name) => !['PATH', 'HOME', 'USER', 'TMPDIR', 'CLAUDE_CONFIG_DIR', 'DISABLE_AUTOUPDATER'].includes(name)),
        ['CLAUDE_CODE_OAUTH_TOKEN'],
      );
      assert.ok(!JSON.stringify(env).includes(API_KEY));
    } finally {
      for (const name of ['ANTHROPIC_API_KEY', 'DATABASE_URL', 'SUKKAL_SECRET_KEY']) {
        if (held[name] === undefined) delete process.env[name];
        else process.env[name] = held[name];
      }
    }
  });

  test('scrubs the token from anything the child wrote', async () => {
    const child = fakeChild({ code: 1, stdout: '', stderr: `bad credential ${TOKEN} refused` });
    await assert.rejects(viaCli(TOKEN, PROMPT, { run: child.run }), (cause: unknown) => {
      assert.ok(cause instanceof InferenceError);
      assert.ok(!cause.message.includes(TOKEN), 'the token is in the error');
      assert.ok(cause.message.includes('[token]'));
      return true;
    });
  });

  test('runs a real child process and the token is only in its environment', async () => {
    // The fake CLI is a script run by a real spawn, so this covers the runner
    // itself: stdin, the environment and the argument list.
    const run: Runner = (_command, args, options) => spawnChild(process.execPath, [FAKE_CLAUDE, ...args], options);
    const held = process.env['ANTHROPIC_API_KEY'];
    process.env['ANTHROPIC_API_KEY'] = API_KEY;
    try {
      const described = await viaCli(TOKEN, PROMPT, { run });
      const seen = JSON.parse(described) as { argv: string[]; env: Record<string, string>; input: string };

      assert.equal(seen.input, PROMPT);
      assert.equal(seen.env['CLAUDE_CODE_OAUTH_TOKEN'], TOKEN);
      assert.equal(seen.env['ANTHROPIC_API_KEY'], undefined);
      assert.ok(!seen.argv.join(' ').includes(TOKEN), 'the token is in the real argument list');
      assert.equal(
        Object.entries(seen.env).filter(([, value]) => value === TOKEN).length,
        1,
        'the token sits in more than one variable',
      );
    } finally {
      if (held === undefined) delete process.env['ANTHROPIC_API_KEY'];
      else process.env['ANTHROPIC_API_KEY'] = held;
    }
  });

  test('kills a child that outlives the timeout', async () => {
    const started = Date.now();
    await assert.rejects(
      spawnChild(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { input: '', env: {}, timeoutMs: 200 }),
    );
    assert.ok(Date.now() - started < 10_000, 'the child ran to its own end');
  });

  test('a binary that is not there is a failure of the other kind', async () => {
    const run: Runner = (_command, args, options) => spawnChild('sukkal-no-such-binary', args, options);
    await assert.rejects(viaCli(TOKEN, PROMPT, { run }), (cause: unknown) => {
      assert.ok(cause instanceof InferenceError);
      assert.equal(cause.kind, 'other');
      return true;
    });
  });
});

describe('classifying a failure by its text', () => {
  test('a disk or crash message that contains "log in" is not an auth failure', () => {
    for (const said of [
      'Error: ENOSPC writing to the backlog index',
      'could not write the catalog in /tmp',
    ]) {
      assert.equal(kindOf(null, said), 'other', said);
    }
  });

  test('a refused credential is an auth failure', () => {
    for (const said of [
      'Not logged in',
      'Please run /login',
      'Invalid API key',
      'OAuth access token is invalid',
      'Failed to authenticate. API Error: 401 OAuth token has expired',
      'Unauthorized',
      'OAuth token revoked',
    ]) {
      assert.equal(kindOf(null, said), 'auth', said);
    }
  });

  test('a rate limit is a rate_limit failure', () => {
    for (const said of ['API Error: Rate limit reached', 'Claude AI usage limit reached|1760900000', 'Overloaded', 'rate-limited']) {
      assert.equal(kindOf(null, said), 'rate_limit', said);
    }
  });

  test('the status wins over the text', () => {
    assert.equal(kindOf(429, 'Not logged in'), 'rate_limit');
    assert.equal(kindOf(401, 'disk full'), 'auth');
  });
});

describe('which path answers', () => {
  let logged: string[] = [];

  beforeEach(() => {
    logged = [];
    for (const method of ['log', 'info', 'warn', 'error'] as const) {
      mock.method(console, method, (...args: unknown[]) => {
        logged.push(args.map(String).join(' '));
      });
    }
  });

  afterEach(() => {
    mock.restoreAll();
  });

  test('uses the subscription when it is stored, and never calls the API', async () => {
    const child = fakeChild(reply('PASS'));
    const api = fakeApi(message('from the api'));
    const model = live(secrets({ subscription: TOKEN, api: API_KEY }), {
      prefer: 'subscription',
      run: child.run,
      fetcher: api.fetcher,
    });

    assert.equal(await model.ask('gate', PROMPT), 'PASS');
    assert.equal(child.calls.length, 1);
    assert.equal(api.seen.length, 0);
  });

  test('falls back to the API key when the subscription is refused', async () => {
    const child = fakeChild(failure(401, 'Failed to authenticate. API Error: 401 OAuth token has expired'));
    const api = fakeApi(message('PASS from the api'));
    const model = live(secrets({ subscription: TOKEN, api: API_KEY }), {
      prefer: 'subscription',
      run: child.run,
      fetcher: api.fetcher,
    });

    assert.equal(await model.ask('gate', PROMPT), 'PASS from the api');
    assert.equal(api.seen.length, 1);

    const request = JSON.parse(api.seen[0] ?? '{}') as { url: string; init: { headers: Record<string, string>; body: string } };
    assert.equal(request.url, 'https://api.anthropic.com/v1/messages');
    assert.equal(request.init.headers['x-api-key'], API_KEY);
    assert.equal((JSON.parse(request.init.body) as { model: string }).model, MODEL);
  });

  test('falls back to the API key on a rate limit, by status and by text', async () => {
    for (const limited of [
      failure(429, 'API Error: Rate limit reached'),
      failure(null, 'Claude AI usage limit reached|1760900000'),
    ]) {
      const api = fakeApi(message('from the api'));
      const model = live(secrets({ subscription: TOKEN, api: API_KEY }), {
        prefer: 'subscription',
        run: fakeChild(limited).run,
        fetcher: api.fetcher,
      });
      assert.equal(await model.ask('gate', PROMPT), 'from the api');
      assert.equal(api.seen.length, 1);
    }
  });

  test('never sends the subscription token to Anthropic over HTTP', async () => {
    const child = fakeChild(failure(401, `OAuth token ${TOKEN} has expired`));
    const api = fakeApi(message('from the api'));
    const model = live(secrets({ subscription: TOKEN, api: API_KEY }), {
      prefer: 'subscription',
      run: child.run,
      fetcher: api.fetcher,
    });
    await model.ask('gate', PROMPT);

    assert.ok(api.seen.length > 0);
    for (const request of api.seen) {
      assert.ok(!request.includes(TOKEN), 'the subscription token was sent over HTTP');
    }
  });

  test('a crash does not fall back, so a fault never spends money', async () => {
    const api = fakeApi(message('from the api'));
    const model = live(secrets({ subscription: TOKEN, api: API_KEY }), {
      prefer: 'subscription',
      run: fakeChild({ code: 1, stdout: '', stderr: 'segmentation fault' }).run,
      fetcher: api.fetcher,
    });

    await assert.rejects(model.ask('gate', PROMPT), /the claude CLI failed: segmentation fault/);
    assert.equal(api.seen.length, 0);
  });

  test('a missing binary does not fall back either', async () => {
    const api = fakeApi(message('from the api'));
    const model = live(secrets({ subscription: TOKEN, api: API_KEY }), {
      prefer: 'subscription',
      run: fakeChild(new Error('spawn claude ENOENT')).run,
      fetcher: api.fetcher,
    });

    await assert.rejects(model.ask('gate', PROMPT), /could not be run/);
    assert.equal(api.seen.length, 0);
  });

  test('uses the API key alone when no subscription is stored', async () => {
    const child = fakeChild(reply('from the cli'));
    const api = fakeApi(message('from the api'));
    const model = live(secrets({ api: API_KEY }), { prefer: 'subscription', run: child.run, fetcher: api.fetcher });

    assert.equal(await model.ask('gate', PROMPT), 'from the api');
    assert.equal(child.calls.length, 0);
  });

  test('says where to add a credential when neither is stored', async () => {
    const child = fakeChild(reply('from the cli'));
    const api = fakeApi(message('from the api'));
    const model = live(secrets({}), { prefer: 'subscription', run: child.run, fetcher: api.fetcher });

    await assert.rejects(model.ask('gate', PROMPT), new Error(NOTHING_STORED));
    assert.equal(child.calls.length, 0);
    assert.equal(api.seen.length, 0);
  });

  test('says when the only stored path failed and nothing is left to fall back on', async () => {
    const model = live(secrets({ subscription: TOKEN }), {
      prefer: 'subscription',
      run: fakeChild(failure(429, 'Rate limit reached')).run,
    });

    await assert.rejects(model.ask('gate', PROMPT), /Nothing is stored to fall back on for api\./);
  });

  test('throws when both paths are refused, and names neither secret', async () => {
    const model = live(secrets({ subscription: TOKEN, api: API_KEY }), {
      prefer: 'subscription',
      run: fakeChild(failure(401, `token ${TOKEN} refused`)).run,
      fetcher: fakeApi(new Response('{}', { status: 401 })).fetcher,
    });

    await assert.rejects(model.ask('gate', PROMPT), (cause: unknown) => {
      assert.ok(cause instanceof Error);
      assert.match(cause.message, /subscription: .*api: /);
      assert.ok(!cause.message.includes(TOKEN));
      assert.ok(!cause.message.includes(API_KEY));
      return true;
    });
  });

  test('the setting puts the API key first, and the subscription is then the fallback', async () => {
    const child = fakeChild(reply('from the cli'));
    const api = fakeApi(new Response('{}', { status: 429 }));
    const model = live(secrets({ subscription: TOKEN, api: API_KEY }), {
      prefer: 'api',
      run: child.run,
      fetcher: api.fetcher,
    });

    assert.equal(await model.ask('gate', PROMPT), 'from the cli');
    assert.equal(api.seen.length, 1);
    assert.equal(child.calls.length, 1);
  });

  test('opens only the credential of a path it tries', async () => {
    const opened: Path[] = [];
    const model = live(
      (path) => {
        opened.push(path);
        return Promise.resolve(path === 'subscription' ? TOKEN : API_KEY);
      },
      { prefer: 'subscription', run: fakeChild(reply('PASS')).run },
    );

    await model.ask('gate', PROMPT);
    assert.deepEqual(opened, ['subscription']);
  });

  test('logs the kind of a failure and never a secret', async () => {
    const model = live(secrets({ subscription: TOKEN, api: API_KEY }), {
      prefer: 'subscription',
      run: fakeChild(failure(401, `OAuth token ${TOKEN} has expired`)).run,
      fetcher: fakeApi(message('from the api')).fetcher,
    });
    await model.ask('gate', PROMPT);

    assert.ok(logged.length > 0, 'the fallback was silent');
    assert.ok(logged.some((line) => line.includes('subscription path failed (auth)')));
    for (const line of logged) {
      assert.ok(!line.includes(TOKEN), 'the token is in a log line');
      assert.ok(!line.includes(API_KEY), 'the API key is in a log line');
    }
  });
});

describe('the Messages API path', () => {
  test('joins the text blocks of the answer', async () => {
    const api = fakeApi(Response.json({ content: [{ type: 'text', text: 'PASS' }, { type: 'text', text: ' - yes' }] }));
    assert.equal(await viaMessages(API_KEY, PROMPT, api.fetcher), 'PASS - yes');
  });

  test('reads the failure kinds the fallback needs', async () => {
    for (const [status, kind] of [
      [401, 'auth'],
      [403, 'auth'],
      [429, 'rate_limit'],
      [529, 'rate_limit'],
      [500, 'other'],
    ] as const) {
      await assert.rejects(viaMessages(API_KEY, PROMPT, fakeApi(new Response('{}', { status })).fetcher), (cause: unknown) => {
        assert.ok(cause instanceof InferenceError);
        assert.equal(cause.kind, kind, `status ${String(status)}`);
        return true;
      });
    }
  });

  test('an answer with no text is a failure', async () => {
    await assert.rejects(viaMessages(API_KEY, PROMPT, fakeApi(Response.json({ content: [] })).fetcher), /no text/);
  });
});

describe('the setting', () => {
  test('defaults to the subscription', () => {
    assert.equal(preference({}), 'subscription');
  });

  test('takes api', () => {
    assert.equal(preference({ SUKKAL_INFERENCE: 'api' }), 'api');
  });

  test('refuses a value it does not know', () => {
    assert.throws(() => preference({ SUKKAL_INFERENCE: 'Subscription ' }), /subscription or api/);
  });
});

describe('proving the token', () => {
  test('accepts a token the CLI answers for', async () => {
    const child = fakeChild(reply('ok'));
    const verdict = await verifySubscription(TOKEN, child.run);

    assert.equal(verdict.ok, true);
    assert.equal(child.calls[0]?.args[child.calls[0].args.indexOf('--model') + 1], 'haiku');
  });

  test('records a refused token, a rate limit and a crash as answers', async () => {
    const refused = await verifySubscription(TOKEN, fakeChild(failure(401, `revoked ${TOKEN}`)).run);
    const limited = await verifySubscription(TOKEN, fakeChild(failure(429, 'Rate limit reached')).run);
    const crashed = await verifySubscription(TOKEN, fakeChild({ code: 1, stdout: '', stderr: 'boom' }).run);

    assert.deepEqual([refused.ok, limited.ok, crashed.ok], [false, false, false]);
    assert.match(refused.verdict, /refused/);
    assert.match(limited.verdict, /rate limiting/);
    assert.match(crashed.verdict, /could not check/);
    for (const verdict of [refused, limited, crashed]) {
      assert.ok(!verdict.verdict.includes(TOKEN));
    }
  });
});

describe('against stored connections', { skip: url ? false : 'DATABASE_URL_TEST is unset' }, () => {
  let client: ClientBase & { end: () => Promise<void> };
  const held = process.env[KEY_VARIABLE];

  before(async () => {
    process.env[KEY_VARIABLE] = randomBytes(32).toString('base64');
    client = connect('DATABASE_URL_TEST');
    await client.connect();
    await refuseProduction(client);
    await down(client, MIGRATIONS);
    await up(client, MIGRATIONS);
  });

  after(async () => {
    await down(client, MIGRATIONS);
    await client.end();
    if (held === undefined) delete process.env[KEY_VARIABLE];
    else process.env[KEY_VARIABLE] = held;
  });

  beforeEach(async () => {
    await client.query('DELETE FROM connections');
  });

  test('finds the subscription token and the API key by their methods', async () => {
    const bare = await addConnection(client, { provider: 'claude', name: 'Not filled in', method: 'subscription' });
    assert.ok(bare);
    assert.equal(await storedSecret(client)('subscription'), null, 'a card with no credential answered');
    assert.equal(await storedSecret(client)('api'), null);

    const sub = await addConnection(client, { provider: 'claude', name: 'Claude by subscription', method: 'subscription' });
    const key = await addConnection(client, { provider: 'claude', name: 'Koinon API key', method: 'key' });
    await setCredential(client, sub, TOKEN, { expiresOn: '2027-10-01' });
    await setCredential(client, key, API_KEY, { expiresOn: '2027-10-01' });

    assert.equal(await storedSecret(client)('subscription'), TOKEN);
    assert.equal(await storedSecret(client)('api'), API_KEY);
  });

  test('asks with the stored token, read at the moment of the call', async () => {
    const sub = await addConnection(client, { provider: 'claude', name: 'Claude by subscription', method: 'subscription' });
    await setCredential(client, sub, TOKEN, {});
    const child = fakeChild(reply('PASS'));

    const model = live(storedSecret(client), { prefer: 'subscription', run: child.run });
    assert.equal(await model.ask('gate', PROMPT), 'PASS');
    assert.equal(child.calls[0]?.env['CLAUDE_CODE_OAUTH_TOKEN'], TOKEN);

    // A retyped token is the next call's token.
    await setCredential(client, sub, `${TOKEN}-renewed`, {});
    await model.ask('gate', PROMPT);
    assert.equal(child.calls[1]?.env['CLAUDE_CODE_OAUTH_TOKEN'], `${TOKEN}-renewed`);
  });

  test('the hourly recheck proves the token through the CLI and never over HTTP', async () => {
    const sub = await addConnection(client, { provider: 'claude', name: 'Claude by subscription', method: 'subscription' });
    await setCredential(client, sub, TOKEN, { expiresOn: '2027-10-01' });
    const child = fakeChild(reply('ok'));
    const api = fakeApi(message('never asked'));

    const found = await recheck(client, new Date('2026-10-19T09:00:00Z'), api.fetcher, child.run);

    assert.equal(found.length, 1);
    assert.equal(found[0]?.ok, true);
    assert.equal(api.seen.length, 0, 'the recheck made an HTTP call with the subscription token');
    assert.equal(child.calls[0]?.env['CLAUDE_CODE_OAUTH_TOKEN'], TOKEN);

    const row = (await listConnections(client)).find((one) => one.id === sub);
    assert.equal(row?.verifiedOk, true);
    assert.ok(!JSON.stringify(row).includes(TOKEN));
  });

  test('a refused token is recorded as failing', async () => {
    const sub = await addConnection(client, { provider: 'claude', name: 'Claude by subscription', method: 'subscription' });
    await setCredential(client, sub, TOKEN, { expiresOn: '2027-10-01' });
    const child = fakeChild(failure(401, 'OAuth token revoked'));

    await recheck(client, new Date('2026-10-19T09:00:00Z'), fakeApi(message('x')).fetcher, child.run);

    const row = (await listConnections(client)).find((one) => one.id === sub);
    assert.equal(row?.verifiedOk, false);
    assert.match(row?.verdict ?? '', /refused the setup token/);
  });

  test('the API key connection is still checked the old way, over HTTP', async () => {
    const key = await addConnection(client, { provider: 'claude', name: 'Koinon API key', method: 'key' });
    await setCredential(client, key, API_KEY, { expiresOn: '2027-10-01' });
    const child = fakeChild(reply('never asked'));
    const api = fakeApi(Response.json({ data: [] }));

    await recheck(client, new Date('2026-10-19T09:00:00Z'), api.fetcher, child.run);

    assert.equal(child.calls.length, 0);
    assert.equal(api.seen.length, 1);
    assert.ok(api.seen[0]?.includes('https://api.anthropic.com/v1/models'));
  });
});
