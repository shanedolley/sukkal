// KPA-65: facts gains the entity column the briefing groups every queue by.
// ADR-0014 decides its shape -- plain text, not a foreign key into entities
// -- and this file checks that shape, not sweep.ts's use of it, which
// test/sweep.test.ts already covers.

import assert from 'node:assert/strict';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import type { ClientBase } from 'pg';
import { connect } from '../src/db/connect.ts';
import { down, readMigrations, up } from '../src/db/migrate.ts';

const MIGRATIONS = path.join(import.meta.dirname, '..', 'migrations');
const url = process.env['DATABASE_URL_TEST'];

describe('facts.entity', { skip: url ? false : 'DATABASE_URL_TEST is unset' }, () => {
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

  test('is text, and nullable, so every writer that names no entity still inserts', async () => {
    const columns = await client.query<{ data_type: string; is_nullable: string }>(`
      SELECT data_type, is_nullable FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'facts' AND column_name = 'entity'
    `);
    assert.equal(columns.rows.length, 1, 'facts.entity should exist');
    assert.equal(columns.rows[0]!.data_type, 'text');
    assert.equal(columns.rows[0]!.is_nullable, 'YES');
  });

  test('carries no foreign key: ADR-0014 chose text over a reference into entities', async () => {
    const foreignKeys = await client.query(`
      SELECT tc.constraint_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON kcu.constraint_name = tc.constraint_name
       WHERE tc.table_name = 'facts' AND tc.constraint_type = 'FOREIGN KEY'
         AND kcu.column_name = 'entity'
    `);
    assert.deepEqual(foreignKeys.rows, []);
  });

  test('a fact insert naming no entity still succeeds, unlisted columns default to null', async () => {
    await client.query('BEGIN');
    const node = await client.query<{ id: string }>("INSERT INTO nodes (kind) VALUES ('fact') RETURNING id");
    const id = node.rows[0]!.id;
    await client.query(
      `INSERT INTO facts (id, path, type, title, description, space, state, valid_from)
       VALUES ($1, 'shared/no-entity.md', 'reference', 'title', 'one line', 'shared', 'proposed', '2026-01-01')`,
      [id],
    );
    const found = await client.query<{ entity: string | null }>('SELECT entity FROM facts WHERE id = $1', [id]);
    assert.equal(found.rows[0]!.entity, null);
    await client.query('ROLLBACK');
  });

  test('refuses to apply while needs_you already holds a row it cannot correct', async () => {
    // Every needs_you row up to today came from sweep.ts's stand-in bug, so
    // migration 010 refuses to run over one rather than guess the real
    // entity. Reproduce that by applying every migration except 010, seeding
    // one row by hand, then letting 010 run into it.
    await down(client, MIGRATIONS);
    const files = await readMigrations(MIGRATIONS);
    const before010 = files.filter((file) => file.name < '010_fact_entity.sql');

    await client.query(
      'CREATE TABLE schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
    );
    for (const migration of before010) {
      await client.query(migration.up);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [migration.name]);
    }

    await client.query(
      "INSERT INTO needs_you (kind, title, detail, space, entity) VALUES ('draft', 'x', 'y', 'shared', 'placeholder')",
    );

    await assert.rejects(() => up(client, MIGRATIONS), /needs_you already holds/);

    // A no-op table applies cleanly: clear the seeded row and let 010 land.
    await client.query('DELETE FROM needs_you');
    await up(client, MIGRATIONS);

    const columns = await client.query(`
      SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'facts' AND column_name = 'entity'
    `);
    assert.equal(columns.rows.length, 1, '010 applied once the guard cleared');
  });

  test('reverses: down drops the column, a fresh up brings it back', async () => {
    await down(client, MIGRATIONS);

    const gone = await client.query(`
      SELECT to_regclass('public.facts') AS relid
    `);
    assert.equal(gone.rows[0]!.relid, null, 'down reverses every migration, facts included');

    await up(client, MIGRATIONS);

    const back = await client.query(`
      SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'facts' AND column_name = 'entity'
    `);
    assert.equal(back.rows.length, 1);
  });
});
