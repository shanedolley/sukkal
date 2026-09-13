import assert from 'node:assert/strict';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import pg, { type ClientBase } from 'pg';
import { routeWorkspace } from '../apps/web/lib/route-workspace.ts';
import { readWorkspaceFields } from '../apps/web/lib/tree.ts';
import { WORKSPACES, workspaceNamed } from '../apps/web/lib/workspaces.ts';
import { connect, connectionString, refuseProduction } from '../src/db/connect.ts';
import { down, up } from '../src/db/migrate.ts';

// Which workspace a `/projects/[key]` route edits the custom fields of.
//
// KPA-140 ruled it is the workspace's list on every route, and that a project
// carries none of its own. `/projects/bhp-meridian/settings` therefore edits
// Collibra's fields and names Collibra while it does.
//
// THE SCREEN AND THE STORE HAVE TO AGREE ON ONE KEY, and three functions stand
// between them. The route hands a key to `routeWorkspace`, the screen hands
// that workspace's name to `useWorkspaceFields`, and `savedUnder` there turns
// the name into `workspaces.id` through `workspaceNamed`. Break any link and
// nothing throws: the screen shows an empty list and writes where nobody
// reads, which is the defect this story closes.
//
// Before the fix, `/projects/bhp-meridian/settings` passed the literal
// "BHP Meridian" the whole way down. `workspaceNamed` answered undefined, the
// name passed through as the key, and the write reached the route as a field
// list under a workspace that does not exist.

const MIGRATIONS = path.join(import.meta.dirname, '..', 'migrations');
const url = process.env['DATABASE_URL_TEST'];

/** Every key the route can carry: a workspace, or a project inside one. */
const KEYS = WORKSPACES.flatMap((workspace) => [
  workspace.id,
  ...workspace.projects.map((project) => project.id),
]);

describe('the workspace a project route edits the fields of', () => {
  test('every route key resolves to a workspace', () => {
    assert.ok(KEYS.length >= 9, 'the tree should hold three workspaces and six projects');
    for (const key of KEYS) {
      assert.ok(routeWorkspace(key), `${key} reaches no workspace`);
    }
  });

  test('a project key resolves to the workspace holding it', () => {
    for (const workspace of WORKSPACES) {
      assert.equal(routeWorkspace(workspace.id)?.id, workspace.id);
      for (const project of workspace.projects) {
        assert.equal(
          routeWorkspace(project.id)?.id,
          workspace.id,
          `${project.id} should edit ${workspace.id}'s fields`
        );
      }
    }
  });

  test('the settings route for a Collibra project edits Collibra', () => {
    // The story's own example. The key is a project and the answer is not.
    assert.equal(routeWorkspace('bhp-meridian')?.id, 'collibra');
    assert.equal(routeWorkspace('bhp-meridian')?.name, 'Collibra');
  });

  test('the name the screen passes down reaches the id the store files under', () => {
    // `savedUnder` in `workspace-fields.ts` calls `workspaceNamed` and nothing
    // else, so this is that translation rather than a transcription of it.
    for (const key of KEYS) {
      const workspace = routeWorkspace(key);
      assert.ok(workspace);
      assert.equal(
        workspaceNamed(workspace.name)?.id,
        workspace.id,
        `${key} names ${workspace.name}, which files under nothing`
      );
    }
  });

  test('no project name reaches a workspace', () => {
    // What the screen used to pass. A workspace named after a project would
    // make the old behaviour look correct while it still edited the wrong
    // list, so the tree must never hold one.
    for (const workspace of WORKSPACES) {
      for (const project of workspace.projects) {
        assert.equal(
          workspaceNamed(project.name),
          undefined,
          `${project.name} names both a project and a workspace`
        );
      }
    }
  });

  test('a key the tree does not hold resolves to nothing', () => {
    // The sidebar's plus button adds one. The screen falls back to the display
    // name, which is what `savedUnder` passes an unknown workspace through as.
    assert.equal(routeWorkspace('typed-into-the-address-bar'), undefined);
  });
});

describe(
  'every route key edits a list the database holds',
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
      pool = new pg.Pool({ connectionString: connectionString('DATABASE_URL_TEST') });
    });

    after(async () => {
      await pool.end();
      await down(client, MIGRATIONS);
      await client.end();
    });

    test('each resolved workspace is a row the field list can reference', async () => {
      for (const key of KEYS) {
        const workspace = routeWorkspace(key);
        assert.ok(workspace);
        const { rowCount } = await pool.query('SELECT 1 FROM workspaces WHERE id = $1', [
          workspace.id,
        ]);
        assert.equal(rowCount, 1, `${key} resolves to ${workspace.id}, which is no workspace`);
      }
    });

    test("a Collibra project's settings screen reads Collibra's two seeded fields", async () => {
      const saved = await readWorkspaceFields(pool);
      const workspace = routeWorkspace('bhp-meridian');
      assert.ok(workspace);
      const fields = saved[workspace.id] ?? [];
      assert.deepEqual(
        fields.map((field) => field.id).sort(),
        ['customer', 'engagement'],
        'the settings screen should read what migration 021 seeded'
      );
    });

    test('no project key files a list of its own', async () => {
      // The ruling: a project carries no field list. Anything filed under a
      // project id would be a list the issue forms never read.
      const projects = WORKSPACES.flatMap((workspace) =>
        workspace.projects.map((project) => project.id)
      );
      const { rows } = await pool.query<{ workspace: string }>(
        'SELECT DISTINCT workspace FROM workspace_fields WHERE workspace = ANY($1)',
        [projects]
      );
      assert.deepEqual(rows, []);
    });
  }
);
