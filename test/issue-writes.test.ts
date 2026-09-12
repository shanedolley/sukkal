/**
 * The queue for a write the tracker has not accepted.
 *
 * ADR-0007 asks for it: the cache carries the tracker's own stamp, and this
 * carries what Sukkal wants to change. Every rule the story states is proved here
 * against the database rather than asserted in a comment.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { after, before, beforeEach, describe, test } from 'node:test';
import type { ClientBase } from 'pg';
import { connect } from '../src/db/connect.ts';
import { down, up } from '../src/db/migrate.ts';

const MIGRATIONS = path.join(import.meta.dirname, '..', 'migrations');
const url = process.env['DATABASE_URL_TEST'];

/** The workspace migration 018 seeds, and one issue inside it. */
const WORKSPACE = 'collibra';
const KEY = 'PSAPAC-1';

/** What the tracker last changed, as the screen that queued the write read it. */
const READ_AT = '2026-09-03T01:00:00Z';
/** What the tracker had instead, once somebody else edited it. */
const MOVED_TO = '2026-09-03T02:30:00Z';

type State = 'queued' | 'sent' | 'conflict' | 'failed';

interface Queued {
  patch?: Record<string, unknown>;
  expected?: string;
  observed?: string | null;
  state?: State;
  attempts?: number;
  error?: string | null;
  settled?: string | null;
}

describe('a write the tracker has not accepted', { skip: url ? false : 'DATABASE_URL_TEST is unset' }, () => {
  let client: ClientBase & { end: () => Promise<void> };

  /** One row, with every column the story names. */
  function queue(over: Queued = {}): Promise<{ rows: { id: string }[] }> {
    return client.query<{ id: string }>(
      `INSERT INTO issue_writes
         (workspace, key, patch, expected_updated, observed_updated,
          state, attempts, last_error, settled_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id::text AS id`,
      [
        WORKSPACE,
        KEY,
        JSON.stringify(over.patch ?? { title: 'A better title' }),
        over.expected ?? READ_AT,
        over.observed ?? null,
        over.state ?? 'queued',
        over.attempts ?? 0,
        over.error ?? null,
        over.settled ?? null,
      ],
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
    await client.query('DELETE FROM issue_writes');
    await client.query('DELETE FROM issues');
    await client.query(
      `INSERT INTO issues (workspace, key, title, status, kind, updated)
       VALUES ($1, $2, 'A cached issue', 'todo', 'story', $3)`,
      [WORKSPACE, KEY, READ_AT],
    );
  });

  describe('what a queued write carries', () => {
    test('the issue, the patch, the stamp, the attempts, the state and the error', async () => {
      // The six the story names, read back in one row.
      const { rows } = await queue({
        patch: { title: 'A better title', priority: 'high' },
        attempts: 2,
        error: 'the tracker answered 503',
      });
      const id = rows[0]?.id;
      assert.ok(id);

      const stored = await client.query<{
        workspace: string;
        key: string;
        patch: Record<string, unknown>;
        expected_updated: Date;
        state: State;
        attempts: number;
        last_error: string | null;
      }>(
        `SELECT workspace, key, patch, expected_updated, state, attempts, last_error
           FROM issue_writes WHERE id = $1`,
        [id],
      );

      assert.deepEqual(stored.rows[0], {
        workspace: WORKSPACE,
        key: KEY,
        patch: { title: 'A better title', priority: 'high' },
        expected_updated: new Date(READ_AT),
        state: 'queued',
        attempts: 2,
        last_error: 'the tracker answered 503',
      });
    });

    test('the stamp is a moment, because the cache compares moments', async () => {
      // `issues.updated` is a timestamptz for the reason migration 022 gives:
      // a stamp at day resolution refuses no write made later the same day.
      const { rows } = await client.query<{ kind: string }>(
        `SELECT data_type AS kind FROM information_schema.columns
          WHERE table_name = 'issue_writes' AND column_name = 'expected_updated'`,
      );
      assert.equal(rows[0]?.kind, 'timestamp with time zone');
    });

    test('a patch that is not an object is refused', async () => {
      for (const wrong of ['["title"]', '"title"', '42', 'null']) {
        await assert.rejects(
          () =>
            client.query(
              `INSERT INTO issue_writes (workspace, key, patch, expected_updated)
               VALUES ($1, $2, $3::jsonb, $4)`,
              [WORKSPACE, KEY, wrong, READ_AT],
            ),
          /issue_writes_patch_is_an_object|null value/,
          `${wrong} was accepted as a patch`,
        );
      }
    });

    test('a patch that changes nothing is refused', async () => {
      await assert.rejects(
        () => queue({ patch: {} }),
        /issue_writes_patch_changes_something/,
      );
    });

    test('a write against an issue the cache does not hold is refused', async () => {
      await assert.rejects(
        () =>
          client.query(
            `INSERT INTO issue_writes (workspace, key, patch, expected_updated)
             VALUES ($1, 'PSAPAC-999', '{"title":"x"}', $2)`,
            [WORKSPACE, READ_AT],
          ),
        /violates foreign key constraint/,
      );
    });
  });

  describe('a conflict', () => {
    test('names both stamps, because a person needs both numbers', async () => {
      const { rows } = await queue({
        state: 'conflict',
        observed: MOVED_TO,
        settled: MOVED_TO,
        error: 'the stamp had moved',
      });
      const id = rows[0]?.id;

      const stored = await client.query<{
        expected_updated: Date;
        observed_updated: Date;
      }>(
        'SELECT expected_updated, observed_updated FROM issue_writes WHERE id = $1',
        [id],
      );

      assert.deepEqual(stored.rows[0]?.expected_updated, new Date(READ_AT));
      assert.deepEqual(stored.rows[0]?.observed_updated, new Date(MOVED_TO));
    });

    test('with one stamp is refused', async () => {
      await assert.rejects(
        () => queue({ state: 'conflict', observed: null, settled: MOVED_TO }),
        /issue_writes_a_conflict_names_both_stamps/,
        'a conflict recorded only what it expected',
      );
    });

    test('is the only state that observed a stamp', async () => {
      // A leftover here reads as a conflict on a row that never had one.
      for (const state of ['queued', 'sent', 'failed'] as const) {
        await assert.rejects(
          () =>
            queue({
              state,
              observed: MOVED_TO,
              settled: state === 'queued' ? null : MOVED_TO,
            }),
          /issue_writes_only_a_conflict_observed_a_stamp/,
          `a ${state} row kept an observed stamp`,
        );
      }
    });
  });

  describe('what happens to a row', () => {
    test('a successful write moves to sent rather than being deleted', async () => {
      const { rows } = await queue();
      const id = rows[0]?.id;

      await client.query(
        `UPDATE issue_writes SET state = 'sent', attempts = attempts + 1,
                                 settled_at = now() WHERE id = $1`,
        [id],
      );

      const stored = await client.query<{ state: State; attempts: number }>(
        'SELECT state, attempts FROM issue_writes WHERE id = $1',
        [id],
      );
      assert.equal(stored.rows.length, 1, 'the record of the write was thrown away');
      assert.equal(stored.rows[0]?.state, 'sent');
      assert.equal(stored.rows[0]?.attempts, 1);
    });

    test('a settled row names when, and a queued one does not', async () => {
      await assert.rejects(
        () => queue({ state: 'sent', settled: null }),
        /issue_writes_a_settled_row_names_when/,
        'a sent row never said when it settled',
      );
      await assert.rejects(
        () => queue({ state: 'queued', settled: MOVED_TO }),
        /issue_writes_a_settled_row_names_when/,
        'a queued row claimed to have settled',
      );
    });

    test('a failure keeps its reason and goes back to the queue', async () => {
      const { rows } = await queue();
      const id = rows[0]?.id;

      // The tracker did not answer. The row carries why and waits again.
      await client.query(
        `UPDATE issue_writes
            SET attempts = attempts + 1, last_error = 'the tracker did not answer'
          WHERE id = $1`,
        [id],
      );

      const stored = await client.query<{
        state: State;
        attempts: number;
        last_error: string;
        settled_at: Date | null;
      }>(
        'SELECT state, attempts, last_error, settled_at FROM issue_writes WHERE id = $1',
        [id],
      );
      assert.equal(stored.rows[0]?.state, 'queued');
      assert.equal(stored.rows[0]?.attempts, 1);
      assert.equal(stored.rows[0]?.settled_at, null);
      assert.match(stored.rows[0]?.last_error ?? '', /did not answer/);
    });

    test('a negative attempt count is refused', async () => {
      await assert.rejects(
        () => queue({ attempts: -1 }),
        /issue_writes_attempts_is_a_count/,
      );
    });

    test('an issue leaving the cache takes its queued writes', async () => {
      await queue();
      await client.query('DELETE FROM issues WHERE workspace = $1 AND key = $2', [
        WORKSPACE,
        KEY,
      ]);

      const { rows } = await client.query('SELECT id FROM issue_writes');
      assert.equal(rows.length, 0, 'a write outlived the issue it changes');
    });
  });

  describe('several writes on one issue', () => {
    test('keep the order they were made in', async () => {
      // Every field lands as it is made, so two edits of the same field must
      // reach the tracker in the order somebody typed them.
      const first = (await queue({ patch: { title: 'First' } })).rows[0]?.id;
      const second = (await queue({ patch: { title: 'Second' } })).rows[0]?.id;
      const third = (await queue({ patch: { title: 'Third' } })).rows[0]?.id;

      const { rows } = await client.query<{ id: string }>(
        `SELECT id::text AS id FROM issue_writes
          WHERE workspace = $1 AND key = $2 ORDER BY id`,
        [WORKSPACE, KEY],
      );
      assert.deepEqual(rows.map((row) => row.id), [first, second, third]);
    });

    test('the sender reads the oldest still waiting', async () => {
      await queue({ patch: { title: 'Already gone' }, state: 'sent', settled: MOVED_TO });
      const waiting = (await queue({ patch: { title: 'Next' } })).rows[0]?.id;
      await queue({ patch: { title: 'After that' } });

      const { rows } = await client.query<{ id: string; patch: { title: string } }>(
        `SELECT id::text AS id, patch FROM issue_writes
          WHERE state = 'queued' ORDER BY queued_at, id LIMIT 1`,
      );
      assert.equal(rows[0]?.id, waiting);
      assert.equal(rows[0]?.patch.title, 'Next');
    });
  });

  test('a comment never comes through the queue', async () => {
    // ADR-0007 writes a comment straight through, because nothing about one
    // can conflict, so nothing about it needs a stamp.
    await assert.rejects(
      () => queue({ patch: { comment: 'Looks right to me' } }),
      /issue_writes_carry_no_comment/,
    );
    await assert.rejects(
      () => queue({ patch: { title: 'A better title', comment: 'and a note' } }),
      /issue_writes_carry_no_comment/,
      'a comment rode along beside a field that does need a stamp',
    );
  });
});
