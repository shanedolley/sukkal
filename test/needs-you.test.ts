import assert from 'node:assert/strict';
import path from 'node:path';
import { after, before, beforeEach, describe, test } from 'node:test';
import type { ClientBase } from 'pg';
import { connect } from '../src/db/connect.ts';
import { down, up } from '../src/db/migrate.ts';

const MIGRATIONS = path.join(import.meta.dirname, '..', 'migrations');
const url = process.env['DATABASE_URL_TEST'];

/** The columns every row needs, whatever its kind. Each test overrides only
 *  what it is testing. */
interface Row {
  kind: 'draft' | 'question' | 'denied-action' | 'deadline';
  title: string;
  detail: string;
  space: 'collibra' | 'koinon' | 'personal' | 'shared';
  /** Null until something resolves entities. Migration 010, ADR-0014. */
  entity: string | null;
  factId?: string | null;
  sourceId?: string | null;
  chunkId?: string | null;
  gmailUrl?: string | null;
  auditId?: string | null;
  closedAt?: string | null;
}

const QUESTION: Row = {
  kind: 'question',
  title: 'BHP Meridian: retention question',
  detail: 'Priya asks whether the archive tier goes in this budget round.',
  space: 'collibra',
  entity: 'BHP Meridian',
};

describe('needs_you', { skip: url ? false : 'DATABASE_URL_TEST is unset' }, () => {
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
    // audit is append only, so it is never cleared here; nothing below reads
    // more of it than the rows a test inserts and looks up by their own id.
    await client.query('DELETE FROM needs_you');
    await client.query('DELETE FROM edges');
    await client.query('DELETE FROM source_chunks');
    await client.query('DELETE FROM facts');
    await client.query('DELETE FROM sources');
    await client.query("DELETE FROM nodes WHERE kind IN ('fact', 'source')");
  });

  /** A fresh node of `kind`, returning its id. */
  async function node(kind: string): Promise<string> {
    const created = await client.query<{ id: string }>(
      'INSERT INTO nodes (kind) VALUES ($1) RETURNING id',
      [kind],
    );
    return created.rows[0]!.id;
  }

  /** Both statements in one transaction, per the node registry. */
  async function source(): Promise<string> {
    await client.query('BEGIN');
    const id = await node('source');
    await client.query('INSERT INTO sources (id, path, body) VALUES ($1, $2, $3)', [
      id, `src-${id}.md`, 'body',
    ]);
    await client.query('COMMIT');
    return id;
  }

  async function chunk(sourceId: string): Promise<string> {
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO source_chunks (source_id, ordinal, byte_start, byte_end)
       VALUES ($1, 0, 0, 4) RETURNING id`,
      [sourceId],
    );
    return inserted.rows[0]!.id;
  }

  /** Both statements in one transaction, per the node registry. */
  async function fact(): Promise<string> {
    await client.query('BEGIN');
    const id = await node('fact');
    await client.query(
      `INSERT INTO facts (id, path, type, title, description, space, state, valid_from)
       VALUES ($1, $2, 'reference', 'a fact', 'one line', 'shared', 'proposed', '2026-01-01')`,
      [id, `fact-${id}.md`],
    );
    await client.query('COMMIT');
    return id;
  }

  async function auditEntry(outcome: 'allowed' | 'denied'): Promise<string> {
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO audit (action, intent, before, outcome, result, reverse, space, rule)
       VALUES ('Hold calendar time', 'Hold time for a follow-up', 'Free', $1,
               'Refused and queued.', 'Nothing to reverse.', 'collibra', $2)
       RETURNING id`,
      [outcome, outcome === 'denied' ? 'mail.send.never-unprompted' : null],
    );
    return inserted.rows[0]!.id;
  }

  async function insert(row: Row): Promise<string> {
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO needs_you
         (kind, title, detail, space, entity, fact_id, source_id, chunk_id,
          gmail_url, audit_id, closed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id`,
      [
        row.kind, row.title, row.detail, row.space, row.entity,
        row.factId ?? null, row.sourceId ?? null, row.chunkId ?? null,
        row.gmailUrl ?? null, row.auditId ?? null, row.closedAt ?? null,
      ],
    );
    return inserted.rows[0]!.id;
  }

  describe('a row of any kind', () => {
    test('carries a title, a detail, a space and a raised date as NOT NULL columns', async () => {
      // entity is the exception, and migration 010 made it one. Nothing
      // resolves an entity yet: the vault's frontmatter carries no such field
      // and entities holds no rows. Requiring one meant the sweep's insert
      // failed on the first fact that had none, and one failed insert lost
      // every review item in that run rather than one. ADR-0014 records it.
      const columns = await client.query<{ column_name: string; is_nullable: string }>(
        `SELECT column_name, is_nullable FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'needs_you'
            AND column_name IN ('title', 'detail', 'space', 'entity', 'raised_at')
          ORDER BY column_name`,
      );
      assert.deepEqual(columns.rows, [
        { column_name: 'detail', is_nullable: 'NO' },
        { column_name: 'entity', is_nullable: 'YES' },
        { column_name: 'raised_at', is_nullable: 'NO' },
        { column_name: 'space', is_nullable: 'NO' },
        { column_name: 'title', is_nullable: 'NO' },
      ]);
    });

    test('may name no entity, because nothing resolves one yet', async () => {
      const id = await insert({ ...QUESTION, entity: null });
      const row = await client.query<{ entity: string | null }>(
        'SELECT entity FROM needs_you WHERE id = $1', [id],
      );
      assert.equal(row.rows[0]!.entity, null);
    });

    test('may point at neither a fact nor a source', async () => {
      const id = await insert(QUESTION);
      const row = await client.query<{ fact_id: string | null; source_id: string | null }>(
        'SELECT fact_id, source_id FROM needs_you WHERE id = $1', [id],
      );
      assert.equal(row.rows[0]!.fact_id, null);
      assert.equal(row.rows[0]!.source_id, null);
    });

    test('may point at the fact it concerns', async () => {
      const factId = await fact();
      const id = await insert({ ...QUESTION, factId });
      const row = await client.query<{ fact_id: string }>(
        'SELECT fact_id FROM needs_you WHERE id = $1', [id],
      );
      assert.equal(row.rows[0]!.fact_id, factId);
    });

    test('may point at the source and chunk it came from', async () => {
      const sourceId = await source();
      const chunkId = await chunk(sourceId);
      const id = await insert({ ...QUESTION, sourceId, chunkId });
      const row = await client.query<{ source_id: string; chunk_id: string }>(
        'SELECT source_id, chunk_id FROM needs_you WHERE id = $1', [id],
      );
      assert.equal(row.rows[0]!.source_id, sourceId);
      assert.equal(row.rows[0]!.chunk_id, chunkId);
    });

    test('cannot point at a fact and a source at once', async () => {
      const factId = await fact();
      const sourceId = await source();
      await assert.rejects(
        insert({ ...QUESTION, factId, sourceId }),
        /needs_you_provenance_is_fact_xor_source/,
      );
    });

    test('cannot name a chunk with no source for it to belong to', async () => {
      const sourceId = await source();
      const chunkId = await chunk(sourceId);
      await assert.rejects(
        insert({ ...QUESTION, chunkId, sourceId: null }),
        /needs_you_chunk_needs_a_source/,
      );
    });
  });

  describe('a denied-action row', () => {
    test('needs the audit entry that refused it', async () => {
      await assert.rejects(
        insert({ ...QUESTION, kind: 'denied-action', title: 'Calendar hold refused' }),
        /needs_you_denial_names_its_audit/,
      );
    });

    test('points at a real audit entry once it names one', async () => {
      const auditId = await auditEntry('denied');
      const id = await insert({
        ...QUESTION, kind: 'denied-action', title: 'Calendar hold refused', auditId,
      });
      const row = await client.query<{ audit_id: string }>(
        'SELECT audit_id FROM needs_you WHERE id = $1', [id],
      );
      assert.equal(row.rows[0]!.audit_id, auditId);
    });

    test('an allowed audit entry names no rule of its own, but still stands as the pointer', async () => {
      // The rule that fired lives on the audit row, not copied onto this one,
      // so a denied-action row is free to point at any audit entry Postgres
      // will accept. What guarantees the rule is present is audit's own
      // audit_denial_names_a_rule constraint, proven in test/audit.test.ts.
      const auditId = await auditEntry('allowed');
      const id = await insert({
        ...QUESTION, kind: 'denied-action', title: 'Calendar hold refused', auditId,
      });
      assert.ok(id);
    });
  });

  describe('closing a row', () => {
    test('keeps it, with when it closed', async () => {
      const id = await insert(QUESTION);

      await client.query('UPDATE needs_you SET closed_at = now() WHERE id = $1', [id]);

      const row = await client.query<{ closed_at: Date | null }>(
        'SELECT closed_at FROM needs_you WHERE id = $1', [id],
      );
      assert.ok(row.rows[0]!.closed_at, 'the row records when it closed');

      const stillThere = await client.query('SELECT 1 FROM needs_you WHERE id = $1', [id]);
      assert.equal(stillThere.rows.length, 1, 'the row was not deleted');
    });
  });

  describe('the space filter', () => {
    test('narrows the queue to one space', async () => {
      await insert({ ...QUESTION, space: 'collibra' });
      await insert({ ...QUESTION, space: 'koinon', entity: 'Maybank' });
      await insert({ ...QUESTION, space: 'personal', entity: 'Brighton Partners' });

      const rows = await client.query<{ space: string }>(
        'SELECT space FROM needs_you WHERE space = $1', ['collibra'],
      );
      assert.deepEqual(rows.rows.map((row) => row.space), ['collibra']);
    });
  });

  describe('the questions table', () => {
    test('no longer exists: question is a kind of needs_you instead', async () => {
      const found = await client.query<{ oid: string | null }>(
        "SELECT to_regclass('public.questions') AS oid",
      );
      assert.equal(found.rows[0]!.oid, null);
    });

    test('a question is a row like any other, closed the same way', async () => {
      const id = await insert(QUESTION);
      const row = await client.query<{ kind: string }>(
        'SELECT kind FROM needs_you WHERE id = $1', [id],
      );
      assert.equal(row.rows[0]!.kind, 'question');
    });
  });
});
