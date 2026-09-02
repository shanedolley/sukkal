import assert from 'node:assert/strict';
import path from 'node:path';
import { after, before, beforeEach, describe, test } from 'node:test';
import type { ClientBase } from 'pg';
import { connect } from '../src/db/connect.ts';
import { down, up } from '../src/db/migrate.ts';
import { SNOOZE_DAYS, sweep } from '../src/memory/sweep.ts';

const MIGRATIONS = path.join(import.meta.dirname, '..', 'migrations');
const url = process.env['DATABASE_URL_TEST'];

/** `day` plus `n` days, as the same `YYYY-MM-DD` text. Arithmetic in UTC, so
 *  no zone shifts the answer a day west the way a local Date would. */
function addDays(day: string, n: number): string {
  const moved = new Date(`${day}T00:00:00Z`);
  moved.setUTCDate(moved.getUTCDate() + n);
  return moved.toISOString().slice(0, 10);
}

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

  /** A live fact. Both statements in one transaction, per the node registry.
   *  `entity` defaults to a name distinct from the title, so a test that does
   *  not care still gives the needs_you insert, which requires one, a value
   *  to write -- and proves entity and title are two different columns now,
   *  not the same value read twice. */
  async function fact(over: {
    path: string;
    title?: string;
    space?: string;
    entity?: string | null;
    verified?: string | null;
    staleAfter?: string | null;
  }): Promise<string> {
    await client.query('BEGIN');
    const node = await client.query<{ id: string }>(
      "INSERT INTO nodes (kind) VALUES ('fact') RETURNING id",
    );
    const id = node.rows[0]!.id;
    await client.query(
      `INSERT INTO facts (id, path, type, title, description, space, entity,
                          state, valid_from, verified, verified_by, stale_after)
       VALUES ($1, $2, 'reference', $3, 'one line', $4, $5, 'proposed',
               '2026-01-01', $6, $7, $8)`,
      [
        id,
        over.path,
        over.title ?? over.path,
        over.space ?? 'shared',
        over.entity === undefined ? 'Some Entity' : over.entity,
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

  /** Every row, closed ones included. The guard now reads closed items, so a
   *  count of the open ones alone would miss a second row opening beside a
   *  closed one. */
  async function allItems() {
    const found = await client.query<{ entity: string | null; closed_at: string | null }>(
      'SELECT entity, closed_at FROM needs_you ORDER BY id',
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
      entity: 'Priya Shah',
      staleAfter: '2026-01-31',
    });

    const [found] = await sweep(client, '2026-08-27');
    assert.equal(found!.raised, true);

    const [opened] = await openItems();
    assert.equal(opened!.kind, 'deadline');
    assert.equal(opened!.space, 'collibra');
    // entity comes from the fact's own column, not its title: the two differ
    // here on purpose, so a test that passed on the old title stand-in would
    // fail this one.
    assert.equal(opened!.entity, 'Priya Shah');
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

  test('two runs on the same day open one item, not two', async () => {
    await fact({ path: 'shared/overdue.md', staleAfter: '2026-01-31' });

    const first = await sweep(client, '2026-08-27');
    const second = await sweep(client, '2026-08-27');

    assert.equal(first[0]!.raised, true, 'the first run of the night opens an item');
    assert.equal(second[0]!.raised, false, 'the second run finds it');
    assert.equal((await allItems()).length, 1, 'one item for the one fact');
  });

  test('a due fact naming no entity opens a row, and takes none of the others down', async () => {
    await fact({ path: 'shared/no-entity.md', staleAfter: '2026-01-31', entity: null });
    await fact({ path: 'shared/has-one.md', staleAfter: '2026-02-28', entity: 'Priya Shah' });

    const found = await sweep(client, '2026-08-27');

    // Migration 010 dropped needs_you.entity's NOT NULL for this insert. With
    // it in place one entity-less fact failed the whole statement, so the run
    // raised nothing at all rather than one row less.
    assert.deepEqual(
      found.map((each) => each.raised),
      [true, true],
    );
    const items = await allItems();
    assert.deepEqual(
      items.map((item) => item.entity),
      [null, 'Priya Shah'],
    );
  });

  // -------------------------------------------------------------------------
  // An open item outlives the fact's staleness. Nothing in the codebase closes
  // a needs_you row: ADR-0017's re-confirm write moves stale_after and leaves
  // the item open, and apps/web reads only the open ones. An item left open
  // forever reads to the guard below as covering the fact's next staleness
  // too, so the fact would never be raised again.
  // -------------------------------------------------------------------------
  describe('an item whose fact has stopped being stale', () => {
    test('closes, once the fact is re-confirmed', async () => {
      await fact({ path: 'shared/overdue.md', staleAfter: '2026-01-31' });
      await sweep(client, '2026-08-27');
      assert.equal((await openItems()).length, 1);

      // ADR-0017's write: today, plus the interval the fact carries.
      await client.query(
        "UPDATE facts SET verified = '2026-08-27', stale_after = '2026-10-07' WHERE path = $1",
        ['shared/overdue.md'],
      );
      await sweep(client, '2026-08-28');

      assert.deepEqual(await openItems(), [], 'it has nothing left to ask');
    });

    test('closes, once the fact retires', async () => {
      await fact({ path: 'shared/overdue.md', staleAfter: '2026-01-31' });
      await sweep(client, '2026-08-27');
      await client.query("UPDATE facts SET valid_to = '2026-08-28' WHERE path = $1", [
        'shared/overdue.md',
      ]);

      await sweep(client, '2026-08-29');

      assert.deepEqual(await openItems(), []);
    });

    test('and the fact raises a fresh item when it next falls due', async () => {
      await fact({ path: 'shared/overdue.md', staleAfter: '2026-01-31' });
      await sweep(client, '2026-08-27');
      await client.query(
        "UPDATE facts SET verified = '2026-08-27', stale_after = '2026-10-07' WHERE path = $1",
        ['shared/overdue.md'],
      );
      await sweep(client, '2026-08-28');

      // 41 days later, past SNOOZE_DAYS, so the closed item is out of the way.
      const due = await sweep(client, '2026-10-08');

      assert.equal(due[0]!.raised, true, 'a re-confirmed fact must go stale again');
      assert.equal((await openItems()).length, 1);
    });
  });

  // -------------------------------------------------------------------------
  // Closing an item without re-confirming the fact. ADR-0017 settled the other
  // half: re-confirming moves stale_after, the fact stops being stale, and the
  // sweep never sees it again. This is the half where nothing about the fact
  // changed, and it is the one that used to re-raise the same item forever.
  // -------------------------------------------------------------------------
  describe('a closed item, on a fact nobody re-confirmed', () => {
    /** The item raised for `path`, closed on `closedOn` rather than now(), so
     *  the snooze is measured against a date the test chose. */
    async function close(closedOn: string): Promise<void> {
      await client.query("UPDATE needs_you SET closed_at = $1 WHERE kind = 'deadline'", [
        `${closedOn}T09:00:00+10:00`,
      ]);
    }

    test('does not come back the next night', async () => {
      await fact({ path: 'shared/overdue.md', staleAfter: '2026-01-31' });
      await sweep(client, '2026-08-27');
      await close('2026-08-27');

      const second = await sweep(client, '2026-08-28');

      assert.equal(second[0]!.raised, false, 'closing it must not re-raise it tomorrow');
      assert.equal((await allItems()).length, 1, 'still the one item, still closed');
    });

    test('is still quiet the night before the snooze runs out', async () => {
      await fact({ path: 'shared/overdue.md', staleAfter: '2026-01-31' });
      await sweep(client, '2026-08-27');
      await close('2026-08-27');

      const later = await sweep(client, addDays('2026-08-27', SNOOZE_DAYS - 1));

      assert.equal(later[0]!.raised, false);
    });

    test('comes back once the snooze runs out, because the fact is still stale', async () => {
      await fact({ path: 'shared/overdue.md', staleAfter: '2026-01-31' });
      await sweep(client, '2026-08-27');
      await close('2026-08-27');

      const later = await sweep(client, addDays('2026-08-27', SNOOZE_DAYS + 1));

      assert.equal(later[0]!.raised, true, 'a fact nobody dealt with is still owed a review');
      assert.equal((await allItems()).length, 2);
    });

    test('a re-confirmed fact goes quiet without waiting for the snooze', async () => {
      await fact({ path: 'shared/overdue.md', staleAfter: '2026-01-31' });
      await sweep(client, '2026-08-27');
      await close('2026-08-27');

      // What ADR-0017's write does: today, plus the interval the fact carried.
      await client.query(
        "UPDATE facts SET verified = '2026-08-27', stale_after = '2026-10-07' WHERE path = $1",
        ['shared/overdue.md'],
      );

      assert.deepEqual(await sweep(client, '2026-08-28'), [], 'it is not stale any more');
      // And once it falls due again, past the snooze, it raises a fresh item.
      const due = await sweep(client, '2026-10-08');
      assert.equal(due[0]!.raised, true);
    });
  });
});
