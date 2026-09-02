import assert from 'node:assert/strict';
import path from 'node:path';
import { after, before, beforeEach, describe, test } from 'node:test';
import type { ClientBase } from 'pg';
import { connect } from '../src/db/connect.ts';
import { down, up } from '../src/db/migrate.ts';
import { sweep } from '../src/memory/sweep.ts';

const MIGRATIONS = path.join(import.meta.dirname, '..', 'migrations');
const url = process.env['DATABASE_URL_TEST'];

describe('the staleness sweep', { skip: url ? false : 'DATABASE_URL_TEST is unset' }, () => {
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
    await client.query('DELETE FROM needs_you');
    await client.query('DELETE FROM edges');
    await client.query('DELETE FROM facts');
    await client.query("DELETE FROM nodes WHERE kind = 'fact'");
  });

  /** A live fact. Both statements in one transaction, per the node registry. */
  async function fact(over: {
    path: string;
    title?: string;
    space?: string;
    verified?: string | null;
    staleAfter?: string | null;
  }): Promise<string> {
    await client.query('BEGIN');
    const node = await client.query<{ id: string }>(
      "INSERT INTO nodes (kind) VALUES ('fact') RETURNING id",
    );
    const id = node.rows[0]!.id;
    await client.query(
      `INSERT INTO facts (id, path, type, title, description, space, state,
                          valid_from, verified, verified_by, stale_after)
       VALUES ($1, $2, 'reference', $3, 'one line', $4, 'proposed',
               '2026-01-01', $5, $6, $7)`,
      [
        id,
        over.path,
        over.title ?? over.path,
        over.space ?? 'shared',
        over.verified === undefined ? '2026-01-01' : over.verified,
        over.verified === null ? null : 'human:shane',
        over.staleAfter ?? null,
      ],
    );
    await client.query('COMMIT');
    return id;
  }

  async function row(path: string) {
    const found = await client.query<{ valid_to: string | null }>(
      'SELECT valid_to FROM facts WHERE path = $1',
      [path],
    );
    return found.rows[0]!;
  }

  async function openItems() {
    const found = await client.query<{
      kind: string;
      title: string;
      detail: string;
      space: string;
      entity: string;
      fact_id: string;
    }>(
      `SELECT kind, title, detail, space, entity, fact_id
         FROM needs_you WHERE closed_at IS NULL ORDER BY id`,
    );
    return found.rows;
  }

  test('lists every stale fact, oldest first', async () => {
    await fact({ path: 'shared/overdue.md', staleAfter: '2026-01-31' });
    await fact({ path: 'shared/also-overdue.md', staleAfter: '2026-02-28' });
    await fact({ path: 'shared/not-yet.md', staleAfter: '2027-01-01' });
    await fact({ path: 'shared/never-rots.md' });

    const found = await sweep(client, '2026-08-27');

    assert.deepEqual(
      found.map((f) => f.path),
      ['shared/overdue.md', 'shared/also-overdue.md'],
    );
  });

  describe('the boundary', () => {
    test('a fact whose stale_after is today is not yet stale', async () => {
      await fact({ path: 'shared/due-today.md', staleAfter: '2026-08-27' });

      assert.deepEqual(await sweep(client, '2026-08-27'), []);
    });

    test('a fact whose stale_after was yesterday is stale', async () => {
      await fact({ path: 'shared/due-yesterday.md', staleAfter: '2026-08-26' });

      const found = await sweep(client, '2026-08-27');

      assert.deepEqual(
        found.map((f) => f.path),
        ['shared/due-yesterday.md'],
      );
    });
  });

  test('an unverified fact never reads stale, however overdue', async () => {
    await fact({ path: 'shared/never-verified.md', staleAfter: '2020-01-01', verified: null });

    assert.deepEqual(await sweep(client, '2026-08-27'), []);
  });

  test('a retired fact is not due for review', async () => {
    await fact({ path: 'shared/retired.md', staleAfter: '2026-01-31' });
    await client.query("UPDATE facts SET valid_to = '2026-03-01' WHERE path = $1", [
      'shared/retired.md',
    ]);

    assert.deepEqual(await sweep(client, '2026-08-27'), []);
  });

  test('never sets valid_to on anything it flags', async () => {
    await fact({ path: 'shared/overdue.md', staleAfter: '2026-01-31' });

    await sweep(client, '2026-08-27');

    assert.equal((await row('shared/overdue.md')).valid_to, null);
  });

  test('raises a needs_you item of kind deadline, closed by setting closed_at', async () => {
    await fact({
      path: 'shared/overdue.md',
      title: 'Priya moves teams',
      space: 'collibra',
      staleAfter: '2026-01-31',
    });

    const [found] = await sweep(client, '2026-08-27');
    assert.equal(found!.raised, true);

    const [opened] = await openItems();
    assert.equal(opened!.kind, 'deadline');
    assert.equal(opened!.space, 'collibra');
    assert.equal(opened!.entity, 'Priya moves teams');
    assert.match(opened!.title, /Priya moves teams/);
    assert.match(opened!.detail, /2026-01-31/);
    assert.equal(opened!.fact_id, found!.id);
  });

  test('does not raise a second item for a fact an open one already names', async () => {
    await fact({ path: 'shared/overdue.md', staleAfter: '2026-01-31' });

    const first = await sweep(client, '2026-08-27');
    assert.equal(first[0]!.raised, true, 'the first night opens an item');

    const second = await sweep(client, '2026-08-28');
    assert.equal(second[0]!.raised, false, 'the second night finds one already open');

    const items = await openItems();
    assert.equal(items.length, 1, 'only one open item for the one fact');
  });

  test('raises again once the open item has closed', async () => {
    await fact({ path: 'shared/overdue.md', staleAfter: '2026-01-31' });

    await sweep(client, '2026-08-27');
    await client.query("UPDATE needs_you SET closed_at = now() WHERE kind = 'deadline'");

    const second = await sweep(client, '2026-08-28');
    assert.equal(second[0]!.raised, true, 'closing the old item clears the way for a new one');
  });
});
