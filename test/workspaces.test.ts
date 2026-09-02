import assert from 'node:assert/strict';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import type { ClientBase } from 'pg';
import { connect } from '../src/db/connect.ts';
import { down, up } from '../src/db/migrate.ts';

const MIGRATIONS = path.join(import.meta.dirname, '..', 'migrations');
const url = process.env['DATABASE_URL_TEST'];

/** How `apps/web/lib/workspaces.ts` says an issue is matched to a project. */
type ProjectMatch = { by: 'label'; label: string } | { by: 'key'; prefix: string };

interface Constant {
  WORKSPACES: {
    id: string;
    name: string;
    space: string;
    projects: { id: string; name: string; match: ProjectMatch }[];
  }[];
}

// The tree the interface reads, imported rather than retyped: a transcription
// of it here would agree with itself and prove nothing about the seed.
//
// The specifier is a variable because `tsc` reads `apps/web` as CommonJS,
// since `apps/web/package.json` names no `type`. A static import therefore
// fails the root type check inside a file this story does not own. Node
// resolves it relative to this one and strips its types like any other.
const CONSTANT = '../apps/web/lib/workspaces.ts';
const { WORKSPACES } = (await import(CONSTANT)) as Constant;

/** Every column, constraint and comment on the two tables, as text. A rename
 *  of anything shows up here, which is what the down and up test compares. */
const SHAPE = `
  SELECT 'column: ' || table_name || '.' || column_name || ' ' || data_type
         || ' ' || is_nullable || ' ' || coalesce(column_default, '(no default)')
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name IN ('workspaces', 'projects')
   UNION ALL
  SELECT 'constraint: ' || conrelid::regclass || '.' || conname || ' '
         || pg_get_constraintdef(oid)
    FROM pg_constraint
   WHERE conrelid IN ('workspaces'::regclass, 'projects'::regclass)
   UNION ALL
  SELECT 'comment: ' || c || ' ' || coalesce(obj_description(c::regclass), '(none)')
    FROM unnest(ARRAY['workspaces', 'projects']) AS c
   ORDER BY 1
`;

interface WorkspaceRow {
  id: string;
  name: string;
  space: string;
}

interface ProjectRow {
  id: string;
  workspace: string;
  name: string;
  match_label: string | null;
  match_key_prefix: string | null;
}

/** The union `apps/web/lib/workspaces.ts` holds, rebuilt from a stored row.
 *  Nothing is lost only if this comes back equal to the constant's own. */
function matchOf(row: ProjectRow): ProjectMatch {
  if (row.match_label !== null) return { by: 'label', label: row.match_label };
  assert.ok(row.match_key_prefix, `${row.id} carries neither match`);
  return { by: 'key', prefix: row.match_key_prefix };
}

function byId<T extends { id: string }>(rows: T[]): T[] {
  return [...rows].sort((one, other) => (one.id < other.id ? -1 : 1));
}

describe('the workspace and project tree', { skip: url ? false : 'DATABASE_URL_TEST is unset' }, () => {
  let client: ClientBase & { end: () => Promise<void> };

  /** Runs `body` and undoes everything it wrote, a raised exception included.
   *  Several tests break a constraint to prove it binds, and the seeded tree
   *  has to survive all of them. */
  async function rolledBack(body: () => Promise<void>): Promise<void> {
    await client.query('BEGIN');
    try {
      await body();
    } finally {
      await client.query('ROLLBACK');
    }
  }

  async function workspaceRows(): Promise<WorkspaceRow[]> {
    const rows = await client.query<WorkspaceRow>('SELECT id, name, space FROM workspaces');
    return byId(rows.rows);
  }

  async function projectRows(): Promise<ProjectRow[]> {
    const rows = await client.query<ProjectRow>(
      'SELECT id, workspace, name, match_label, match_key_prefix FROM projects',
    );
    return byId(rows.rows);
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

  test('every workspace the constant holds is stored, field by field', async () => {
    assert.equal(WORKSPACES.length, 3);
    assert.deepEqual(
      await workspaceRows(),
      byId(
        WORKSPACES.map((workspace) => ({
          id: workspace.id,
          name: workspace.name,
          space: workspace.space,
        })),
      ),
    );
  });

  test('every project is stored under its workspace, with its match rule', async () => {
    const expected = WORKSPACES.flatMap((workspace) =>
      workspace.projects.map((project) => ({
        id: project.id,
        workspace: workspace.id,
        name: project.name,
        match: project.match,
      })),
    );
    assert.equal(expected.length, 6);

    assert.deepEqual(
      (await projectRows()).map((row) => ({
        id: row.id,
        workspace: row.workspace,
        name: row.name,
        match: matchOf(row),
      })),
      byId(expected),
    );
  });

  test('both ways of matching are stored, and each project uses one', async () => {
    const rows = await projectRows();
    assert.ok(rows.some((row) => row.match_label !== null), 'no project matches by label');
    assert.ok(rows.some((row) => row.match_key_prefix !== null), 'no project matches by key');
    for (const row of rows) {
      assert.equal(
        Number(row.match_label !== null) + Number(row.match_key_prefix !== null),
        1,
        `${row.id} names ${row.match_label === null ? 'no' : 'more than one'} match`,
      );
    }
  });

  test('a project carrying neither match is refused', async () => {
    await rolledBack(async () => {
      await assert.rejects(
        () =>
          client.query(
            `INSERT INTO projects (id, workspace, name) VALUES ('orphan', 'collibra', 'Orphan')`,
          ),
        /projects_match_one_way/,
      );
    });
  });

  test('a project carrying both matches is refused', async () => {
    await rolledBack(async () => {
      await assert.rejects(
        () =>
          client.query(
            `INSERT INTO projects (id, workspace, name, match_label, match_key_prefix)
             VALUES ('both', 'collibra', 'Both', 'both', 'BOTH')`,
          ),
        /projects_match_one_way/,
      );
    });
  });

  test('an empty match is refused, because null admits one', async () => {
    await rolledBack(async () => {
      await assert.rejects(
        () =>
          client.query(
            `INSERT INTO projects (id, workspace, name, match_label)
             VALUES ('blank', 'collibra', 'Blank', '   ')`,
          ),
        /projects_match_says_something/,
      );
    });
  });

  test('a lower case key prefix is refused, because it would match no issue', async () => {
    await rolledBack(async () => {
      await assert.rejects(
        () =>
          client.query(
            `INSERT INTO projects (id, workspace, name, match_key_prefix)
             VALUES ('quiet', 'koinon-engineering', 'Quiet', 'mp')`,
          ),
        /projects_key_prefix_is_upper/,
      );
    });
  });

  test('no workspace sits in shared', async () => {
    await rolledBack(async () => {
      await assert.rejects(
        () =>
          client.query(
            `INSERT INTO workspaces (id, name, space) VALUES ('both-sides', 'Both Sides', 'shared')`,
          ),
        /workspaces_none_is_shared/,
      );
    });
  });

  test('a rename orphans neither the projects nor the identifier', async () => {
    await rolledBack(async () => {
      await client.query(
        `UPDATE workspaces SET name = 'Koinon' WHERE id = 'koinon-engineering'`,
      );
      const renamed = await client.query<WorkspaceRow>(
        `SELECT id, name, space FROM workspaces WHERE name = 'Koinon'`,
      );
      assert.equal(renamed.rows[0]?.id, 'koinon-engineering');
      assert.equal(renamed.rows[0]?.space, 'koinon');

      // The three projects still name the workspace, so nothing KPA-97 files
      // under the same id is orphaned either.
      const kept = await client.query<ProjectRow>(
        `SELECT id, workspace, name, match_label, match_key_prefix FROM projects
          WHERE workspace = 'koinon-engineering'`,
      );
      assert.deepEqual(
        byId(kept.rows).map((row) => row.id),
        ['kpa', 'mp', 'ms'],
      );

      // A project renames on the same terms.
      await client.query(`UPDATE projects SET name = 'Marinucci' WHERE id = 'mp'`);
      const project = await client.query<ProjectRow>(
        `SELECT id, workspace, name, match_label, match_key_prefix FROM projects WHERE id = 'mp'`,
      );
      assert.equal(project.rows[0]?.match_key_prefix, 'MP');
      assert.equal(project.rows[0]?.workspace, 'koinon-engineering');
    });
  });

  test('the rows the plus button adds insert with a name alone', async () => {
    await rolledBack(async () => {
      // The dialog asks for a name and slugs it. It names no space, and it
      // fills the Jira label for a Collibra project alone, so the slug is the
      // label everywhere else.
      await client.query(
        `INSERT INTO workspaces (id, name) VALUES ('acme-consulting', 'Acme Consulting')`,
      );
      const added = await client.query<WorkspaceRow>(
        `SELECT id, name, space FROM workspaces WHERE id = 'acme-consulting'`,
      );
      assert.equal(added.rows[0]?.space, 'personal');

      await client.query(
        `INSERT INTO projects (id, workspace, name, match_label)
         VALUES ('acme-uplift', 'acme-consulting', 'Acme Uplift', 'acme-uplift')`,
      );
      const project = await client.query<ProjectRow>(
        `SELECT id, workspace, name, match_label, match_key_prefix FROM projects
          WHERE id = 'acme-uplift'`,
      );
      assert.deepEqual(matchOf(project.rows[0]!), { by: 'label', label: 'acme-uplift' });
    });
  });

  test('an identifier that is not a slug is refused, because it is the route', async () => {
    await rolledBack(async () => {
      await assert.rejects(
        () => client.query(`INSERT INTO workspaces (id, name) VALUES ('Acme Ltd', 'Acme')`),
        /workspaces_id_is_a_slug/,
      );
    });
    // A refused statement aborts the transaction, so the second one needs its
    // own.
    await rolledBack(async () => {
      await assert.rejects(
        () =>
          client.query(
            `INSERT INTO projects (id, workspace, name, match_label)
             VALUES ('a/b', 'collibra', 'Slashed', 'slashed')`,
          ),
        /projects_id_is_a_slug/,
      );
    });
  });

  test('a project names a workspace that exists', async () => {
    await rolledBack(async () => {
      await assert.rejects(
        () =>
          client.query(
            `INSERT INTO projects (id, workspace, name, match_label)
             VALUES ('nowhere', 'no-such-workspace', 'Nowhere', 'nowhere')`,
          ),
        /projects_workspace_fkey/,
      );
    });
  });

  test('two workspaces cannot share a name, because an issue names one', async () => {
    await rolledBack(async () => {
      await assert.rejects(
        () =>
          client.query(`INSERT INTO workspaces (id, name) VALUES ('collibra-two', 'Collibra')`),
        /workspaces_name_key/,
      );
    });
  });

  test('down then up returns the schema and the seed to what they were', async () => {
    const shape = await client.query<{ line: string }>(SHAPE);
    const workspaces = await workspaceRows();
    const projects = await projectRows();

    await down(client, MIGRATIONS);
    await up(client, MIGRATIONS);

    assert.deepEqual((await client.query<{ line: string }>(SHAPE)).rows, shape.rows);
    assert.ok(shape.rows.length > 0);
    assert.deepEqual(await workspaceRows(), workspaces);
    assert.deepEqual(await projectRows(), projects);
  });
});
