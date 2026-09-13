import assert from 'node:assert/strict';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import pg, { type ClientBase } from 'pg';
import {
  readProjects,
  readWorkspaceFields,
  writeProject,
  writeWorkspaceFields,
} from '../apps/web/lib/tree.ts';
import { connect, connectionString, refuseProduction } from '../src/db/connect.ts';
import { down, up } from '../src/db/migrate.ts';

// What the web tier reads and writes on the project tree.
//
// KPA-127 moves the contract dates and the custom fields out of
// `localStorage`, so four claims now rest on this module and three of them are
// silent when they break.
//
// A rename leaves the fields where they are. That is the story's own criterion
// and the reason migration 018 made the id a slug and the name a column.
//
// A typed date names itself typed. Migration 020 makes that the difference
// between a date a Salesforce sync overwrites and one it leaves alone.
//
// A label is written only where a label decides. `projects_match_one_way`
// allows one match rule per row, so writing the settings form's label onto a
// project matched by its key prefix would break the row.
//
// An unknown key writes nothing. The project settings screen still sends a
// project's display name where a workspace id belongs, which KPA-140 asks
// Shane about, so the refusal has to leave the table as it was.

const MIGRATIONS = path.join(import.meta.dirname, '..', 'migrations');
const url = process.env['DATABASE_URL_TEST'];

describe(
  'the project tree, as the web tier reads it',
  { skip: url ? false : 'DATABASE_URL_TEST is unset' },
  () => {
    let client: ClientBase & { end: () => Promise<void> };
    let pool: pg.Pool;

    before(async () => {
      client = connect('DATABASE_URL_TEST');
      await client.connect();
      await refuseProduction(client);
      await down(client, MIGRATIONS);
      await up(client, MIGRATIONS);
      // The module takes a pool, as every read in that tier does. Importing
      // `connect.ts` is also what sets the date parser, so a `date` arrives as
      // 'YYYY-MM-DD' text here exactly as it does in the browser.
      pool = new pg.Pool({ connectionString: connectionString('DATABASE_URL_TEST') });
    });

    after(async () => {
      await pool.end();
      await down(client, MIGRATIONS);
      await client.end();
    });

    test('every seeded project reads, and a key-prefix project falls back to its id', async () => {
      const projects = await readProjects(pool);
      assert.deepEqual(
        Object.keys(projects).sort(),
        ['bhp-meridian', 'kpa', 'mp', 'ms', 'sydney-water', 'transport-for-nsw'],
      );
      // Migration 018 seeded the label on the three Collibra projects.
      assert.equal(projects['bhp-meridian']?.label, 'bhp-meridian');
      // MP matches by key prefix and holds no label, so the id stands in, the
      // way the browser's own fallback used to.
      assert.equal(projects['mp']?.label, 'mp');
      // Migration 020 added the columns and seeded no date.
      assert.equal(projects['bhp-meridian']?.start, null);
      assert.equal(projects['bhp-meridian']?.end, null);
    });

    test('a typed date names itself typed, and comes back as text', async () => {
      assert.equal(
        await writeProject(pool, 'sydney-water', {
          label: 'sydney-water',
          start: '2026-03-02',
          end: '2026-11-27',
        }),
        true,
      );

      const projects = await readProjects(pool);
      assert.equal(projects['sydney-water']?.start, '2026-03-02');
      assert.equal(projects['sydney-water']?.end, '2026-11-27');

      const row = await client.query<{ s: string | null; e: string | null }>(
        `SELECT contract_start_source::text AS s, contract_end_source::text AS e
           FROM projects WHERE id = 'sydney-water'`,
      );
      assert.equal(row.rows[0]?.s, 'typed');
      assert.equal(row.rows[0]?.e, 'typed');
    });

    test('a cleared date clears its source with it', async () => {
      await writeProject(pool, 'sydney-water', {
        label: 'sydney-water',
        start: null,
        end: null,
      });

      const row = await client.query<{ s: string | null; e: string | null }>(
        `SELECT contract_start_source::text AS s, contract_end_source::text AS e
           FROM projects WHERE id = 'sydney-water'`,
      );
      // `projects_contract_start_names_its_source` requires the pair, so a
      // null date with a source left behind would be refused rather than
      // stored.
      assert.equal(row.rows[0]?.s, null);
      assert.equal(row.rows[0]?.e, null);
    });

    test('a label reaches a project the label decides, and no other', async () => {
      await writeProject(pool, 'bhp-meridian', {
        label: 'meridian-2027',
        start: null,
        end: null,
      });
      // The settings form offers the box on every project, and `inProject`
      // ignores what it holds on one matched by its key prefix. Writing it
      // there would break `projects_match_one_way`.
      await writeProject(pool, 'mp', { label: 'anything', start: null, end: null });

      const rows = await client.query<{ id: string; l: string | null; k: string | null }>(
        `SELECT id, match_label AS l, match_key_prefix AS k
           FROM projects WHERE id IN ('bhp-meridian', 'mp') ORDER BY id`,
      );
      assert.deepEqual(rows.rows, [
        { id: 'bhp-meridian', l: 'meridian-2027', k: null },
        { id: 'mp', l: null, k: 'MP' },
      ]);
    });

    test('a project nobody holds writes nothing and says so', async () => {
      assert.equal(
        await writeProject(pool, 'no-such-project', {
          label: 'x',
          start: null,
          end: null,
        }),
        false,
      );
    });

    test('the fields read under the workspace id, with the Jira id beside them', async () => {
      const fields = await readWorkspaceFields(pool);
      assert.deepEqual(Object.keys(fields), ['collibra']);
      assert.deepEqual(fields['collibra'], [
        { id: 'customer', jiraId: 'customfield_14849', name: 'Customer', required: true },
        { id: 'engagement', jiraId: 'customfield_14850', name: 'Engagement', required: false },
      ]);
    });

    test('a rename of the workspace leaves the fields where they are', async () => {
      await client.query(
        `UPDATE workspaces SET name = 'Collibra Australia' WHERE id = 'collibra'`,
      );
      try {
        const fields = await readWorkspaceFields(pool);
        assert.equal(fields['collibra']?.length, 2, 'the rename orphaned the fields');
        assert.equal(fields['Collibra Australia'], undefined);
      } finally {
        await client.query(`UPDATE workspaces SET name = 'Collibra' WHERE id = 'collibra'`);
      }
    });

    test('the write replaces the list whole', async () => {
      assert.equal(
        await writeWorkspaceFields(pool, 'collibra', [
          { id: 'customer', jiraId: 'customfield_14849', name: 'Customer', required: false },
          { id: 'team', jiraId: 'customfield_13600', name: 'Team', required: true },
        ]),
        true,
      );

      const fields = await readWorkspaceFields(pool);
      assert.deepEqual(fields['collibra'], [
        { id: 'customer', jiraId: 'customfield_14849', name: 'Customer', required: false },
        { id: 'team', jiraId: 'customfield_13600', name: 'Team', required: true },
      ]);
    });

    test('a workspace nobody holds writes nothing, and takes nothing away', async () => {
      // The project settings screen sends a project's display name. It matches
      // no workspace, and the transaction is what stops the delete landing on
      // its own. KPA-140 asks which list that screen is meant to edit.
      assert.equal(
        await writeWorkspaceFields(pool, 'BHP Meridian', [
          { id: 'severity', jiraId: 'customfield_10100', name: 'Severity', required: false },
        ]),
        false,
      );

      const fields = await readWorkspaceFields(pool);
      assert.equal(fields['collibra']?.length, 2, 'the refused write emptied the list');
      assert.equal(fields['BHP Meridian'], undefined);
    });
  },
);
