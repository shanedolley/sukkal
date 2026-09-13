import assert from 'node:assert/strict';
import path from 'node:path';
import { after, before, beforeEach, describe, test } from 'node:test';
import type { ClientBase } from 'pg';
import { connect, refuseProduction } from '../src/db/connect.ts';
import { down, up } from '../src/db/migrate.ts';
import { chunkForFact, chunkText } from '../src/memory/source.ts';

const MIGRATIONS = path.join(import.meta.dirname, '..', 'migrations');
const url = process.env['DATABASE_URL_TEST'];

describe('chunkText', () => {
  test('returns the exact bytes a range names, past a character outside ASCII', () => {
    // "日本語" is three characters, three UTF-16 code units, and nine UTF-8
    // bytes: each character takes three bytes there. A byte offset and a
    // character offset disagree from the first character on, so a slice by
    // character would read the wrong span.
    const body = 'before 日本語 after';
    const byteStart = Buffer.byteLength('before ', 'utf8');
    const byteEnd = byteStart + Buffer.byteLength('日本語', 'utf8');

    assert.equal(chunkText(body, { byteStart, byteEnd }), '日本語');
    assert.notEqual(
      byteEnd - byteStart,
      '日本語'.length,
      'the byte width and the character width disagree',
    );
  });

  test('returns the exact bytes a range names, past a character needing a surrogate pair', () => {
    // An emoji is one character, two UTF-16 code units, and four UTF-8
    // bytes: a third way for the two offsets to disagree.
    const body = 'note 😀 taken';
    const byteStart = Buffer.byteLength('note ', 'utf8');
    const byteEnd = byteStart + Buffer.byteLength('😀', 'utf8');

    assert.equal(chunkText(body, { byteStart, byteEnd }), '😀');
  });
});

describe('chunkForFact', { skip: url ? false : 'DATABASE_URL_TEST is unset' }, () => {
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
  async function source(sourcePath: string, body: string): Promise<string> {
    await client.query('BEGIN');
    const id = await node('source');
    await client.query('INSERT INTO sources (id, path, body) VALUES ($1, $2, $3)', [
      id, sourcePath, body,
    ]);
    await client.query('COMMIT');
    return id;
  }

  async function insertChunk(
    sourceId: string,
    ordinal: number,
    range: { byteStart: number; byteEnd: number },
  ): Promise<string> {
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO source_chunks (source_id, ordinal, byte_start, byte_end)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [sourceId, ordinal, range.byteStart, range.byteEnd],
    );
    return inserted.rows[0]!.id;
  }

  /** Both statements in one transaction, per the node registry. */
  async function fact(factPath: string): Promise<string> {
    await client.query('BEGIN');
    const id = await node('fact');
    await client.query(
      `INSERT INTO facts (id, path, type, title, description, space, state, valid_from)
       VALUES ($1, $2, 'reference', $3, 'one line', 'shared', 'proposed', '2026-01-01')`,
      [id, factPath, factPath],
    );
    await client.query('COMMIT');
    return id;
  }

  async function derivedFrom(factId: string, sourceId: string, chunkId?: string): Promise<void> {
    await client.query(
      'INSERT INTO edges (from_id, to_id, kind, chunk_id) VALUES ($1, $2, $3, $4)',
      [factId, sourceId, 'derived_from', chunkId ?? null],
    );
  }

  test('resolves a fact to the one chunk its derived_from edge names', async () => {
    const body = 'the passage a fact came from, verbatim';
    const sourceId = await source('a-source.md', body);
    const byteStart = Buffer.byteLength('the ', 'utf8');
    const byteEnd = byteStart + Buffer.byteLength('passage', 'utf8');
    const chunkId = await insertChunk(sourceId, 0, { byteStart, byteEnd });
    const factId = await fact('a-fact.md');
    await derivedFrom(factId, sourceId, chunkId);

    const passage = await chunkForFact(client, factId);
    assert.ok(passage, 'a passage was found');
    assert.equal(passage.chunkId, chunkId);
    assert.equal(passage.sourceId, sourceId, 'the chunk belongs to the source the fact names');
    assert.equal(passage.text, 'passage');
  });

  test('returns undefined when the derived_from edge names no chunk', async () => {
    const sourceId = await source('a-source.md', 'body');
    const factId = await fact('a-fact.md');
    await derivedFrom(factId, sourceId);

    assert.equal(await chunkForFact(client, factId), undefined);
  });

  test('returns undefined for a chunk that belongs to a different source than the edge names', async () => {
    const namedSource = await source('named.md', 'the source the fact names');
    const otherSource = await source('other.md', 'a different source entirely');
    const otherChunk = await insertChunk(otherSource, 0, { byteStart: 0, byteEnd: 4 });
    const factId = await fact('a-fact.md');
    await derivedFrom(factId, namedSource, otherChunk);

    assert.equal(
      await chunkForFact(client, factId),
      undefined,
      'the chunk names a source other than the one the edge points at',
    );
  });

  test('resolves the exact bytes past a character outside ASCII, end to end', async () => {
    const body = 'meeting notes: 日本語 was the topic';
    const byteStart = Buffer.byteLength('meeting notes: ', 'utf8');
    const byteEnd = byteStart + Buffer.byteLength('日本語', 'utf8');
    const sourceId = await source('multibyte.md', body);
    const chunkId = await insertChunk(sourceId, 0, { byteStart, byteEnd });
    const factId = await fact('multibyte-fact.md');
    await derivedFrom(factId, sourceId, chunkId);

    const passage = await chunkForFact(client, factId);
    assert.equal(passage?.text, '日本語');
  });
});
