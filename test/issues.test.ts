import assert from 'node:assert/strict';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import type { ClientBase } from 'pg';
import { type Issue, PARENT_KIND, type Sprint } from '../apps/web/lib/types.ts';
// The tree the seed holds, imported rather than retyped. An issue names its
// workspace by name and the cache files it under `workspaces.id`, so this is
// what turns one into the other.
import { WORKSPACES } from '../apps/web/lib/workspaces.ts';
import { connect, refuseProduction } from '../src/db/connect.ts';
import { down, up } from '../src/db/migrate.ts';

const MIGRATIONS = path.join(import.meta.dirname, '..', 'migrations');
const url = process.env['DATABASE_URL_TEST'];

// `fixtures.ts` alone stays behind a variable specifier. The root type check
// sets `noUncheckedIndexedAccess` and `apps/web/tsconfig.json` does not, so six
// indexed reads in that file type as `T | undefined` here and as `T` there, and
// a static import fails the root type check on all six.
// `test/workspace-fields.test.ts` records the same thing.
const FIXTURES = '../apps/web/lib/fixtures.ts';
const { ISSUES, SPRINTS } = (await import(FIXTURES)) as {
  ISSUES: Issue[];
  SPRINTS: Sprint[];
};

/** Every column, constraint and comment on the two tables, plus the values of
 *  the three enums. A rename of anything shows up here, which is what the down
 *  and up test compares. */
const SHAPE = `
  SELECT 'column: ' || table_name || '.' || column_name || ' ' || data_type
         || ' ' || is_nullable || ' ' || coalesce(column_default, '(no default)')
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name IN ('issues', 'issue_blocks')
   UNION ALL
  SELECT 'constraint: ' || conrelid::regclass || '.' || conname || ' '
         || pg_get_constraintdef(oid)
    FROM pg_constraint
   WHERE conrelid IN ('issues'::regclass, 'issue_blocks'::regclass)
   UNION ALL
  SELECT 'comment: ' || c || ' ' || coalesce(obj_description(c::regclass), '(none)')
    FROM unnest(ARRAY['issues', 'issue_blocks']) AS c
   UNION ALL
  SELECT 'enum: ' || t.typname || ' ' || e.enumlabel
    FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
   WHERE t.typname IN ('issue_status', 'issue_kind', 'issue_priority')
   ORDER BY 1
`;

/** The two statements migration 022 quotes, run in the order it gives them.
 *  $1 is the workspace in both. $2 is every key the tracker still holds in the
 *  first, and the moment the sweep started in the second. */
const SWEEP_SEEN = `UPDATE issues SET seen_at = now()
                     WHERE workspace = $1 AND key = ANY($2::text[])`;
const SWEEP_GONE = `DELETE FROM issues WHERE workspace = $1 AND seen_at < $2`;

interface IssueRow {
  workspace: string;
  key: string;
  title: string;
  description: string | null;
  status: Issue['status'];
  kind: Issue['kind'];
  priority: Issue['priority'];
  labels: string[];
  assignee: string;
  start: string | null;
  due: string | null;
  sprint_id: string | null;
  fields: Record<string, string>;
  parent: string | null;
  parent_kind: Issue['kind'] | null;
  updated: Date;
}

const COLUMNS = `workspace, key, title, description, status, kind, priority,
                 labels, assignee, start, due, sprint_id, fields, parent,
                 parent_kind, updated`;

/** What the fixture's workspace name is filed under. Migration 018 made the id
 *  stable and the name an ordinary column, so nothing files under the name. */
function idOf(name: string): string {
  const workspace = WORKSPACES.find((candidate) => candidate.name === name);
  assert.ok(workspace, `no workspace named ${name}`);
  return workspace.id;
}

function nameOf(id: string): string {
  const workspace = WORKSPACES.find((candidate) => candidate.id === id);
  assert.ok(workspace, `no workspace with id ${id}`);
  return workspace.name;
}

/** The moment the fixture's day stands for. The column holds a moment and the
 *  fixture holds a day, so the test names the zone rather than letting the
 *  session pick one. */
function stampOf(issue: Issue): string {
  return `${issue.updated}T00:00:00Z`;
}

/** An `Issue` rebuilt from what the cache stored. Nothing is lost only if this
 *  comes back equal to the fixture the insert read. */
function issueFrom(row: IssueRow, blocks: string[]): Issue {
  const issue: Issue = {
    key: row.key,
    title: row.title,
    description: row.description ?? '',
    status: row.status,
    kind: row.kind,
    priority: row.priority,
    workspace: nameOf(row.workspace),
    labels: row.labels,
    assignee: row.assignee,
    start: row.start,
    due: row.due,
    updated: row.updated.toISOString().slice(0, 10),
    sprintId: row.sprint_id,
    fields: row.fields,
    blocks,
  };
  if (row.parent !== null) {
    issue.parent = row.parent;
  }
  return issue;
}

function byKey<T extends { key: string }>(rows: T[]): T[] {
  return [...rows].sort((one, other) => (one.key < other.key ? -1 : 1));
}

describe('the issue cache', { skip: url ? false : 'DATABASE_URL_TEST is unset' }, () => {
  let client: ClientBase & { end: () => Promise<void> };

  /** Runs `body` and undoes everything it wrote, a raised exception included.
   *  Several tests break a constraint to prove it binds, and the cached issues
   *  have to survive all of them. */
  async function rolledBack(body: () => Promise<void>): Promise<void> {
    await client.query('BEGIN');
    try {
      await body();
    } finally {
      await client.query('ROLLBACK');
    }
  }

  /** Writes one issue, as a poll would. The description goes in as the tracker
   *  sent it: the fixture is a plain string, so it stores as a JSON string. */
  async function insert(issue: Issue): Promise<void> {
    await client.query(
      `INSERT INTO issues (workspace, key, title, description, status, kind,
                           priority, labels, assignee, start, due, sprint_id,
                           fields, parent, updated)
       VALUES ($1, $2, $3, to_jsonb($4::text), $5, $6, $7, $8, $9, $10, $11,
               $12, $13, $14, $15)`,
      [
        idOf(issue.workspace),
        issue.key,
        issue.title,
        issue.description,
        issue.status,
        issue.kind,
        issue.priority,
        issue.labels,
        issue.assignee,
        issue.start,
        issue.due,
        issue.sprintId,
        JSON.stringify(issue.fields),
        issue.parent ?? null,
        stampOf(issue),
      ],
    );
  }

  async function blocksOf(workspace: string, key: string): Promise<string[]> {
    const rows = await client.query<{ blocked: string }>(
      `SELECT blocked FROM issue_blocks WHERE workspace = $1 AND blocker = $2
        ORDER BY blocked`,
      [workspace, key],
    );
    return rows.rows.map((row) => row.blocked);
  }

  before(async () => {
    client = connect('DATABASE_URL_TEST');
    await client.connect();
    await refuseProduction(client);
    await down(client, MIGRATIONS);
    await up(client, MIGRATIONS);

    // One transaction, so the parent reference defers and the fixture's order
    // decides nothing. A poll writes a batch the same way.
    await client.query('BEGIN');
    // Every sprint the issues name, in every workspace that names it.
    // Migration 027 gave `sprint_id` a reference, and the fixture has all
    // three workspaces running all three sprints. `test/sprints.test.ts` owns
    // the table; this is what makes the cache's rows legal.
    for (const workspace of WORKSPACES) {
      for (const sprint of SPRINTS) {
        await client.query(
          `INSERT INTO sprints (workspace, tracker_id, name, starts_on, ends_on, state)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [workspace.id, sprint.id, sprint.name, sprint.start, sprint.end, sprint.state],
        );
      }
    }
    for (const issue of ISSUES) {
      await insert(issue);
    }
    for (const issue of ISSUES) {
      for (const blocked of issue.blocks) {
        await client.query(
          `INSERT INTO issue_blocks (workspace, blocker, blocked) VALUES ($1, $2, $3)`,
          [idOf(issue.workspace), issue.key, blocked],
        );
      }
    }
    await client.query('COMMIT');
  });

  after(async () => {
    await down(client, MIGRATIONS);
    await client.end();
  });

  test('every issue the fixture holds is stored, field by field', async () => {
    assert.equal(ISSUES.length, 19);

    const rows = await client.query<IssueRow>(`SELECT ${COLUMNS} FROM issues`);
    assert.equal(rows.rows.length, ISSUES.length);

    const stored: Issue[] = [];
    for (const row of byKey(rows.rows)) {
      stored.push(issueFrom(row, await blocksOf(row.workspace, row.key)));
    }
    assert.deepEqual(stored, byKey(ISSUES));
  });

  test('a calendar date reads back as text and a stamp reads back as a moment', async () => {
    // `src/db/connect.ts` hands a `date` back as the string Postgres sent, so
    // a due date compares as YYYY-MM-DD and never moves a day west.
    const row = await client.query<IssueRow>(
      `SELECT ${COLUMNS} FROM issues WHERE workspace = 'collibra' AND key = 'PSAPAC-2607'`,
    );
    const found = row.rows[0];
    assert.ok(found);
    assert.equal(found.due, '2026-08-28');
    assert.equal(found.start, '2026-08-18');
    assert.equal(found.updated.toISOString(), '2026-08-25T00:00:00.000Z');
  });

  test('the generated parent kind is the constant the interface reads', async () => {
    const rows = await client.query<IssueRow>(`SELECT ${COLUMNS} FROM issues`);
    for (const row of rows.rows) {
      assert.equal(row.parent_kind, PARENT_KIND[row.kind], `${row.key} expects the wrong parent`);
    }
  });

  test('a link is stored once, from the blocker, and reads both ways', async () => {
    const links = await client.query<{ workspace: string; blocker: string; blocked: string }>(
      `SELECT workspace, blocker, blocked FROM issue_blocks ORDER BY blocker`,
    );
    assert.deepEqual(links.rows, [
      { workspace: 'koinon-engineering', blocker: 'MP-142', blocked: 'MP-146' },
      { workspace: 'collibra', blocker: 'PSAPAC-2607', blocked: 'PSAPAC-2598' },
    ]);

    // The other direction is a read of the other column, never a second row.
    const blockedBy = await client.query<{ blocker: string }>(
      `SELECT blocker FROM issue_blocks WHERE workspace = $1 AND blocked = $2`,
      ['collibra', 'PSAPAC-2598'],
    );
    assert.deepEqual(blockedBy.rows, [{ blocker: 'PSAPAC-2607' }]);
    assert.deepEqual(await blocksOf('collibra', 'PSAPAC-2598'), []);
  });

  test('nothing blocks itself', async () => {
    await rolledBack(async () => {
      await assert.rejects(
        () =>
          client.query(
            `INSERT INTO issue_blocks (workspace, blocker, blocked)
             VALUES ('collibra', 'PSAPAC-2607', 'PSAPAC-2607')`,
          ),
        /issue_blocks_nothing_blocks_itself/,
      );
    });
  });

  test('a link reaches two cached issues, and goes when either one does', async () => {
    await rolledBack(async () => {
      await assert.rejects(
        () =>
          client.query(
            `INSERT INTO issue_blocks (workspace, blocker, blocked)
             VALUES ('collibra', 'PSAPAC-2607', 'PSAPAC-9999')`,
          ),
        /issue_blocks_workspace_blocked_fkey/,
      );
    });
    await rolledBack(async () => {
      await client.query(`DELETE FROM issues WHERE workspace = 'collibra' AND key = 'PSAPAC-2598'`);
      assert.deepEqual(await blocksOf('collibra', 'PSAPAC-2607'), []);
    });
  });

  test('an epic carries no parent', async () => {
    await rolledBack(async () => {
      await assert.rejects(
        () =>
          client.query(
            `INSERT INTO issues (workspace, key, title, status, kind, updated, parent)
             VALUES ('collibra', 'PSAPAC-9001', 'An epic under a story', 'todo', 'epic',
                     now(), 'PSAPAC-2611')`,
          ),
        /issues_an_epic_has_no_parent/,
      );
    });
    // The same row without the parent is the ordinary case.
    await rolledBack(async () => {
      await client.query(
        `INSERT INTO issues (workspace, key, title, status, kind, updated)
         VALUES ('collibra', 'PSAPAC-9001', 'An epic', 'todo', 'epic', now())`,
      );
    });
  });

  test('a sub-task hangs off a story and off nothing else', async () => {
    // The reference is deferred, so the refusal arrives when the constraint is
    // made immediate. A poll writing a batch out of order relies on that.
    await rolledBack(async () => {
      await client.query(
        `INSERT INTO issues (workspace, key, title, status, kind, updated, parent)
         VALUES ('collibra', 'PSAPAC-9002', 'A sub-task under an epic', 'todo', 'subtask',
                 now(), 'PSAPAC-2607')`,
      );
      await assert.rejects(
        () => client.query('SET CONSTRAINTS ALL IMMEDIATE'),
        /issues_workspace_parent_parent_kind_fkey/,
      );
    });

    // A story hangs off an epic on the same terms, which is the other half of
    // `PARENT_KIND`.
    await rolledBack(async () => {
      await client.query(
        `INSERT INTO issues (workspace, key, title, status, kind, updated, parent)
         VALUES ('collibra', 'PSAPAC-9003', 'A story under a story', 'todo', 'story',
                 now(), 'PSAPAC-2611')`,
      );
      await assert.rejects(
        () => client.query('SET CONSTRAINTS ALL IMMEDIATE'),
        /issues_workspace_parent_parent_kind_fkey/,
      );
    });

    // The parent the rule allows is accepted, and the child may be written
    // first because the reference defers.
    await rolledBack(async () => {
      await client.query(
        `INSERT INTO issues (workspace, key, title, status, kind, updated, parent)
         VALUES ('collibra', 'PSAPAC-9005', 'A sub-task', 'todo', 'subtask',
                 now(), 'PSAPAC-9004')`,
      );
      await client.query(
        `INSERT INTO issues (workspace, key, title, status, kind, updated)
         VALUES ('collibra', 'PSAPAC-9004', 'Its story', 'todo', 'story', now())`,
      );
      await client.query('SET CONSTRAINTS ALL IMMEDIATE');
    });
  });

  test('the description keeps the format the tracker sent', async () => {
    // Jira sends ADF, which is a document rather than a string. ADR-0007 keeps
    // it as it arrived, because converting it to markdown drops what it holds.
    const adf = {
      type: 'doc',
      version: 1,
      content: [
        {
          type: 'taskList',
          content: [{ type: 'taskItem', attrs: { state: 'TODO' }, content: [] }],
        },
      ],
    };
    await rolledBack(async () => {
      await client.query(
        `UPDATE issues SET description = $1
          WHERE workspace = 'collibra' AND key = 'PSAPAC-2607'`,
        [JSON.stringify(adf)],
      );
      const row = await client.query<{ description: unknown }>(
        `SELECT description FROM issues WHERE workspace = 'collibra' AND key = 'PSAPAC-2607'`,
      );
      assert.deepEqual(row.rows[0]?.description, adf);
    });
  });

  test('the tracker stamp refuses a stale write', async () => {
    await rolledBack(async () => {
      // What the writer holds is the stamp it read. The tracker has moved on.
      const held = '2026-08-25T00:00:00Z';
      await client.query(
        `UPDATE issues SET updated = '2026-08-26T04:00:00Z'
          WHERE workspace = 'collibra' AND key = 'PSAPAC-2607'`,
      );

      const stale = await client.query(
        `UPDATE issues SET title = 'Written over'
          WHERE workspace = 'collibra' AND key = 'PSAPAC-2607' AND updated = $1`,
        [held],
      );
      assert.equal(stale.rowCount, 0, 'a stale write reached the row');

      const fresh = await client.query(
        `UPDATE issues SET title = 'Written over'
          WHERE workspace = 'collibra' AND key = 'PSAPAC-2607' AND updated = $1`,
        ['2026-08-26T04:00:00Z'],
      );
      assert.equal(fresh.rowCount, 1, 'the write refused a stamp that had not moved');
    });
  });

  test('the sweep finds an issue the tracker no longer holds', async () => {
    await rolledBack(async () => {
      const started = await client.query<{ at: string }>('SELECT now() AS at');
      const at = started.rows[0]?.at;
      assert.ok(at);

      // What a listing of the workspace returns. PSAPAC-2589 was deleted in
      // Jira, so no listing and no `updated` query ever names it again.
      const held = await client.query<{ key: string }>(
        `SELECT key FROM issues WHERE workspace = 'collibra' AND key <> 'PSAPAC-2589'`,
      );
      const keys = held.rows.map((row) => row.key);
      assert.equal(keys.length, 7);

      await client.query(SWEEP_SEEN, ['collibra', keys]);
      const swept = await client.query(SWEEP_GONE, ['collibra', at]);
      assert.equal(swept.rowCount, 1);

      const left = await client.query<{ key: string }>(
        `SELECT key FROM issues WHERE workspace = 'collibra' ORDER BY key`,
      );
      assert.deepEqual(
        left.rows.map((row) => row.key),
        [...keys].sort(),
      );

      // A second sweep over the same listing removes nothing, so a run that
      // repeats costs one statement rather than a row.
      await client.query(SWEEP_SEEN, ['collibra', keys]);
      const again = await client.query(SWEEP_GONE, ['collibra', at]);
      assert.equal(again.rowCount, 0);
    });
  });

  test('down then up returns the schema to what it was', async () => {
    const shape = await client.query<{ line: string }>(SHAPE);
    assert.ok(shape.rows.length > 0);

    await down(client, MIGRATIONS);
    await up(client, MIGRATIONS);

    assert.deepEqual((await client.query<{ line: string }>(SHAPE)).rows, shape.rows);

    // The cache is empty afterwards, which is what a cache with a master
    // elsewhere is meant to be. Every later test in this file has run.
    const rows = await client.query<{ count: string }>('SELECT count(*) AS count FROM issues');
    assert.equal(rows.rows[0]?.count, '0');
  });
});
