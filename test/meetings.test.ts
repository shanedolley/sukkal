import assert from 'node:assert/strict';
import path from 'node:path';
import { after, before, beforeEach, describe, test } from 'node:test';
import type { ClientBase } from 'pg';
import { connect } from '../src/db/connect.ts';
import { down, up } from '../src/db/migrate.ts';

const MIGRATIONS = path.join(import.meta.dirname, '..', 'migrations');
const url = process.env['DATABASE_URL_TEST'];

/** The columns every meeting needs. A test overrides only what it tests. */
interface Row {
  starts_at: string;
  ends_at: string;
  title: string;
  engagement: string;
  space: 'collibra' | 'koinon' | 'personal' | 'shared';
  attendees: string[];
  source_id?: string | null;
}

const MEETING: Row = {
  starts_at: '2026-08-25T10:00:00+10:00',
  ends_at: '2026-08-25T11:00:00+10:00',
  title: 'BHP Meridian steering group',
  engagement: 'BHP Meridian',
  space: 'collibra',
  attendees: ['Priya Raman', 'Shane Dolley'],
};

describe('meetings', { skip: url ? false : 'DATABASE_URL_TEST is unset' }, () => {
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

  beforeEach(async () => {
    await client.query('DELETE FROM meetings');
    await client.query('DELETE FROM sources');
    await client.query("DELETE FROM nodes WHERE kind = 'source'");
  });

  /** Inserts one meeting and returns its id. */
  async function insert(row: Row): Promise<string> {
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO meetings (starts_at, ends_at, title, engagement, space, attendees, source_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [
        row.starts_at, row.ends_at, row.title, row.engagement,
        row.space, row.attendees, row.source_id ?? null,
      ],
    );
    return inserted.rows[0]!.id;
  }

  /** A source row a meeting's transcript can point at, per the node registry. */
  async function transcriptSource(sourcePath: string): Promise<string> {
    await client.query('BEGIN');
    const node = await client.query<{ id: string }>(
      "INSERT INTO nodes (kind) VALUES ('source') RETURNING id",
    );
    const id = node.rows[0]!.id;
    await client.query(
      `INSERT INTO sources (id, path, body, kind) VALUES ($1, $2, 'a transcript', 'meeting')`,
      [id, sourcePath],
    );
    await client.query('COMMIT');
    return id;
  }

  test('an end at or before its start is refused', async () => {
    await assert.rejects(
      insert({ ...MEETING, ends_at: MEETING.starts_at }),
      /meetings_ends_after_starts/,
      'an end equal to the start is refused',
    );
    await assert.rejects(
      insert({ ...MEETING, starts_at: MEETING.ends_at, ends_at: MEETING.starts_at }),
      /meetings_ends_after_starts/,
      'an end before the start is refused',
    );
  });

  test('a meeting survives with no transcript, the ordinary case', async () => {
    const id = await insert(MEETING);

    const row = await client.query<{ source_id: string | null }>(
      'SELECT source_id FROM meetings WHERE id = $1', [id],
    );
    assert.equal(row.rows[0]!.source_id, null);
  });

  test('a meeting points at the source its transcript became, once one exists', async () => {
    const sourceId = await transcriptSource('meridian-steering.md');
    const id = await insert({ ...MEETING, source_id: sourceId });

    const row = await client.query<{ source_id: string }>(
      'SELECT source_id FROM meetings WHERE id = $1', [id],
    );
    assert.equal(row.rows[0]!.source_id, sourceId);
  });

  test("one day's meetings read back in start order", async () => {
    const last = await insert({
      ...MEETING, title: 'Brighton Partners: tax return check-in',
      starts_at: '2026-08-25T17:00:00+10:00', ends_at: '2026-08-25T17:30:00+10:00',
    });
    const first = await insert({
      ...MEETING, starts_at: '2026-08-25T10:00:00+10:00', ends_at: '2026-08-25T11:00:00+10:00',
    });
    const middle = await insert({
      ...MEETING, title: 'Maybank fortnightly check-in',
      starts_at: '2026-08-25T15:30:00+10:00', ends_at: '2026-08-25T16:00:00+10:00',
    });
    // A neighbouring day, to prove the range filter excludes it rather than
    // the ordering alone happening to leave it last.
    await insert({
      ...MEETING, title: 'Next day, out of range',
      starts_at: '2026-08-26T09:00:00+10:00', ends_at: '2026-08-26T09:30:00+10:00',
    });

    const rows = await client.query<{ id: string }>(
      `SELECT id FROM meetings
        WHERE starts_at >= '2026-08-25T00:00:00+10:00'
          AND starts_at <  '2026-08-26T00:00:00+10:00'
        ORDER BY starts_at`,
    );
    assert.deepEqual(rows.rows.map((row) => row.id), [first, middle, last]);
  });

  test('holds a start, an end, a title, a space, and the attendees', async () => {
    const id = await insert(MEETING);

    const row = await client.query('SELECT * FROM meetings WHERE id = $1', [id]);
    const saved = row.rows[0] as Record<string, unknown>;
    assert.equal(saved['title'], MEETING.title);
    assert.equal(saved['engagement'], MEETING.engagement);
    assert.equal(saved['space'], MEETING.space);
    assert.deepEqual(saved['attendees'], MEETING.attendees);
    assert.ok(saved['starts_at'] instanceof Date);
    assert.ok(saved['ends_at'] instanceof Date);
  });
});
