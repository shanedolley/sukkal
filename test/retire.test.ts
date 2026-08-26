import assert from 'node:assert/strict';
import path from 'node:path';
import { after, before, beforeEach, describe, test } from 'node:test';
import type { ClientBase } from 'pg';
import { connect } from '../src/db/connect.ts';
import { down, up } from '../src/db/migrate.ts';
import {
  asAt,
  retireByHuman,
  retireBySource,
  stale,
  supersede,
} from '../src/memory/retire.ts';

const MIGRATIONS = path.join(import.meta.dirname, '..', 'migrations');
const url = process.env['DATABASE_URL_TEST'];

describe('retirement', { skip: url ? false : 'DATABASE_URL_TEST is unset' }, () => {
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

  beforeEach(async () => {
    await client.query('DELETE FROM edges');
    await client.query('DELETE FROM facts');
    await client.query("DELETE FROM nodes WHERE kind = 'fact'");
  });

  /** A live fact. Both statements in one transaction, per the node registry. */
  async function fact(
    over: { path: string; validFrom?: string; staleAfter?: string | null },
  ): Promise<string> {
    await client.query('BEGIN');
    const node = await client.query<{ id: string }>(
      "INSERT INTO nodes (kind) VALUES ('fact') RETURNING id",
    );
    const id = node.rows[0]!.id;
    await client.query(
      `INSERT INTO facts (id, path, type, title, description, space, status,
                          valid_from, stale_after)
       VALUES ($1, $2, 'reference', $3, 'one line', 'shared', 'stable', $4, $5)`,
      [id, over.path, over.path, over.validFrom ?? '2026-01-01', over.staleAfter ?? null],
    );
    await client.query('COMMIT');
    return id;
  }

  async function row(path: string) {
    const found = await client.query<{ valid_to: string | null; valid_to_inferred: boolean }>(
      'SELECT valid_to, valid_to_inferred FROM facts WHERE path = $1',
      [path],
    );
    return found.rows[0]!;
  }

  describe('a contradicting source', () => {
    test('retires as at the date the change took effect, not the date KPA read it', async () => {
      await fact({ path: 'koinon/nigel.md' });

      // An email read in August, saying Nigel left in June.
      await retireBySource(client, 'koinon/nigel.md', {
        effective: '2026-06-01',
        sourceDate: '2026-08-27',
      });

      const after = await row('koinon/nigel.md');
      assert.equal(after.valid_to, '2026-06-01');
      assert.equal(after.valid_to_inferred, false, 'the source stated the date');
    });

    test('falls back to the source date, and records that it was inferred', async () => {
      await fact({ path: 'koinon/nigel.md' });

      // The same email, saying only that Nigel has left.
      await retireBySource(client, 'koinon/nigel.md', { sourceDate: '2026-08-27' });

      const after = await row('koinon/nigel.md');
      assert.equal(after.valid_to, '2026-08-27');
      assert.equal(after.valid_to_inferred, true, 'the date was inferred, not stated');
    });
  });

  test('a human retires on whatever date is given', async () => {
    await fact({ path: 'shared/a-preference.md' });
    await retireByHuman(client, 'shared/a-preference.md', '2026-03-15');

    const after = await row('shared/a-preference.md');
    assert.equal(after.valid_to, '2026-03-15');
    assert.equal(after.valid_to_inferred, false, 'he stated it');
  });

  test('retiring something that is not live throws rather than silently doing nothing', async () => {
    await fact({ path: 'shared/one.md' });
    await retireByHuman(client, 'shared/one.md', '2026-03-15');

    await assert.rejects(
      retireByHuman(client, 'shared/one.md', '2026-04-01'),
      /nothing live to retire at shared\/one\.md/,
    );
    await assert.rejects(
      retireByHuman(client, 'shared/never-existed.md', '2026-04-01'),
      /nothing live to retire/,
    );
  });

  describe('querying as at a past date', () => {
    test('returns the fact before the retirement and not after', async () => {
      await fact({ path: 'koinon/nigel.md', validFrom: '2026-01-01' });
      await retireBySource(client, 'koinon/nigel.md', {
        effective: '2026-06-01',
        sourceDate: '2026-08-27',
      });

      assert.deepEqual(await asAt(client, '2026-05-31'), ['koinon/nigel.md'], 'true in May');
      assert.deepEqual(await asAt(client, '2026-07-01'), [], 'gone by July');
    });

    test('is right at every boundary', async () => {
      await fact({ path: 'koinon/nigel.md', validFrom: '2026-01-01' });
      await retireByHuman(client, 'koinon/nigel.md', '2026-06-01');

      // valid_from is inclusive, valid_to is exclusive: the fact is true up to
      // the day before it was retired, and gone on the day itself.
      assert.deepEqual(await asAt(client, '2025-12-31'), [], 'before it began');
      assert.deepEqual(await asAt(client, '2026-01-01'), ['koinon/nigel.md'], 'the first day');
      assert.deepEqual(await asAt(client, '2026-05-31'), ['koinon/nigel.md'], 'the last day');
      assert.deepEqual(await asAt(client, '2026-06-01'), [], 'the day it was retired');
    });
  });

  describe('a superseding fact', () => {
    test('leaves exactly one answer standing at every date', async () => {
      await fact({ path: 'shared/old.md', validFrom: '2026-01-01' });
      const replacement = await fact({ path: 'shared/new.md', validFrom: '2026-06-01' });

      await client.query('BEGIN');
      await supersede(client, replacement, 'shared/old.md', '2026-06-01');
      await client.query('COMMIT');

      // No overlap, and no gap either: one answer on the handover day.
      assert.deepEqual(await asAt(client, '2026-05-31'), ['shared/old.md']);
      assert.deepEqual(await asAt(client, '2026-06-01'), ['shared/new.md']);

      const edge = await client.query<{ kind: string }>('SELECT kind FROM edges');
      assert.deepEqual(edge.rows, [{ kind: 'supersedes' }]);
    });

    test('records the date as stated, because the replacement states it', async () => {
      await fact({ path: 'shared/old.md' });
      const replacement = await fact({ path: 'shared/new.md', validFrom: '2026-06-01' });

      await client.query('BEGIN');
      await supersede(client, replacement, 'shared/old.md', '2026-06-01');
      await client.query('COMMIT');

      assert.equal((await row('shared/old.md')).valid_to_inferred, false);
    });
  });

  describe('the staleness sweep', () => {
    test('flags every fact past its review date, oldest first', async () => {
      await fact({ path: 'shared/overdue.md', staleAfter: '2026-01-31' });
      await fact({ path: 'shared/due-today.md', staleAfter: '2026-08-27' });
      await fact({ path: 'shared/not-yet.md', staleAfter: '2027-01-01' });
      await fact({ path: 'shared/never-rots.md' });

      assert.deepEqual(await stale(client, '2026-08-27'), [
        'shared/overdue.md', 'shared/due-today.md',
      ]);
    });

    test('never sets valid_to on anything it flags', async () => {
      await fact({ path: 'shared/overdue.md', staleAfter: '2026-01-31' });
      await fact({ path: 'shared/also-overdue.md', staleAfter: '2026-02-28' });

      const flagged = await stale(client, '2026-08-27');
      assert.equal(flagged.length, 2, 'both are due for review');

      // A stale fact is due for review, not false. Time alone never retires.
      for (const path of flagged) {
        assert.equal((await row(path)).valid_to, null, path);
      }
      assert.deepEqual(await asAt(client, '2026-08-27'), [
        'shared/also-overdue.md', 'shared/overdue.md',
      ], 'both are still live');
    });

    test('leaves a retired fact out, because it is not due for review', async () => {
      await fact({ path: 'shared/overdue.md', staleAfter: '2026-01-31' });
      await retireByHuman(client, 'shared/overdue.md', '2026-03-01');

      assert.deepEqual(await stale(client, '2026-08-27'), []);
    });
  });
});
