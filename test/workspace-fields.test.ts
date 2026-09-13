import assert from 'node:assert/strict';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import type { ClientBase } from 'pg';
// The constants the interface reads, imported rather than retyped: a
// transcription here would agree with itself and prove nothing about the seed.
import { WORKSPACE_FIELDS } from '../apps/web/lib/fixtures.ts';
import { WORKSPACES } from '../apps/web/lib/workspaces.ts';
import { connect, refuseProduction } from '../src/db/connect.ts';
import { down, up } from '../src/db/migrate.ts';

const MIGRATIONS = path.join(import.meta.dirname, '..', 'migrations');
const url = process.env['DATABASE_URL_TEST'];

/** Every column, constraint and comment on the table, as text. */
const SHAPE = `
  SELECT 'column: ' || column_name || ' ' || data_type || ' ' || is_nullable
         || ' ' || coalesce(column_default, '(no default)')
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'workspace_fields'
   UNION ALL
  SELECT 'constraint: ' || conname || ' ' || pg_get_constraintdef(oid)
    FROM pg_constraint WHERE conrelid = 'workspace_fields'::regclass
   UNION ALL
  SELECT 'comment: ' || coalesce(obj_description('workspace_fields'::regclass), '(none)')
   ORDER BY 1
`;

/** The rule `missingFields` applies in the browser, written as SQL. Migration
 *  021 quotes this, and KPA-127 is where the interface asks it instead. */
const MISSING = `
  SELECT id FROM workspace_fields
   WHERE workspace = $1 AND required
     AND coalesce(btrim($2::jsonb ->> id), '') = ''
   ORDER BY id
`;

interface FieldRow {
  workspace: string;
  id: string;
  jira_id: string;
  name: string;
  required: boolean;
}

describe('a workspace and its custom fields', { skip: url ? false : 'DATABASE_URL_TEST is unset' }, () => {
  let client: ClientBase & { end: () => Promise<void> };

  /** Runs `body` and undoes everything it wrote, a raised exception included.
   *  Several tests break a constraint to prove it binds, and the seeded rows
   *  have to survive all of them. */
  async function rolledBack(body: () => Promise<void>): Promise<void> {
    await client.query('BEGIN');
    try {
      await body();
    } finally {
      await client.query('ROLLBACK');
    }
  }

  async function fieldRows(): Promise<FieldRow[]> {
    const rows = await client.query<FieldRow>(
      'SELECT workspace, id, jira_id, name, required FROM workspace_fields ORDER BY workspace, id',
    );
    return rows.rows;
  }

  async function missing(workspace: string, values: Record<string, string>): Promise<string[]> {
    const rows = await client.query<{ id: string }>(MISSING, [workspace, JSON.stringify(values)]);
    return rows.rows.map((row) => row.id);
  }

  before(async () => {
    client = connect('DATABASE_URL_TEST');
    await client.connect();
    await refuseProduction(client);
    await down(client, MIGRATIONS);
    await up(client, MIGRATIONS);
  });

  after(async () => {
    await down(client, MIGRATIONS);
    await client.end();
  });

  test('every field the fixture holds is seeded, under the workspace id', async () => {
    // The fixture keys on the name and the table keys on the id, so building
    // the expectation walks the same translation the interface now makes.
    const expected = WORKSPACES.flatMap((workspace) =>
      (WORKSPACE_FIELDS[workspace.name] ?? []).map((field) => ({
        workspace: workspace.id,
        id: field.id,
        name: field.name,
        required: field.required,
      })),
    );
    assert.equal(expected.length, 2, 'the fixture no longer holds two fields');

    assert.deepEqual(
      (await fieldRows()).map(({ workspace, id, name, required }) => ({
        workspace,
        id,
        name,
        required,
      })),
      expected,
    );
  });

  test('a field carries the tracker id beside the slug, and it is not the slug', async () => {
    const rows = await fieldRows();
    assert.deepEqual(
      rows.map((row) => [row.id, row.jira_id]),
      [
        ['customer', 'customfield_14849'],
        ['engagement', 'customfield_14850'],
      ],
    );
    for (const row of rows) {
      assert.notEqual(row.jira_id, row.id, `${row.id} files itself under its own slug`);
    }
  });

  test('a slug in the tracker column is refused, because no rule derives one', async () => {
    await rolledBack(async () => {
      await assert.rejects(
        () =>
          client.query(
            `INSERT INTO workspace_fields (workspace, id, jira_id, name)
             VALUES ('collibra', 'severity', 'severity', 'Severity')`,
          ),
        /workspace_fields_jira_id_is_a_custom_field/,
      );
    });
  });

  test('renaming a field moves the name and neither identifier', async () => {
    await rolledBack(async () => {
      await client.query(
        `UPDATE workspace_fields SET name = 'Client'
          WHERE workspace = 'collibra' AND id = 'customer'`,
      );
      const rows = await client.query<FieldRow>(
        `SELECT workspace, id, jira_id, name, required FROM workspace_fields
          WHERE name = 'Client'`,
      );
      assert.equal(rows.rows[0]?.id, 'customer');
      assert.equal(rows.rows[0]?.jira_id, 'customfield_14849');
      assert.equal(rows.rows[0]?.required, true);
    });
  });

  test('renaming a workspace orphans none of its fields', async () => {
    await rolledBack(async () => {
      await client.query(`UPDATE workspaces SET name = 'Collibra APAC' WHERE id = 'collibra'`);
      const kept = await client.query<FieldRow>(
        `SELECT f.workspace, f.id, f.jira_id, f.name, f.required
           FROM workspace_fields f JOIN workspaces w ON w.id = f.workspace
          WHERE w.name = 'Collibra APAC' ORDER BY f.id`,
      );
      assert.deepEqual(
        kept.rows.map((row) => row.id),
        ['customer', 'engagement'],
      );
    });
  });

  test('the required rule answers as a query', async () => {
    // Empty, blank and absent all leave the field unfilled, which is what
    // `missingFields` means by its trim.
    assert.deepEqual(await missing('collibra', {}), ['customer']);
    assert.deepEqual(await missing('collibra', { customer: '   ' }), ['customer']);
    assert.deepEqual(await missing('collibra', { customer: '' }), ['customer']);
    // Engagement is optional, so leaving it out never blocks the filing.
    assert.deepEqual(await missing('collibra', { customer: 'Sydney Water' }), []);
    // A workspace carrying no field required of it can always be filed.
    assert.deepEqual(await missing('koinon-engineering', {}), []);
  });

  test('a field names a workspace that exists', async () => {
    await rolledBack(async () => {
      await assert.rejects(
        () =>
          client.query(
            `INSERT INTO workspace_fields (workspace, id, jira_id, name)
             VALUES ('no-such-workspace', 'team', 'customfield_13600', 'Team')`,
          ),
        /workspace_fields_workspace_fkey/,
      );
    });
  });

  test('two slugs cannot point at one Jira field, and two workspaces can', async () => {
    await rolledBack(async () => {
      await assert.rejects(
        () =>
          client.query(
            `INSERT INTO workspace_fields (workspace, id, jira_id, name)
             VALUES ('collibra', 'client', 'customfield_14849', 'Client')`,
          ),
        /workspace_fields_workspace_jira_id_key/,
      );
    });
    // The key is the pair, so the same field on a second tracker is a second
    // row rather than a clash.
    await rolledBack(async () => {
      await client.query(
        `INSERT INTO workspace_fields (workspace, id, jira_id, name)
         VALUES ('koinon-engineering', 'customer', 'customfield_14849', 'Customer')`,
      );
      const rows = await client.query<FieldRow>(
        `SELECT workspace, id, jira_id, name, required FROM workspace_fields
          WHERE id = 'customer' ORDER BY workspace`,
      );
      assert.equal(rows.rows.length, 2);
      assert.equal(rows.rows[0]?.required, true, 'the seeded row lost its own rule');
      assert.equal(rows.rows[1]?.required, false, 'a new field starts optional');
    });
  });

  test('removing a workspace takes its fields with it', async () => {
    await rolledBack(async () => {
      // Its own workspace, because the three seeded ones hold projects and a
      // project refuses to be taken.
      await client.query(`INSERT INTO workspaces (id, name) VALUES ('acme', 'Acme')`);
      await client.query(
        `INSERT INTO workspace_fields (workspace, id, jira_id, name)
         VALUES ('acme', 'team', 'customfield_13600', 'Team')`,
      );
      await client.query(`DELETE FROM workspaces WHERE id = 'acme'`);
      const left = await client.query(`SELECT 1 FROM workspace_fields WHERE workspace = 'acme'`);
      assert.equal(left.rowCount, 0);
    });
  });

  test('down then up returns the schema and the seed to what they were', async () => {
    const shape = await client.query<{ line: string }>(SHAPE);
    const fields = await fieldRows();

    await down(client, MIGRATIONS);
    await up(client, MIGRATIONS);

    assert.deepEqual((await client.query<{ line: string }>(SHAPE)).rows, shape.rows);
    assert.ok(shape.rows.length > 0);
    assert.deepEqual(await fieldRows(), fields);
  });
});
