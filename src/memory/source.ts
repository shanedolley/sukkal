/**
 * The chunk-text resolver.
 *
 * source_chunks stores a byte range into sources.body, not a second copy of
 * the passage: a source is verbatim, and two copies would drift. This turns
 * that range back into text.
 *
 * The range is bytes. `String.prototype.slice` counts UTF-16 code units, so
 * it agrees with a byte offset only while every character is ASCII. A
 * passage past a wider character needs a Buffer, which counts the same bytes
 * the range does.
 */
import type { ClientBase } from 'pg';

export interface Chunk {
  byteStart: number;
  byteEnd: number;
}

/** The passage `chunk` names, read out of `body` by its byte range. */
export function chunkText(body: string, chunk: Chunk): string {
  return Buffer.from(body, 'utf8').subarray(chunk.byteStart, chunk.byteEnd).toString('utf8');
}

export interface Passage {
  chunkId: string;
  sourceId: string;
  text: string;
}

/**
 * The passage a fact's derived_from edge names, if it names one.
 *
 * A derived_from edge already points from the fact to the source. This reads
 * the chunk it also names, joined back to the same source, so a chunk_id
 * left over from a different source by a data error resolves to nothing
 * rather than the wrong passage. Undefined when the fact has no derived_from
 * edge, or the edge names no chunk.
 */
export async function chunkForFact(client: ClientBase, factId: string): Promise<Passage | undefined> {
  const found = await client.query<{
    chunk_id: string;
    source_id: string;
    byte_start: number;
    byte_end: number;
    body: string;
  }>(
    `SELECT c.id AS chunk_id, c.source_id, c.byte_start, c.byte_end, s.body
       FROM edges e
       JOIN source_chunks c ON c.id = e.chunk_id AND c.source_id = e.to_id
       JOIN sources s ON s.id = c.source_id
      WHERE e.from_id = $1 AND e.kind = 'derived_from'`,
    [factId],
  );
  const row = found.rows[0];
  if (!row) {
    return undefined;
  }
  return {
    chunkId: row.chunk_id,
    sourceId: row.source_id,
    text: chunkText(row.body, { byteStart: row.byte_start, byteEnd: row.byte_end }),
  };
}
