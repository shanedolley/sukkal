/**
 * Which `Inference` a process gets, and what a gate does when the live one
 * fails on every path. ADR-0027. KPA-86.
 *
 * No test here reaches Anthropic. The CLI is a fake runner and the API is a
 * fake fetcher. The scan below reads source files and runs nothing.
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

  test('reads the path order from the env it is given, not from process.env', async () => {
    const asked: Path[] = [];
    const secretOf = (path: Path): Promise<string | null> => {
      asked.push(path);
      return Promise.resolve(null);
    };
    const before = process.env['SUKKAL_INFERENCE'];
    process.env['SUKKAL_INFERENCE'] = 'api';
    try {
      await assert.rejects(inferenceFor(NO_CLIENT, { [MODE_VARIABLE]: 'live' }, { secretOf }).ask('g', 'p'));
      await assert.rejects(
        inferenceFor(NO_CLIENT, { [MODE_VARIABLE]: 'live', SUKKAL_INFERENCE: 'api' }, { secretOf }).ask('g', 'p'),
      );
    } finally {
      if (before === undefined) delete process.env['SUKKAL_INFERENCE'];
      else process.env['SUKKAL_INFERENCE'] = before;
    }
    assert.deepEqual(asked, ['subscription', 'api', 'api', 'subscription']);
  });

  test('refuses an unknown SUKKAL_INFERENCE in the env it is given', () => {
    assert.throws(
      () => inferenceFor(NO_CLIENT, { [MODE_VARIABLE]: 'live', SUKKAL_INFERENCE: 'Api' }),
      /subscription or api/,
    );
  });
});

describe('who may import the live Inference or build a recorded one', () => {
  const ROOT = path.join(import.meta.dirname, '..');
  const SCANNED = ['src', 'scripts', path.join('apps', 'web')];
  const SKIPPED = new Set(['node_modules', '.next']);
  const EXTENSIONS = /\.(?:ts|tsx|mts|mjs)$/;

  // The selector builds both. The connections verify module calls `viaCli` on
  // purpose: it checks the credential and runs no inference (ADR-0027). The two
  // modules themselves import nothing that matters here.
  const MAY_IMPORT_LIVE = new Set([
    'src/memory/inference-select.ts',
    'src/connections/verify.ts',
  ]);
  const MAY_IMPORT_RECORDED = new Set(['src/memory/inference-select.ts']);

  /** Drops block comments and whole-line comments, so prose never matches. */
  const stripComments = (source: string): string =>
    source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

  /** Every module a file imports or re-exports, with the names it takes. */
  function imports(source: string): { from: string; names: string }[] {
    const code = stripComments(source);
    const found: { from: string; names: string }[] = [];
    // `import x from 'm'`, `import {a} from 'm'`, `export {a} from 'm'`,
    // `export * from 'm'`. A type-only statement can call nothing.
    for (const m of code.matchAll(/^[ \t]*(?:import|export)(?!\s+type\b)\b([^;'"]*?)\bfrom\s*['"]([^'"]+)['"]/gm)) {
      found.push({ names: m[1]!, from: m[2]! });
    }
    // `import 'm'`, and `import('m')` or `await import('m')` anywhere.
    for (const m of code.matchAll(/\bimport\s*\(?\s*['"]([^'"]+)['"]/g)) found.push({ names: '', from: m[1]! });
    return found;
  }

  const modulePath = (from: string): string => from.replace(/\.(?:ts|tsx|mts|mjs|js)$/, '');
  const isLive = (from: string): boolean => /(?:^|\/)inference-live$/.test(modulePath(from));
  const isRecordedHome = (from: string): boolean => /(?:^|\/)inference$/.test(modulePath(from));

  /** What a file does that the rule forbids, one line per breach. */
  function breaches(source: string): string[] {
    const out: string[] = [];
    for (const { from, names } of imports(source)) {
      if (isLive(from)) out.push(`imports the live module ${from}`);
      // `recorded` by name, or the whole namespace, which holds it too.
      if (isRecordedHome(from) && /\brecorded\b|\*/.test(names)) out.push(`imports recorded from ${from}`);
    }
    return out;
  }

  function sourcesUnder(dir: string): string[] {
    const files: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (SKIPPED.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) files.push(...sourcesUnder(full));
      else if (EXTENSIONS.test(entry.name)) files.push(full);
    }
    return files;
  }

  test('catches the shapes that escaped a search for the call', () => {
    const cases: [string, string][] = [
      ["import { live as l } from './inference-live.ts';", 'live'],
      ["import { viaCli } from '../memory/inference-live.ts';", 'live'],
      ["import { viaMessages } from '../memory/inference-live';", 'live'],
      ["import * as m from '../memory/inference-live.js';", 'live'],
      ["export { live } from './inference-live.ts';", 'live'],
      ["import './inference-live.ts';", 'live'],
      ["const m = await import('./inference-live.ts');", 'live'],
      ["import {\n  live,\n  storedSecret,\n} from './inference-live.ts';", 'live'],
      ["import { recorded } from './inference.ts';", 'recorded'],
      ["import { recorded as r, type Inference } from '../memory/inference.ts';", 'recorded'],
      ["import * as inference from './inference.ts';", 'recorded'],
    ];
    for (const [source, which] of cases) {
      assert.equal(breaches(source).length, 1, `${which}: ${source}`);
    }
  });

  test('ignores a comment and a type-only import', () => {
    const clean = [
      '// recorded(x) and live(y) in prose',
      '/* import { live } from "./inference-live.ts"; */',
      ' * import { recorded } from "./inference.ts";',
      "import type { Inference } from './inference.ts';",
      "import type { Runner } from '../memory/inference-live.ts';",
      "import { type Inference } from './inference.ts';",
      "const note = 'a recorded(x) call';",
      'export function recorded() {}',
    ];
    assert.deepEqual(breaches(clean.join('\n')), []);
  });

  test('is the only code that imports the live Inference or builds a recorded one', () => {
    const files = SCANNED.flatMap((dir) => sourcesUnder(path.join(ROOT, dir)));
    assert.ok(files.some((file) => file.endsWith('inference-select.ts')), 'the scan did not reach src/');
    assert.ok(files.some((file) => file.includes(path.join('apps', 'web', 'lib'))), 'the scan did not reach apps/web');
    const offenders: string[] = [];
    for (const file of files) {
      const rel = path.relative(ROOT, file).split(path.sep).join('/');
      const source = readFileSync(file, 'utf8');
      for (const { from, names } of imports(source)) {
        if (isLive(from) && !MAY_IMPORT_LIVE.has(rel)) offenders.push(`${rel} imports ${from}`);
        if (isRecordedHome(from) && /\brecorded\b|\*/.test(names) && !MAY_IMPORT_RECORDED.has(rel)) {
          offenders.push(`${rel} imports recorded from ${from}`);
        }
      }
    }
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

  test('inferenceFor picks live from the env and its failure rejects through admit()', async () => {
    const model = inferenceFor(client, { [MODE_VARIABLE]: 'live' }, { secretOf: secrets, run, fetcher });

    const result = await admit(client, model, candidate());

    assert.equal(result.pass, false);
    assert.match(result.reason, /^gate 1: threw: no Claude path answered/);
    assert.ok(!result.reason.includes(TOKEN) && !result.reason.includes(API_KEY));
    assert.equal((await client.query('SELECT 1 FROM facts')).rows.length, 0);
    assert.equal((await client.query('SELECT 1 FROM rejections')).rows.length, 1);
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
