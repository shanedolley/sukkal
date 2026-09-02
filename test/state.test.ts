import assert from 'node:assert/strict';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import type { ClientBase } from 'pg';
import { connect } from '../src/db/connect.ts';
import { down, readMigrations, up } from '../src/db/migrate.ts';
import { type FactRow, factState } from '../src/memory/state.ts';

const MIGRATIONS = path.join(import.meta.dirname, '..', 'migrations');

describe('factState', () => {
  /** A candidate with nothing else set, so a test only overrides what it means to check. */
  function row(over: Partial<FactRow> = {}): FactRow {
    return { state: 'candidate', verified: null, stale_after: null, valid_to: null, ...over };
  }

  test('a stored state reads back unchanged while nothing has happened', () => {
    assert.equal(factState(row({ state: 'candidate' }), '2026-08-27'), 'candidate');
    assert.equal(factState(row({ state: 'proposed' }), '2026-08-27'), 'proposed');
    assert.equal(factState(row({ state: 'rejected' }), '2026-08-27'), 'rejected');
  });

  test('verified reads verified once the date is set, with no review date', () => {
    assert.equal(factState(row({ verified: '2026-08-01' }), '2026-08-27'), 'verified');
  });

  describe('staleness, at its boundary', () => {
    test('is not yet stale on the day stale_after falls', () => {
      const fact = row({ verified: '2026-01-01', stale_after: '2026-08-27' });
      assert.equal(factState(fact, '2026-08-27'), 'verified');
    });

    test('is stale the day after stale_after falls', () => {
      const fact = row({ verified: '2026-01-01', stale_after: '2026-08-26' });
      assert.equal(factState(fact, '2026-08-27'), 'stale');
    });
  });

  test('an unverified fact never reads stale, however old stale_after is', () => {
    const fact = row({ verified: null, stale_after: '2020-01-01' });
    assert.equal(factState(fact, '2026-08-27'), 'candidate');
  });

  test('retired settles it whatever stale_after says', () => {
    // A row that would otherwise read stale for a year yet: the old model
    // allowed this contradiction, and this row cannot express it any more.
    const fact = row({ verified: '2020-01-01', stale_after: '2020-02-01', valid_to: '2026-08-27' });
    assert.equal(factState(fact, '2027-08-27'), 'retired');
  });

  test('retired settles it even past valid_to, with verified still set', () => {
    // The other contradiction the old model allowed: a row reading verified
    // with a valid_to in the past.
    const fact = row({ verified: '2026-01-01', valid_to: '2026-06-01' });
    assert.equal(factState(fact, '2026-08-27'), 'retired');
  });
});

const url = process.env['DATABASE_URL_TEST'];

describe('the fact_state migration', { skip: url ? false : 'DATABASE_URL_TEST is unset' }, () => {
  let client: ClientBase & { end: () => Promise<void> };

  async function factStateShape() {
    const columns = await client.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'facts' AND column_name IN ('state', 'status')`,
    );
    const values = await client.query<{ enumlabel: string }>(
      `SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'fact_state' ORDER BY e.enumsortorder`,
    );
    const oldType = await client.query('SELECT 1 FROM pg_type WHERE typname = $1', [
      'fact_status',
    ]);
    return {
      columns: columns.rows.map((r) => r.column_name).sort(),
      values: values.rows.map((r) => r.enumlabel),
      oldTypeGone: oldType.rows.length === 0,
    };
  }

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

  test('facts.state replaces facts.status, holding the three stored values', async () => {
    const shape = await factStateShape();
    assert.deepEqual(shape.columns, ['state']);
    assert.deepEqual(shape.values, ['candidate', 'proposed', 'rejected']);
    assert.ok(shape.oldTypeGone, 'fact_status should be dropped');
  });

  test('reverses cleanly: down then up leaves the same shape', async () => {
    await down(client, MIGRATIONS);
    await up(client, MIGRATIONS);
    assert.deepEqual(await factStateShape(), {
      columns: ['state'],
      values: ['candidate', 'proposed', 'rejected'],
      oldTypeGone: true,
    });
  });

  test('refuses to run against a facts table holding rows, and names KPA-5', async () => {
    const migration = (await readMigrations(MIGRATIONS)).find((m) =>
      m.name.includes('fact_state'),
    );
    assert.ok(migration, 'expected a fact_state migration file');

    await client.query('BEGIN');
    await client.query(migration.down);

    const node = await client.query<{ id: string }>(
      "INSERT INTO nodes (kind) VALUES ('fact') RETURNING id",
    );
    await client.query(
      `INSERT INTO facts (id, path, type, title, description, space, status)
       VALUES ($1, 'blocked.md', 'reference', 't', 'd', 'shared', 'stable')`,
      [node.rows[0]!.id],
    );

    await assert.rejects(client.query(migration.up), /KPA-5/);
    await client.query('ROLLBACK');
  });
});
