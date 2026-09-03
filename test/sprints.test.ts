/**
 * The sprints a tracker runs, and the reference the issue cache waited on.
 *
 * `apps/web/lib/fixtures.ts` holds three sprints and finds the active one with
 * `Array.find`. KPA-99 asks that the same answer come from a query, so the
 * query is here and the fixture is what it is run against.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { after, before, beforeEach, describe, test } from 'node:test';
import type { ClientBase } from 'pg';
import type { Sprint } from '../apps/web/lib/types.ts';
// The tree migration 018 seeds, imported rather than retyped.
import { WORKSPACES } from '../apps/web/lib/workspaces.ts';
import { connect } from '../src/db/connect.ts';
import { down, up } from '../src/db/migrate.ts';

const MIGRATIONS = path.join(import.meta.dirname, '..', 'migrations');
const url = process.env['DATABASE_URL_TEST'];

// `fixtures.ts` stays behind a variable specifier, for the reason
// `test/issues.test.ts` gives: the root type check sets
// `noUncheckedIndexedAccess` and `apps/web/tsconfig.json` does not, so six
// indexed reads in that file type differently under the two.
const FIXTURES = '../apps/web/lib/fixtures.ts';
const { SPRINTS, CURRENT_SPRINT } = (await import(FIXTURES)) as {
  SPRINTS: Sprint[];
  CURRENT_SPRINT: Sprint;
};

/**
 * The sprint in flight, read rather than found.
 *
 * `sprints_one_active_per_workspace` is what makes this safe to write without
 * a LIMIT: a second active sprint cannot exist, so a second row cannot come
 * back. A query with a LIMIT and no such index answers whichever row the
 * planner reached first, which is a different sprint on a different day.
 */
const CURRENT = `SELECT tracker_id, name, starts_on, ends_on, state
                   FROM sprints WHERE workspace = $1 AND state = 'active'`;

interface Row {
  tracker_id: string;
  name: string;
  starts_on: string;
  ends_on: string;
  state: Sprint['state'];
}

/** A `Sprint` rebuilt from what the table stored. */
function sprintFrom(row: Row): Sprint {
  return {
    id: row.tracker_id,
    name: row.name,
    start: row.starts_on,
    end: row.ends_on,
    state: row.state,
  };
}

describe('the sprints a tracker runs', { skip: url ? false : 'DATABASE_URL_TEST is unset' }, () => {
  let client: ClientBase & { end: () => Promise<void> };

  /** The three workspaces migration 018 seeds. */
  const workspaces = WORKSPACES.map((one) => one.id);

  async function put(workspace: string, sprint: Sprint): Promise<void> {
    await client.query(
      `INSERT INTO sprints (workspace, tracker_id, name, starts_on, ends_on, state)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [workspace, sprint.id, sprint.name, sprint.start, sprint.end, sprint.state],
    );
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

  beforeEach(async () => {
    await client.query('DELETE FROM sprints');
  });

  test('the three the fixture holds load, field by field', async () => {
    assert.equal(SPRINTS.length, 3);
    for (const sprint of SPRINTS) await put('collibra', sprint);

    const rows = await client.query<Row>(
      `SELECT tracker_id, name, starts_on, ends_on, state
         FROM sprints WHERE workspace = $1 ORDER BY starts_on`,
      ['collibra'],
    );

    assert.deepEqual(rows.rows.map(sprintFrom), SPRINTS);
  });

  test('a date reads back as text, so nothing moves a day west', async () => {
    // `src/db/connect.ts` tells the driver to leave a `date` as the string
    // Postgres sent. Parsing '2026-08-18' into a Date puts it at local
    // midnight, and reading that back as UTC is the 17th from Sydney.
    const [sprint] = SPRINTS;
    assert.ok(sprint);
    await put('collibra', sprint);

    const { rows } = await client.query<{ starts_on: unknown }>(
      'SELECT starts_on FROM sprints',
    );
    assert.equal(typeof rows[0]?.starts_on, 'string');
    assert.equal(rows[0]?.starts_on, sprint.start);
  });

  test('the sprint in flight comes from a query, not a find', async () => {
    for (const sprint of SPRINTS) await put('collibra', sprint);

    const { rows } = await client.query<Row>(CURRENT, ['collibra']);
    assert.equal(rows.length, 1, 'the query answered with something other than one sprint');
    assert.deepEqual(sprintFrom(rows[0]!), CURRENT_SPRINT);
  });

  test('a workspace between sprints has no current one, and says so as no rows', async () => {
    for (const sprint of SPRINTS.filter((one) => one.state !== 'active')) {
      await put('collibra', sprint);
    }

    const { rows } = await client.query<Row>(CURRENT, ['collibra']);
    assert.equal(rows.length, 0);
  });

  test('at most one sprint per workspace is active, and the database holds it', async () => {
    const active = SPRINTS.find((one) => one.state === 'active');
    assert.ok(active);
    await put('collibra', active);

    await assert.rejects(
      () => put('collibra', { ...active, id: 'sprint-99', name: 'Sprint 99' }),
      /sprints_one_active_per_workspace/,
      'a workspace ran two sprints at once',
    );

    // Every other state repeats as often as the tracker likes. A board holds
    // many closed sprints and several planned ones.
    await put('collibra', { ...active, id: 'sprint-30', name: 'Sprint 30', state: 'closed' });
    await put('collibra', { ...active, id: 'sprint-31', name: 'Sprint 31', state: 'closed' });
    await put('collibra', { ...active, id: 'sprint-50', name: 'Sprint 50', state: 'future' });
    await put('collibra', { ...active, id: 'sprint-51', name: 'Sprint 51', state: 'future' });
  });

  test('each workspace runs its own active sprint, and they do not collide', async () => {
    // Two Jira sites both number a sprint 41, which is why the key is the pair
    // and the index is per workspace.
    const active = SPRINTS.find((one) => one.state === 'active');
    assert.ok(active);
    for (const workspace of workspaces) await put(workspace, active);

    for (const workspace of workspaces) {
      const { rows } = await client.query<Row>(CURRENT, [workspace]);
      assert.equal(rows.length, 1, `${workspace} lost its current sprint`);
      assert.equal(rows[0]?.tracker_id, active.id);
    }
  });

  test('an end before a start is refused, and the same day is not', async () => {
    const [sprint] = SPRINTS;
    assert.ok(sprint);

    await assert.rejects(
      () => put('collibra', { ...sprint, start: '2026-08-15', end: '2026-08-04' }),
      /sprints_ends_after_it_starts/,
      'a sprint ended before it began',
    );

    // A one-day sprint is a real thing, and refusing it would refuse a row the
    // tracker holds.
    await put('collibra', {
      ...sprint,
      id: 'sprint-one-day',
      start: '2026-08-04',
      end: '2026-08-04',
    });
  });

  test('a sprint with no name is refused', async () => {
    const [sprint] = SPRINTS;
    assert.ok(sprint);
    await assert.rejects(
      () => put('collibra', { ...sprint, name: '   ' }),
      /sprints_name_says_something/,
    );
  });

  test('removing the workspace takes its sprints', async () => {
    for (const sprint of SPRINTS) await put('personal', sprint);
    await client.query('DELETE FROM workspaces WHERE id = $1', ['personal']);

    const { rows } = await client.query('SELECT tracker_id FROM sprints');
    assert.equal(rows.length, 0);

    // Migration 018 seeds it, so put it back for whatever runs next.
    await client.query(
      `INSERT INTO workspaces (id, name, space) VALUES ('personal', 'Personal', 'personal')`,
    );
  });

  describe('the reference from the issue cache', () => {
    /** One issue, with every column the cache requires. */
    async function putIssue(sprintId: string | null): Promise<void> {
      await client.query(
        `INSERT INTO issues (workspace, key, title, status, kind, sprint_id, updated)
         VALUES ('collibra', 'PSAPAC-1', 'A cached issue', 'todo', 'story', $1, now())`,
        [sprintId],
      );
    }

    beforeEach(async () => {
      await client.query('DELETE FROM issues');
    });

    test('null is the backlog, and it is checked against nothing', async () => {
      // The default MATCH SIMPLE is what makes this true: a composite
      // reference with any column null is satisfied without a lookup, and no
      // sprint exists here at all.
      await putIssue(null);
      const { rows } = await client.query('SELECT sprint_id FROM issues');
      assert.equal(rows.length, 1);
    });

    test('a sprint the workspace does not run is refused', async () => {
      await assert.rejects(async () => {
        await client.query('BEGIN');
        await putIssue('sprint-nobody-runs');
        await client.query('COMMIT');
      }, /issues_sprint_is_one_its_workspace_runs/);
      await client.query('ROLLBACK').catch(() => undefined);
    });

    test("another workspace's sprint is not this one's", async () => {
      const [sprint] = SPRINTS;
      assert.ok(sprint);
      await put('personal', sprint);

      await assert.rejects(async () => {
        await client.query('BEGIN');
        await putIssue(sprint.id);
        await client.query('COMMIT');
      }, /issues_sprint_is_one_its_workspace_runs/);
      await client.query('ROLLBACK').catch(() => undefined);
    });

    test('the check defers, so one batch writes issues and sprints in any order', async () => {
      // A poll returns both in the tracker's own order. Without the deferral
      // whichever arrived second would decide whether the batch was refused.
      const [sprint] = SPRINTS;
      assert.ok(sprint);

      await client.query('BEGIN');
      await putIssue(sprint.id);
      await put('collibra', sprint);
      await client.query('COMMIT');

      const { rows } = await client.query<{ sprint_id: string }>(
        'SELECT sprint_id FROM issues',
      );
      assert.equal(rows[0]?.sprint_id, sprint.id);
    });

    test('a sprint that leaves the tracker returns its issues to the backlog', async () => {
      const [sprint] = SPRINTS;
      assert.ok(sprint);
      await put('collibra', sprint);
      await putIssue(sprint.id);

      await client.query('DELETE FROM sprints WHERE tracker_id = $1', [sprint.id]);

      const { rows } = await client.query<{ sprint_id: string | null }>(
        'SELECT sprint_id FROM issues',
      );
      assert.equal(rows.length, 1, 'the issue went with the sprint');
      assert.equal(rows[0]?.sprint_id, null);
    });
  });
});
