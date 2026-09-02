/**
 * The one path to an outbound action.
 *
 * Two rules shape every test below. A denial never reaches the effect, proved
 * by a stub that counts its calls rather than by reading the code. A crash
 * between the two rows leaves the attempt standing, proved by killing the
 * process rather than by asserting what a crash would do.
 *
 * Nothing here reads the vault, so this file runs the way CI runs, without one.
 */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import type { ClientBase } from 'pg';
import { connect } from '../src/db/connect.ts';
import { down, up } from '../src/db/migrate.ts';
import { act, NOT_YET_KNOWN, type Action, type Permit } from '../src/policy/act.ts';

const ROOT = path.join(import.meta.dirname, '..');
const MIGRATIONS = path.join(ROOT, 'migrations');
const ACT = path.join(ROOT, 'src', 'policy', 'act.ts');
const CONNECT = path.join(ROOT, 'src', 'db', 'connect.ts');
const run = promisify(execFile);
const url = process.env['DATABASE_URL_TEST'];

/** An action nothing denies. Each test overrides only what it tests. */
const LABEL: Action = {
  action: 'mail.label',
  target: 'thread/18f2c9',
  space: 'koinon',
  intent: 'File the Meridian thread under BHP / Meridian.',
  before: 'The thread carried no label.',
  reverse: 'Remove the label from the 4 messages listed above.',
};

/** An action an absolute rule denies. */
const SEND: Action = { ...LABEL, action: 'mail.send' };

/** One row as the tests read it back. */
interface Row {
  id: string;
  action: string;
  intent: string;
  before: string;
  outcome: string;
  result: string;
  reverse: string;
  rule: string | null;
  attempt: string | null;
}

/** An effect that records every call, so a denial can be proved never to run
 *  it. It takes the permit, which is the only thing that can produce one. */
function stub(returns = 'Label applied to 4 messages.') {
  const calls: Permit[] = [];
  return {
    calls,
    effect: async (permit: Permit): Promise<string> => {
      calls.push(permit);
      return returns;
    },
  };
}

describe('the one path to an action', { skip: url ? false : 'DATABASE_URL_TEST is unset' }, () => {
  let client: ClientBase & { end: () => Promise<void> };

  before(async () => {
    client = connect('DATABASE_URL_TEST');
    await client.connect();
    const current = await client.query<{ name: string }>('SELECT current_database() AS name');
    assert.notEqual(current.rows[0]?.name, 'kpa', 'tests must run against kpa_dev, never kpa');
    await down(client, MIGRATIONS);
    await up(client, MIGRATIONS);
  });

  after(async () => {
    await down(client, MIGRATIONS);
    await client.end();
  });

  /** Reads one row by id. */
  async function read(id: string): Promise<Row> {
    const rows = await client.query<Row>(
      `SELECT id, action, intent, before, outcome::text AS outcome, result, reverse, rule, attempt
         FROM audit WHERE id = $1`,
      [id],
    );
    assert.equal(rows.rows.length, 1, `no audit row ${id}`);
    return rows.rows[0]!;
  }

  /** How many rows close the attempt row `id`. */
  async function closing(id: string): Promise<number> {
    const rows = await client.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM audit WHERE attempt = $1', [id],
    );
    return rows.rows[0]!.n;
  }

  describe('a denial', () => {
    test('never runs the effect', async () => {
      const { calls, effect } = stub();
      const done = await act(client, SEND, effect);

      assert.equal(done.outcome, 'denied');
      assert.equal(calls.length, 0, 'the effect ran on a denial');
    });

    test('writes one row, names the rule, and pairs with nothing', async () => {
      const { effect } = stub();
      const done = await act(client, SEND, effect);
      const row = await read(done.audit);

      assert.equal(row.outcome, 'denied');
      assert.equal(row.rule, 'mail.send.never-unprompted');
      assert.equal(row.attempt, null, 'a denial closed an attempt that never happened');
      assert.equal(await closing(row.id), 0);
      assert.match(row.result, /Refused, and nothing ran\./);
      assert.match(row.reverse, /Nothing to reverse/);
      assert.equal(row.action, 'mail.send');
    });

    test('names the default rule when no rule describes the action', async () => {
      const { calls, effect } = stub();
      const done = await act(client, { ...LABEL, action: 'calendar.cancel' }, effect);

      assert.equal(done.outcome, 'denied');
      assert.equal(done.rule, 'deny-by-default');
      assert.equal(calls.length, 0);
      assert.equal((await read(done.audit)).rule, 'deny-by-default');
    });
  });

  describe('an allowance', () => {
    test('writes the attempt before the call and the outcome after it', async () => {
      const { calls, effect } = stub();
      const done = await act(client, LABEL, effect);

      assert.equal(done.outcome, 'allowed');
      assert.equal(calls.length, 1, 'the effect did not run');

      const outcome = await read(done.audit);
      assert.equal(outcome.outcome, 'allowed');
      assert.equal(outcome.result, 'Label applied to 4 messages.');
      assert.notEqual(outcome.attempt, null, 'the outcome row closed nothing');

      const attempt = await read(outcome.attempt!);
      assert.equal(attempt.outcome, 'attempted');
      assert.equal(attempt.result, NOT_YET_KNOWN);
      assert.equal(attempt.reverse, LABEL.reverse, 'the attempt row must say how to undo it');
      assert.ok(
        Number(attempt.id) < Number(outcome.id),
        'the attempt row was written after the outcome row',
      );
    });

    test('carries all four fields, filled, on both rows', async () => {
      const { effect } = stub();
      const done = await act(client, LABEL, effect);
      const outcome = await read(done.audit);

      for (const row of [outcome, await read(outcome.attempt!)]) {
        for (const field of ['intent', 'before', 'result', 'reverse'] as const) {
          assert.notEqual(row[field].trim(), '', `${row.outcome} row has an empty ${field}`);
        }
      }
    });

    test('a flagged crossing still acts, and the row names the rule', async () => {
      const { calls, effect } = stub();
      const done = await act(client, { ...LABEL, draws: ['collibra', 'koinon'] }, effect);

      assert.equal(done.outcome, 'allowed');
      assert.equal(calls.length, 1);
      assert.equal((await read(done.audit)).rule, 'space.collibra-koinon-separation');
    });
  });

  describe('a call that fails', () => {
    test('still writes the outcome row, and says the action may have happened', async () => {
      const done = await act(client, LABEL, async () => {
        throw new Error('Gmail answered 503');
      });

      assert.equal(done.outcome, 'allowed');
      assert.equal(done.failure?.message, 'Gmail answered 503');

      const outcome = await read(done.audit);
      assert.match(outcome.result, /Gmail answered 503/);
      assert.match(outcome.result, /may or may not have happened/);
      assert.equal(
        outcome.reverse, LABEL.reverse,
        'a failed call still needs the reversal, because it may have reached Gmail',
      );
      assert.equal(await closing(outcome.attempt!), 1);
    });

    test('opens no transaction, which is what lets that row survive', async () => {
      // The behavioural proof is above. This one guards the reason: a
      // transaction around the effect would roll the attempt row back with
      // the failed call and leave the log silent about its worst case.
      const source = await readFile(ACT, 'utf8');
      assert.doesNotMatch(source, /'BEGIN'|"BEGIN"|`BEGIN`/);
    });
  });

  describe('a field that says nothing', () => {
    test('is refused before anything is decided or written', async () => {
      const { calls, effect } = stub();
      const before = await client.query<{ n: number }>('SELECT count(*)::int AS n FROM audit');

      for (const field of ['intent', 'before', 'reverse'] as const) {
        await assert.rejects(
          act(client, { ...LABEL, [field]: '   ' }, effect),
          new RegExp(`${field} is empty`),
        );
      }

      assert.equal(calls.length, 0);
      const after = await client.query<{ n: number }>('SELECT count(*)::int AS n FROM audit');
      assert.equal(after.rows[0]!.n, before.rows[0]!.n, 'an empty field still wrote a row');
    });
  });

  describe('the append-only guarantee, after migration 014', () => {
    test('an attempt row cannot be completed by updating it', async () => {
      // This is the whole reason there are two rows. If this ever passed,
      // ADR-0015 would have bought nothing.
      const { effect } = stub();
      const done = await act(client, LABEL, effect);
      const attempt = (await read(done.audit)).attempt!;

      await assert.rejects(
        client.query('UPDATE audit SET result = $2 WHERE id = $1', [attempt, 'finished']),
        /audit is append only: UPDATE is not allowed/,
      );
      await assert.rejects(
        client.query('DELETE FROM audit WHERE id = $1', [attempt]),
        /audit is append only: DELETE is not allowed/,
      );

      assert.equal((await read(attempt)).result, NOT_YET_KNOWN, 'the attempt row still stands');
    });
  });

  describe('a process that dies mid-action', () => {
    test('leaves an attempt nothing closes', async () => {
      // ADR-0015 calls this the most valuable row in the log. A child process
      // runs `act` and sends itself SIGKILL from inside the effect, which no
      // handler can catch, so the outcome row is never written. Asserting what
      // a crash would do would prove nothing about what a crash does.
      const marker = `Label the thread that killed the worker ${randomUUID()}`;
      const child = `
        import { connect } from ${JSON.stringify(pathToFileURL(CONNECT).href)};
        import { act } from ${JSON.stringify(pathToFileURL(ACT).href)};
        const client = connect('DATABASE_URL_TEST');
        await client.connect();
        await act(client, {
          action: 'mail.label',
          target: 'thread/dead',
          space: 'koinon',
          intent: ${JSON.stringify(marker)},
          before: 'The thread carried no label.',
          reverse: 'Remove the label.',
        }, async () => {
          process.kill(process.pid, 'SIGKILL');
          return 'never reached';
        });
      `;

      await assert.rejects(
        run(process.execPath, ['--input-type=module', '--eval', child]),
        'the child returned instead of dying',
      );

      const rows = await client.query<Row>(
        `SELECT id, action, intent, before, outcome::text AS outcome, result, reverse, rule, attempt
           FROM audit WHERE intent = $1`,
        [marker],
      );
      assert.equal(rows.rows.length, 1, 'the crash left no row, or left two');

      const orphan = rows.rows[0]!;
      assert.equal(orphan.outcome, 'attempted');
      assert.equal(orphan.result, NOT_YET_KNOWN);
      assert.equal(orphan.reverse, 'Remove the label.', 'the orphan says how to undo the action');
      assert.equal(await closing(orphan.id), 0, 'something closed the orphan');
    });
  });

  // Keep this last. It reverses every migration and reapplies them, so any
  // test after it starts against a schema this one rebuilt.
  describe('reversing migration 014', () => {
    test('drops the column while a row still carries the new enum value', async () => {
      // The lesson this project has paid for three times: run the reversal
      // rather than read it. A down block that raises here would stop
      // `migrate down` on every database that ever recorded an attempt.
      const { effect } = stub();
      await act(client, LABEL, effect);
      const carried = await client.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM audit WHERE outcome::text = 'attempted'`,
      );
      assert.ok(carried.rows[0]!.n > 0, 'nothing carried the value, so this proves nothing');

      const reversed = await down(client, MIGRATIONS);
      assert.ok(reversed.includes('014_audit_attempt.sql'), '014 did not reverse');

      const left = await client.query<{ oid: string | null }>(
        `SELECT to_regclass('public.audit') AS oid`,
      );
      assert.equal(left.rows[0]!.oid, null, '005 left the audit table behind');

      const applied = await up(client, MIGRATIONS);
      assert.ok(applied.includes('014_audit_attempt.sql'), '014 did not reapply');
    });
  });
});
