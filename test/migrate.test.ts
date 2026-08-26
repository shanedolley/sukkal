import assert from 'node:assert/strict';
import path from 'node:path';
import { after, before, beforeEach, describe, test } from 'node:test';
import type { ClientBase } from 'pg';
import { connect, down, readMigrations, up } from '../src/db/migrate.ts';

const FIXTURES = path.join(import.meta.dirname, 'fixtures');
const OK = path.join(FIXTURES, 'migrations-ok');
const BAD = path.join(FIXTURES, 'migrations-bad');

/** Every table the tests create. Dropping these, rather than the schema,
 *  leaves the pgvector extension in place. */
const SCRATCH = ['schema_migrations', 'widgets', 'gadgets', 'squatter'];

describe('readMigrations', () => {
  test('splits each file on the marker and orders by filename', async () => {
    const migrations = await readMigrations(OK);

    assert.deepEqual(migrations.map((m) => m.name), ['001-widgets.sql', '002-gadgets.sql']);
    assert.match(migrations[0]!.up, /^CREATE TABLE widgets/);
    assert.equal(migrations[0]!.down, 'DROP TABLE widgets;');
  });

  test('rejects a file with no marker', async () => {
    await assert.rejects(readMigrations(BAD), /expected one "-- @down" line, found 0/);
  });
});

const url = process.env['DATABASE_URL_TEST'];

describe('the runner against Postgres', { skip: url ? false : 'DATABASE_URL_TEST is unset' }, () => {
  let client: ClientBase & { end: () => Promise<void> };

  async function relations(): Promise<string[]> {
    const result = await client.query<{ relname: string }>(`
      SELECT c.relname
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'S')
       ORDER BY c.relname
    `);
    return result.rows.map((row) => row.relname);
  }

  before(async () => {
    client = connect(url!);
    await client.connect();

    // The migration database holds the real facts. Tests never touch it.
    const current = await client.query<{ name: string }>('SELECT current_database() AS name');
    assert.notEqual(current.rows[0]?.name, 'kpa', 'tests must run against kpa_dev, never kpa');
  });

  after(async () => {
    await client.query(`DROP TABLE IF EXISTS ${SCRATCH.join(', ')} CASCADE`);
    await client.end();
  });

  beforeEach(async () => {
    await client.query(`DROP TABLE IF EXISTS ${SCRATCH.join(', ')} CASCADE`);
  });

  test('up applies every migration in order and records each one', async () => {
    assert.deepEqual(await up(client, OK), ['001-widgets.sql', '002-gadgets.sql']);
    assert.deepEqual(await relations(), [
      'gadgets', 'gadgets_id_seq', 'schema_migrations', 'widgets', 'widgets_id_seq',
    ]);

    const recorded = await client.query<{ name: string }>(
      'SELECT name FROM schema_migrations ORDER BY name',
    );
    assert.deepEqual(recorded.rows.map((row) => row.name), [
      '001-widgets.sql', '002-gadgets.sql',
    ]);
  });

  test('a second up refuses and names what it found', async () => {
    await up(client, OK);
    await assert.rejects(
      up(client, OK),
      /nothing to apply: 2 migration\(s\) already recorded: 001-widgets\.sql, 002-gadgets\.sql/,
    );
  });

  test('up refuses a database holding relations it did not create', async () => {
    await client.query('CREATE TABLE squatter (id int)');
    await assert.rejects(
      up(client, OK),
      /refusing to migrate: schema "public" already holds 1 relation\(s\).*squatter/s,
    );
  });

  test('down reverses everything and leaves the database empty', async () => {
    await up(client, OK);
    assert.deepEqual(await down(client, OK), ['002-gadgets.sql', '001-widgets.sql']);
    assert.deepEqual(await relations(), []);
  });

  test('down on an unmigrated database is a no-op', async () => {
    assert.deepEqual(await down(client, OK), []);
    assert.deepEqual(await relations(), []);
  });

  test('a failing migration leaves no half-applied state', async () => {
    const broken = path.join(FIXTURES, 'migrations-broken');
    await assert.rejects(up(client, broken), /002-broken\.sql: syntax error/);
    assert.deepEqual(await relations(), ['schema_migrations', 'widgets', 'widgets_id_seq']);
  });
});
