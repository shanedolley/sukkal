import assert from 'node:assert/strict';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import type { ClientBase } from 'pg';
import { connect } from '../src/db/connect.ts';
import { down, up } from '../src/db/migrate.ts';

const MIGRATIONS = path.join(import.meta.dirname, '..', 'migrations');
const url = process.env['DATABASE_URL_TEST'];

/** What a sync reads from Salesforce writes, one date at a time. The clause
 *  is the whole rule: it passes over a date somebody typed, and it fills a
 *  date nobody has set, because null is distinct from 'typed'. */
const SYNC_START = `
  UPDATE projects
     SET contract_start = $2, contract_start_source = 'salesforce'
   WHERE id = $1 AND contract_start_source IS DISTINCT FROM 'typed'
`;

const SYNC_END = `
  UPDATE projects
     SET contract_end = $2, contract_end_source = 'salesforce'
   WHERE id = $1 AND contract_end_source IS DISTINCT FROM 'typed'
`;

interface ContractRow {
  description: string | null;
  contract_start: string | null;
  contract_start_source: string | null;
  contract_end: string | null;
  contract_end_source: string | null;
}

describe(
  "a project's contract",
  { skip: url ? false : 'DATABASE_URL_TEST is unset' },
  () => {
    let client: ClientBase & { end: () => Promise<void> };

    /** Runs `body` and undoes everything it wrote, a raised exception
     *  included. Several tests break a constraint to prove it binds, and the
     *  seeded projects have to survive all of them. */
    async function rolledBack(body: () => Promise<void>): Promise<void> {
      await client.query('BEGIN');
      try {
        await body();
      } finally {
        await client.query('ROLLBACK');
      }
    }

    async function contract(id: string): Promise<ContractRow> {
      const rows = await client.query<ContractRow>(
        `SELECT description, contract_start, contract_start_source,
                contract_end, contract_end_source
           FROM projects WHERE id = $1`,
        [id],
      );
      assert.ok(rows.rows[0], `no project ${id}`);
      return rows.rows[0];
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

    test('a project starts with no contract and no description', async () => {
      assert.deepEqual(await contract('bhp-meridian'), {
        description: null,
        contract_start: null,
        contract_start_source: null,
        contract_end: null,
        contract_end_source: null,
      });
    });

    test('a contract date comes back as text, not a Date', async () => {
      await rolledBack(async () => {
        await client.query(
          `UPDATE projects SET contract_start = '2026-06-08', contract_start_source = 'typed'
            WHERE id = 'bhp-meridian'`,
        );
        const row = await contract('bhp-meridian');
        // A Date would sit at local midnight, and reading it back as UTC moves
        // a Sydney start a day west. The day the contract names has no time
        // zone, so it stays the text Postgres sent.
        assert.equal(typeof row.contract_start, 'string');
        assert.equal(row.contract_start, '2026-06-08');
      });
    });

    test('a sync writes over a date Salesforce sent and leaves one Shane typed', async () => {
      await rolledBack(async () => {
        await client.query(
          `UPDATE projects
              SET contract_start = '2026-06-08', contract_start_source = 'typed',
                  contract_end   = '2027-06-07', contract_end_source   = 'salesforce'
            WHERE id = 'bhp-meridian'`,
        );

        const start = await client.query(SYNC_START, ['bhp-meridian', '2026-01-05']);
        const end = await client.query(SYNC_END, ['bhp-meridian', '2028-01-05']);
        assert.equal(start.rowCount, 0, 'the sync wrote over a typed start');
        assert.equal(end.rowCount, 1);

        const row = await contract('bhp-meridian');
        assert.equal(row.contract_start, '2026-06-08');
        assert.equal(row.contract_start_source, 'typed');
        assert.equal(row.contract_end, '2028-01-05');
        assert.equal(row.contract_end_source, 'salesforce');
      });
    });

    test('a sync fills a date nobody has set', async () => {
      await rolledBack(async () => {
        await client.query(SYNC_START, ['sydney-water', '2026-03-02']);
        const row = await contract('sydney-water');
        assert.equal(row.contract_start, '2026-03-02');
        assert.equal(row.contract_start_source, 'salesforce');
      });
    });

    test('an end before a start is refused', async () => {
      await rolledBack(async () => {
        await assert.rejects(
          () =>
            client.query(
              `UPDATE projects
                  SET contract_start = '2026-06-08', contract_start_source = 'typed',
                      contract_end   = '2026-06-07', contract_end_source   = 'typed'
                WHERE id = 'bhp-meridian'`,
            ),
          /projects_contract_end_follows_start/,
        );
      });
    });

    test('a contract of one day is allowed, because the check refuses less', async () => {
      await rolledBack(async () => {
        await client.query(
          `UPDATE projects
              SET contract_start = '2026-06-08', contract_start_source = 'typed',
                  contract_end   = '2026-06-08', contract_end_source   = 'typed'
            WHERE id = 'bhp-meridian'`,
        );
        const row = await contract('bhp-meridian');
        assert.equal(row.contract_end, '2026-06-08');
      });
    });

    test('a date naming no source is refused, and so is a source naming no date', async () => {
      await rolledBack(async () => {
        await assert.rejects(
          () =>
            client.query(
              `UPDATE projects SET contract_start = '2026-06-08' WHERE id = 'bhp-meridian'`,
            ),
          /projects_contract_start_names_its_source/,
        );
      });
      // A refused statement aborts the transaction, so the second one needs
      // its own.
      await rolledBack(async () => {
        await assert.rejects(
          () =>
            client.query(
              `UPDATE projects SET contract_end_source = 'typed' WHERE id = 'bhp-meridian'`,
            ),
          /projects_contract_end_names_its_source/,
        );
      });
    });

    test('a source Salesforce does not offer is refused', async () => {
      await rolledBack(async () => {
        await assert.rejects(
          () =>
            client.query(
              `UPDATE projects
                  SET contract_start = '2026-06-08', contract_start_source = 'certinia'
                WHERE id = 'bhp-meridian'`,
            ),
          /contract_date_source/,
        );
      });
    });

    test('a description is stored, and an empty one is refused', async () => {
      await rolledBack(async () => {
        await client.query(
          `UPDATE projects SET description = 'Lineage uplift.' WHERE id = 'sydney-water'`,
        );
        assert.equal((await contract('sydney-water')).description, 'Lineage uplift.');

        await assert.rejects(
          () => client.query(`UPDATE projects SET description = '  ' WHERE id = 'sydney-water'`),
          /projects_description_says_something/,
        );
      });
    });
  },
);
