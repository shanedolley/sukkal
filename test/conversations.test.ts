import assert from 'node:assert/strict';
import path from 'node:path';
import { after, before, beforeEach, describe, test } from 'node:test';
import type { ClientBase } from 'pg';
import { connect, refuseProduction } from '../src/db/connect.ts';
import { down, up } from '../src/db/migrate.ts';

const MIGRATIONS = path.join(import.meta.dirname, '..', 'migrations');
const url = process.env['DATABASE_URL_TEST'];

describe('conversations, answers and citations', { skip: url ? false : 'DATABASE_URL_TEST is unset' }, () => {
  let client: ClientBase & { end: () => Promise<void> };

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

  beforeEach(async () => {
    await client.query('DELETE FROM citations');
    await client.query('DELETE FROM answers');
    await client.query('DELETE FROM conversations');
    await client.query('DELETE FROM source_chunks');
    await client.query('DELETE FROM sources');
    await client.query("DELETE FROM nodes WHERE kind = 'source'");
  });

  /** Both statements in one transaction, per the node registry. */
  async function source(sourcePath: string, space: 'collibra' | 'koinon' | 'personal'): Promise<string> {
    await client.query('BEGIN');
    const node = await client.query<{ id: string }>(
      "INSERT INTO nodes (kind) VALUES ('source') RETURNING id",
    );
    const id = node.rows[0]!.id;
    await client.query(
      'INSERT INTO sources (id, path, body, space) VALUES ($1, $2, $3, $4)',
      [id, sourcePath, 'body', space],
    );
    await client.query('COMMIT');
    return id;
  }

  async function chunk(sourceId: string, ordinal: number): Promise<string> {
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO source_chunks (source_id, ordinal, byte_start, byte_end)
       VALUES ($1, $2, 0, 4) RETURNING id`,
      [sourceId, ordinal],
    );
    return inserted.rows[0]!.id;
  }

  async function conversation(title: string): Promise<string> {
    const inserted = await client.query<{ id: string }>(
      'INSERT INTO conversations (title) VALUES ($1) RETURNING id',
      [title],
    );
    return inserted.rows[0]!.id;
  }

  async function answer(
    conversationId: string,
    question: string,
    askedAt: string,
  ): Promise<string> {
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO answers (conversation_id, question, answer, asked_at)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [conversationId, question, `answer to: ${question}`, askedAt],
    );
    return inserted.rows[0]!.id;
  }

  async function cite(
    answerId: string,
    sourceId: string,
    chunkId: string,
    label: string,
  ): Promise<void> {
    await client.query(
      'INSERT INTO citations (answer_id, source_id, chunk_id, label) VALUES ($1, $2, $3, $4)',
      [answerId, sourceId, chunkId, label],
    );
  }

  /** The spaces an answer's citations came from, read the way a reader must:
   *  through the join, never from a stored column. */
  async function spacesCited(answerId: string): Promise<string[]> {
    const rows = await client.query<{ space: string | null }>(
      `SELECT DISTINCT sources.space
         FROM citations JOIN sources ON sources.id = citations.source_id
        WHERE citations.answer_id = $1`,
      [answerId],
    );
    return rows.rows.map((row) => row.space).filter((space): space is string => space !== null);
  }

  /** lib/space.ts: two or more distinct spaces is a crossing, one is not. */
  function crosses(spaces: string[]): boolean {
    return new Set(spaces).size > 1;
  }

  describe('a conversation', () => {
    test('holds a title, when it started and when it last moved', async () => {
      const id = await conversation('Day rates across both companies');
      const row = await client.query<{ title: string; started_at: Date; last_at: Date }>(
        'SELECT title, started_at, last_at FROM conversations WHERE id = $1',
        [id],
      );
      assert.equal(row.rows[0]!.title, 'Day rates across both companies');
      assert.ok(row.rows[0]!.started_at, 'started_at was set');
      assert.ok(row.rows[0]!.last_at, 'last_at was set');
    });

    test('carries no stored token total, so it cannot disagree with lib/context-window.ts', async () => {
      const columns = await client.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'conversations'`,
      );
      const names = columns.rows.map((row) => row.column_name);
      assert.ok(
        !names.some((name) => /token/i.test(name)),
        `conversations carries a token column: ${names.join(', ')}`,
      );
    });
  });

  describe('an answer', () => {
    test('requires a real conversation', async () => {
      await assert.rejects(
        answer('0', 'a question', new Date().toISOString()),
        /violates foreign key constraint/,
      );
    });

    test('carries no stored crossing flag, so it cannot disagree with lib/space.ts', async () => {
      const columns = await client.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'answers'`,
      );
      const names = columns.rows.map((row) => row.column_name);
      assert.ok(
        !names.some((name) => /cross/i.test(name) || /space/i.test(name)),
        `answers carries a crossing or space column: ${names.join(', ')}`,
      );
    });

    test('reads back in the order it was asked, not in the order it was inserted', async () => {
      const conversationId = await conversation('Everything Meridian agreed this year');

      // Inserted out of order: the second row asked first, the first row
      // asked last. Ordering by id or by insertion order would return them
      // wrong, so this is what proves the query orders by asked_at.
      const second = await answer(conversationId, 'second question', '2026-08-21T14:10:00+10:00');
      const first = await answer(conversationId, 'first question', '2026-08-21T14:02:00+10:00');
      const third = await answer(conversationId, 'third question', '2026-08-21T15:47:00+10:00');

      assert.ok(
        Number(second) < Number(first),
        'the fixture only proves the point if asked_at order differs from id order',
      );

      const rows = await client.query<{ id: string }>(
        `SELECT id FROM answers WHERE conversation_id = $1 ORDER BY asked_at`,
        [conversationId],
      );
      assert.deepEqual(rows.rows.map((row) => row.id), [first, second, third]);
    });
  });

  describe('a citation', () => {
    test('names a source, a chunk that exists, and the label the chip shows', async () => {
      const sourceId = await source('koinon-rates.md', 'koinon');
      const chunkId = await chunk(sourceId, 0);
      const conversationId = await conversation('Day rates across both companies');
      const answerId = await answer(conversationId, 'What day rate?', new Date().toISOString());
      await cite(answerId, sourceId, chunkId, 'Koinon rate card 2026');

      const row = await client.query<{ source_id: string; chunk_id: string; label: string }>(
        `SELECT citations.source_id, citations.chunk_id, citations.label
           FROM citations
           JOIN source_chunks ON source_chunks.id = citations.chunk_id
          WHERE citations.answer_id = $1`,
        [answerId],
      );
      assert.equal(row.rows.length, 1, 'the chunk the citation names resolves to a real row');
      assert.equal(row.rows[0]!.source_id, sourceId);
      assert.equal(row.rows[0]!.chunk_id, chunkId);
      assert.equal(row.rows[0]!.label, 'Koinon rate card 2026');
    });

    test('is refused when the chunk does not exist', async () => {
      const sourceId = await source('koinon-rates.md', 'koinon');
      const conversationId = await conversation('Day rates across both companies');
      const answerId = await answer(conversationId, 'What day rate?', new Date().toISOString());

      await assert.rejects(
        cite(answerId, sourceId, '0', 'a made-up chunk'),
        /violates foreign key constraint/,
      );
    });

    test('is refused when the answer does not exist', async () => {
      const sourceId = await source('koinon-rates.md', 'koinon');
      const chunkId = await chunk(sourceId, 0);

      await assert.rejects(
        cite('0', sourceId, chunkId, 'a made-up answer'),
        /violates foreign key constraint/,
      );
    });

    test('is refused when the chunk belongs to another source', async () => {
      // The worst kind of wrong: the citation names a real source and a real
      // chunk, so every single-column check passes, and the drawer opens the
      // wrong text under the right title. A reader cannot tell, and neither
      // can the screen, so the pair has to be checked together.
      const named = await source('koinon-rates.md', 'koinon');
      const other = await source('collibra-retention.md', 'collibra');
      const strayChunk = await chunk(other, 0);

      const conversationId = await conversation('Day rates across both companies');
      const answerId = await answer(conversationId, 'What day rate?', new Date().toISOString());

      await assert.rejects(
        cite(answerId, named, strayChunk, 'the wrong passage under the right title'),
        /citations_chunk_belongs_to_source/,
      );
    });
  });

  describe('the crossing rule, derived rather than stored', () => {
    test('an answer citing one space, twice, does not cross', async () => {
      const sourceId = await source('meridian-retention.md', 'collibra');
      const chunkA = await chunk(sourceId, 0);
      const chunkB = await chunk(sourceId, 1);
      const conversationId = await conversation('BHP lineage retention');
      const answerId = await answer(conversationId, 'What did BHP agree?', new Date().toISOString());
      await cite(answerId, sourceId, chunkA, 'Meridian retention session, 19 Aug');
      await cite(answerId, sourceId, chunkB, 'Meridian retention session, 19 Aug');

      assert.equal(crosses(await spacesCited(answerId)), false);
    });

    test('an answer citing two spaces crosses', async () => {
      const koinonSource = await source('koinon-rates.md', 'koinon');
      const koinonChunk = await chunk(koinonSource, 0);
      const collibraSource = await source('meridian-retention.md', 'collibra');
      const collibraChunk = await chunk(collibraSource, 0);
      const conversationId = await conversation('Day rates across both companies');
      const answerId = await answer(conversationId, 'What day rate?', new Date().toISOString());
      await cite(answerId, koinonSource, koinonChunk, 'Koinon rate card 2026');
      await cite(answerId, collibraSource, collibraChunk, 'Meridian retention session, 19 Aug');

      assert.equal(crosses(await spacesCited(answerId)), true);
    });
  });
});
