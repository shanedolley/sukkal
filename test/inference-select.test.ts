/**
 * Which `Inference` a process gets, and what a gate does when the live one
 * fails on every path. ADR-0027. KPA-86.
 *
 * No test here reaches Anthropic. The CLI is a fake runner and the API is a
 * fake fetcher.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { after, before, beforeEach, describe, mock, test } from 'node:test';
import type { ClientBase } from 'pg';

import { connect, refuseProduction } from '../src/db/connect.ts';
import { down, up } from '../src/db/migrate.ts';
import { type Candidate, admit } from '../src/memory/gates.ts';
import { live, type Child, type Path, type Runner } from '../src/memory/inference-live.ts';
import { MODE_VARIABLE, inferenceFor } from '../src/memory/inference-select.ts';

const MIGRATIONS = path.join(import.meta.dirname, '..', 'migrations');
const SRC = path.join(import.meta.dirname, '..', 'src');
const url = process.env['DATABASE_URL_TEST'];

// The selector only builds `live` with a client it does not touch until asked.
const NO_CLIENT = {} as ClientBase;

describe('which Inference a process gets', () => {
  test('is the recorded one when the setting is unset, so a test never calls a model', async () => {
    const model = inferenceFor(NO_CLIENT, {});
    await assert.rejects(Promise.resolve().then(() => model.ask('gate', 'p')), /no recorded answer/);
  });

  test('is the recorded one when the setting says so', async () => {
    const model = inferenceFor(NO_CLIENT, { [MODE_VARIABLE]: 'recorded' });
    await assert.rejects(Promise.resolve().then(() => model.ask('gate', 'p')), /no recorded answer/);
  });

  test('refuses a value it does not know, rather than guessing a mode', () => {
    for (const value of ['', 'Live', 'true', 'api', 'subscription']) {
      assert.throws(() => inferenceFor(NO_CLIENT, { [MODE_VARIABLE]: value }), /has to be live or recorded/);
    }
  });

  test('is the live one when the setting says so', async () => {
    // The fake client has no query method, so reaching for a credential throws
    // from the stored-secret read. That proves the live path was chosen, with
    // no network and no credential.
    const model = inferenceFor(NO_CLIENT, { [MODE_VARIABLE]: 'live' });
    await assert.rejects(Promise.resolve().then(() => model.ask('gate', 'p')), (cause: unknown) => {
      assert.ok(cause instanceof TypeError, String(cause));
      assert.doesNotMatch((cause as Error).message, /no recorded answer/);
      return true;
    });
  });

  test('is the only place under src/ that builds a live or a recorded Inference', () => {
    const allowed = new Set(['memory/inference.ts', 'memory/inference-live.ts', 'memory/inference-select.ts']);
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.ts') && !allowed.has(path.relative(SRC, full))) {
          if (/\b(?:live|recorded)\(/.test(readFileSync(full, 'utf8'))) offenders.push(path.relative(SRC, full));
        }
      }
    };
    walk(SRC);
    assert.deepEqual(offenders, []);
  });
});

describe('a live Inference whose every path fails', { skip: url ? false : 'DATABASE_URL_TEST is unset' }, () => {
  let client: ClientBase & { end: () => Promise<void> };
  let sourceId = '0';

  const TOKEN = 'sk-ant-oat01-SUBSCRIPTION-TOKEN-that-must-not-leak';
  const API_KEY = 'sk-ant-api03-API-KEY-that-must-not-leak';
  const GATE_1 = 'gate-1-still-true-in-a-month';

  const candidate = (): Candidate => ({
    subjectId: sourceId,
    path: 'shared/a-candidate.md',
    type: 'decision',
    title: 'A candidate decision',
    description: 'one line',
    space: 'shared',
    text: 'Shane decided on 20 August 2026 that the runner refuses rather than guesses.',
    validFrom: '2026-08-20',
  });

  const limited: Child = {
    code: 1,
    stdout: JSON.stringify({ type: 'result', is_error: true, api_error_status: 429, result: 'Rate limit reached' }),
    stderr: '',
  };
  const run: Runner = () => Promise.resolve(limited);
  const fetcher = (() => Promise.resolve(new Response('{}', { status: 429 }))) as typeof fetch;
  const secrets = (path: Path): Promise<string | null> =>
    Promise.resolve(path === 'subscription' ? TOKEN : API_KEY);

  before(async () => {
    client = connect('DATABASE_URL_TEST');
    await client.connect();
    await refuseProduction(client);
    await down(client, MIGRATIONS);
    await up(client, MIGRATIONS);
    await client.query('BEGIN');
    const node = await client.query<{ id: string }>("INSERT INTO nodes (kind) VALUES ('source') RETURNING id");
    sourceId = node.rows[0]!.id;
    await client.query('INSERT INTO sources (id, path, body) VALUES ($1, $2, $3)', [
      sourceId, 'sources/a-transcript.md', 'raw',
    ]);
    await client.query('COMMIT');
  });

  after(async () => {
    mock.restoreAll();
    await down(client, MIGRATIONS);
    await client.end();
  });

  beforeEach(async () => {
    mock.method(console, 'warn', () => {});
    await client.query('DELETE FROM rejections');
    await client.query('DELETE FROM facts');
    await client.query("DELETE FROM nodes WHERE kind = 'fact'");
  });

  test('the gate rejects the candidate and writes no fact', async () => {
    const model = live(secrets, { prefer: 'subscription', run, fetcher });
    // The first path is rate limited and the API key is too, so ask() throws.
    await assert.rejects(model.ask(GATE_1, 'p'), /no Claude path answered/);

    const result = await admit(client, model, candidate());

    assert.equal(result.pass, false);
    assert.match(result.reason, /^gate 1: threw: no Claude path answered/);
    assert.ok(!result.reason.includes(TOKEN) && !result.reason.includes(API_KEY));
    assert.equal((await client.query('SELECT 1 FROM facts')).rows.length, 0);
    const kept = await client.query<{ reason: string }>('SELECT reason FROM rejections');
    assert.equal(kept.rows.length, 1);
    assert.match(kept.rows[0]!.reason, /^gate 1: threw: /);
  });

  test('a network fault on the first path rejects as well, with no fallback', async () => {
    const crash = (): Promise<Child> => Promise.reject(new Error('spawn claude ENOENT'));
    let spent = 0;
    const counting = (() => {
      spent += 1;
      return Promise.resolve(new Response('{}', { status: 200 }));
    }) as typeof fetch;
    const model = live(secrets, { prefer: 'subscription', run: crash, fetcher: counting });

    const result = await admit(client, model, candidate());

    assert.equal(result.pass, false);
    assert.match(result.reason, /^gate 1: threw: /);
    assert.equal(spent, 0, 'a fault never spends the API key');
  });
});
