import assert from 'node:assert/strict';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import type { ClientBase } from 'pg';
import { connect } from '../src/db/connect.ts';
import { down, up } from '../src/db/migrate.ts';

const MIGRATIONS = path.join(import.meta.dirname, '..', 'migrations');
const url = process.env['DATABASE_URL_TEST'];

/** The four required fields, plus enough to satisfy every other NOT NULL
 *  column. Each test overrides only what it is testing. */
interface Row {
  action: string;
  intent: string;
  before: string;
  outcome: 'allowed' | 'denied';
  result: string;
  reverse: string;
  space: 'collibra' | 'koinon' | 'personal' | 'shared';
  rule: string | null;
  at?: string;
}

const ALLOWED: Row = {
  action: 'Apply Gmail label',
  intent: 'File the thread under the right customer.',
  before: 'Thread carried no label.',
  outcome: 'allowed',
  result: 'Label applied.',
  reverse: 'Remove the label.',
  space: 'personal',
  rule: null,
};

const DENIED: Row = {
  ...ALLOWED,
  action: 'Send mail',
  outcome: 'denied',
  result: 'Refused. The draft stays queued.',
  reverse: 'Nothing to reverse.',
  rule: 'mail.send.never-unprompted',
};

describe('the policy and audit tables', { skip: url ? false : 'DATABASE_URL_TEST is unset' }, () => {
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

  /** Inserts one entry and returns its id. Every query here runs on its own
   *  implicit transaction, so a rejected statement never poisons the next. */
  async function insert(row: Row): Promise<string> {
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO audit (action, intent, before, outcome, result, reverse, space, rule, at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9, now()))
       RETURNING id`,
      [
        row.action, row.intent, row.before, row.outcome,
        row.result, row.reverse, row.space, row.rule, row.at ?? null,
      ],
    );
    return inserted.rows[0]!.id;
  }

  describe('policies', () => {
    test('holds the four rules the brief names, and the engine default beside them', async () => {
      const rows = await client.query<{ key: string; absolute: boolean; enabled: boolean }>(
        'SELECT key, absolute, enabled FROM policies ORDER BY key',
      );
      assert.deepEqual(rows.rows, [
        // The engine's own behaviour, written down where the audit screen can
        // render it. `migrations/012` says why an unnamed denial has no home.
        { key: 'deny-by-default', absolute: true, enabled: true },
        { key: 'fact.verify.never-by-agent', absolute: false, enabled: true },
        { key: 'mail.send.never-unprompted', absolute: true, enabled: true },
        { key: 'never-delete-or-destructively-edit', absolute: true, enabled: true },
        { key: 'space.collibra-koinon-separation', absolute: false, enabled: true },
      ]);
    });
  });

  describe('an audit entry', () => {
    test('carries the four required fields as NOT NULL columns', async () => {
      const columns = await client.query<{ column_name: string; is_nullable: string }>(
        `SELECT column_name, is_nullable FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'audit'
            AND column_name IN ('intent', 'before', 'result', 'reverse')
          ORDER BY column_name`,
      );
      assert.deepEqual(columns.rows, [
        { column_name: 'before', is_nullable: 'NO' },
        { column_name: 'intent', is_nullable: 'NO' },
        { column_name: 'result', is_nullable: 'NO' },
        { column_name: 'reverse', is_nullable: 'NO' },
      ]);
    });

    test('an allowed entry needs no rule', async () => {
      const id = await insert(ALLOWED);
      const row = await client.query<{ rule: string | null }>(
        'SELECT rule FROM audit WHERE id = $1', [id],
      );
      assert.equal(row.rows[0]!.rule, null);
    });

    test('a denied entry without a rule is refused', async () => {
      await assert.rejects(
        insert({ ...DENIED, rule: null }),
        /audit_denial_names_a_rule/,
      );
    });

    test('a denied entry names the rule by a real policy key', async () => {
      const id = await insert(DENIED);
      const row = await client.query<{ rule: string }>(
        'SELECT rule FROM audit WHERE id = $1', [id],
      );
      assert.equal(row.rows[0]!.rule, 'mail.send.never-unprompted');

      await assert.rejects(
        insert({ ...DENIED, rule: 'not-a-real-rule' }),
        /violates foreign key constraint/,
      );
    });
  });

  describe('an attempt and its outcome', () => {
    // Migration 014. ADR-0015 pairs two rows rather than updating one, so the
    // table has to say which row closes which, and refuse the shapes that
    // would make the pairing meaningless. `src/policy/act.ts` writes both.

    /** Inserts one row, naming every column the pairing needs. */
    function pair(over: {
      outcome: string;
      attempt: string | null;
      result?: string;
      intent?: string;
    }): Promise<{ rows: { id: string }[] }> {
      return client.query<{ id: string }>(
        `INSERT INTO audit (action, intent, before, outcome, result, reverse, space, rule, attempt)
         VALUES ('Apply Gmail label', $1, 'Thread carried no label.', $2,
                 $3, 'Remove the label.', 'personal', null, $4)
         RETURNING id`,
        [over.intent ?? 'File the thread.', over.outcome, over.result ?? 'Label applied.', over.attempt],
      );
    }

    test('an outcome row closes the attempt row it names', async () => {
      const attempt = (await pair({ outcome: 'attempted', attempt: null })).rows[0]!.id;
      const outcome = (await pair({ outcome: 'allowed', attempt })).rows[0]!.id;

      const closed = await client.query<{ attempt: string }>(
        'SELECT attempt FROM audit WHERE id = $1', [outcome],
      );
      assert.equal(closed.rows[0]!.attempt, attempt);
    });

    test('an attempt row closes nothing itself', async () => {
      const attempt = (await pair({ outcome: 'attempted', attempt: null })).rows[0]!.id;

      await assert.rejects(
        pair({ outcome: 'attempted', attempt }),
        /audit_only_an_outcome_names_an_attempt/,
      );
    });

    test('a row cannot close an attempt that does not exist', async () => {
      await assert.rejects(
        pair({ outcome: 'allowed', attempt: '999999' }),
        /violates foreign key constraint/,
      );
    });

    test('a field that says nothing is refused', async () => {
      // NOT NULL lets an empty string through, and the four fields the brief
      // requires say nothing when they are empty. An attempt row is why this
      // matters now: its `result` is written before the answer exists.
      await assert.rejects(
        pair({ outcome: 'attempted', attempt: null, result: '   ' }),
        /audit_every_field_says_something/,
      );
    });
  });

  describe('the append-only guarantee', () => {
    test('an entry cannot be updated', async () => {
      const id = await insert(ALLOWED);

      await assert.rejects(
        client.query('UPDATE audit SET result = $2 WHERE id = $1', [id, 'rewritten']),
        /audit is append only: UPDATE is not allowed/,
      );

      const row = await client.query<{ result: string }>(
        'SELECT result FROM audit WHERE id = $1', [id],
      );
      assert.equal(row.rows[0]!.result, ALLOWED.result, 'the original row still stands');
    });

    test('an entry cannot be deleted', async () => {
      const id = await insert(ALLOWED);

      await assert.rejects(
        client.query('DELETE FROM audit WHERE id = $1', [id]),
        /audit is append only: DELETE is not allowed/,
      );

      const row = await client.query('SELECT 1 FROM audit WHERE id = $1', [id]);
      assert.equal(row.rows.length, 1, 'the row is still there');
    });

    test('the whole log cannot be truncated', async () => {
      // TRUNCATE fires no row-level trigger, so the two guards above never see
      // it. One statement would empty the log and leave nothing saying it
      // happened, which is the failure this table exists to survive.
      //
      // Two things refuse it, and only one of them is deliberate. needs_you
      // carries a foreign key into audit, so Postgres refuses a plain TRUNCATE
      // on its own. That protection is incidental: it lasts exactly as long as
      // that column does, and CASCADE walks around it. The trigger is the
      // guarantee, so this asserts both routes and names which is which.
      await insert(ALLOWED);

      await assert.rejects(
        client.query('TRUNCATE audit'),
        /cannot truncate a table referenced in a foreign key constraint/,
        'the incidental guard, from needs_you.audit_id',
      );

      await assert.rejects(
        client.query('TRUNCATE audit CASCADE'),
        /audit is append only: TRUNCATE would erase the whole log/,
        'the deliberate guard, which CASCADE must not get past',
      );

      const left = await client.query<{ n: number }>('SELECT count(*)::int AS n FROM audit');
      assert.ok(left.rows[0]!.n > 0, 'the log survived');
    });
  });

  describe('the newest-first index', () => {
    test('reads newest first over a filtered outcome without a sequential scan', async () => {
      // A plan that would fall back to Seq Scan on a real-sized table still
      // picks it here, because the whole table is a handful of rows. Forcing
      // enable_seqscan off proves the index can serve this query at all.
      await client.query('BEGIN');
      try {
        await client.query('SET LOCAL enable_seqscan = off');
        const explained = await client.query<{ 'QUERY PLAN': [{ Plan: unknown }] }>(
          `EXPLAIN (FORMAT JSON)
           SELECT id FROM audit WHERE outcome = 'denied' ORDER BY at DESC`,
        );
        const plan = JSON.stringify(explained.rows[0]!['QUERY PLAN']);
        assert.match(plan, /"Index Name": ?"audit_outcome_at"/);
        assert.doesNotMatch(plan, /"Node Type": ?"Seq Scan"/);
      } finally {
        await client.query('ROLLBACK');
      }
    });

    test('orders newest first in practice', async () => {
      const oldest = await insert({ ...DENIED, at: '2026-08-01T00:00:00+10:00' });
      const newest = await insert({ ...DENIED, at: '2026-08-03T00:00:00+10:00' });
      const middle = await insert({ ...DENIED, at: '2026-08-02T00:00:00+10:00' });

      const rows = await client.query<{ id: string }>(
        `SELECT id FROM audit WHERE outcome = 'denied' AND id = ANY($1) ORDER BY at DESC`,
        [[oldest, newest, middle]],
      );
      assert.deepEqual(rows.rows.map((row) => row.id), [newest, middle, oldest]);
    });
  });
});
