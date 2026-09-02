// Reading a source and its passages from the database.
//
// The drawer answers one question: where did this come from? A fixture source
// carried its passages inline. A real one carries a body and a byte range per
// chunk, because `sources` is verbatim and a second copy of the passage would
// drift from it.
//
// The range is bytes, so `chunkText` in the root package resolves it through a
// Buffer. `String.prototype.slice` counts UTF-16 code units and agrees with a
// byte offset only while every character is ASCII, which is why that module
// holds the rule and this file calls it rather than repeating it.
//
// Two imports below name the file extension and the third does not. The
// difference is real: a type-only import vanishes under type erasure, and the
// other two have to resolve under plain node so scripts/check-source.ts and
// scripts/check-sources.ts can run them. KPA-68 makes apps/web a workspace of
// the root, which removes the distinction.
//
// KPA-132 added the list below. The drawer opens one source and the command
// palette lists them all, and both read this file, so they cannot disagree
// about which sources the memory holds.

import type { Pool } from "pg";

import { chunkText } from "../../../src/memory/source.ts";
import { spacesFor, type SpaceFilter } from "./space.ts";
import type { Source, SourceChunk, SourceKind, Space } from "./types";

/** The `sources` columns the drawer shows, plus the body a chunk cuts from.
 *  Migration 004 added the five and left every one nullable. */
export interface SourceRow {
  id: string;
  kind: SourceKind | null;
  title: string | null;
  /** `YYYY-MM-DD`. The driver hands a `date` back as text, never as a `Date`. */
  date: string | null;
  author: string | null;
  space: Space | null;
  body: string;
}

/** One `source_chunks` row, in `ordinal` order. */
export interface ChunkRow {
  id: string;
  byte_start: number;
  byte_end: number;
}

/**
 * A source as the drawer renders it, or null when it cannot render one.
 *
 * Null on a row missing any of the five columns. Nothing fills them yet: the
 * story that writes the vault's 32 sources does, and until then a row exists
 * that has no kind to badge and no date to show. A drawer with an empty
 * heading reads as a fault in the drawer, so this says there is nothing to
 * open rather than opening something half drawn.
 */
export function toSource(row: SourceRow, chunks: ChunkRow[]): Source | null {
  if (!row.kind || !row.title || !row.date || !row.author || !row.space) {
    return null;
  }

  const passages: SourceChunk[] = chunks.map((chunk) => ({
    id: chunk.id,
    text: chunkText(row.body, { byteStart: chunk.byte_start, byteEnd: chunk.byte_end }),
  }));

  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    date: row.date,
    author: row.author,
    space: row.space,
    chunks: passages,
  };
}

/**
 * One source and every passage in it, in the order they appear in the body.
 *
 * The caller hands in the pool, the same way every function in the root
 * package takes the client it queries with.
 *
 * A source with no chunks is a source nothing has chunked yet. It still opens,
 * at the top, with nothing marked.
 */
export async function readSource(pool: Pool, id: string): Promise<Source | null> {
  const found = await pool.query<SourceRow>(
    `SELECT id, kind, title, date, author, space, body
       FROM sources
      WHERE id = $1`,
    [id],
  );
  const row = found.rows[0];
  if (!row) return null;

  const chunks = await pool.query<ChunkRow>(
    `SELECT id, byte_start, byte_end
       FROM source_chunks
      WHERE source_id = $1
      ORDER BY ordinal`,
    [id],
  );

  return toSource(row, chunks.rows);
}

/**
 * A source as a list names it: everything but the passages.
 *
 * The palette prints a title, an author and a date, and it opens the drawer
 * on the id. It never prints a passage, and a body per row is the whole file,
 * so the list leaves both behind.
 */
export type SourceSummary = Omit<Source, "chunks">;

/** The columns the list reads. It is `SourceRow` without the body. */
export type SummaryRow = Omit<SourceRow, "body">;

/**
 * A row as the list renders it, or null when the drawer could not open it.
 *
 * The five columns are the five `toSource` demands, and they are the same
 * five on purpose. A row the drawer refuses is a row the palette must not
 * offer: the reader picks it, the drawer says the source is not in the memory
 * yet, and the palette has sent them to a dead end. That was the defect
 * KPA-132 fixes, so the two rules are checked against each other in
 * scripts/check-sources.ts rather than trusted to stay in step.
 */
export function toSummary(row: SummaryRow): SourceSummary | null {
  if (!row.kind || !row.title || !row.date || !row.author || !row.space) {
    return null;
  }

  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    date: row.date,
    author: row.author,
    space: row.space,
  };
}

/**
 * Every source the chosen spaces hold, newest first.
 *
 * The space filter runs in SQL, for the reason `lib/needs-you.ts` gives: a
 * filter applied in the browser has already sent every row across the wire.
 * `spacesFor` carries `shared` with each space, so a caller must not narrow
 * these rows again. ADR-0018.
 *
 * The four null tests are the SQL half of `toSummary`. They drop the
 * incomplete rows in the database rather than over the wire, and `space =
 * ANY` drops the fifth by refusing to match a null. `toSummary` still guards
 * every row, because the types say the columns are nullable and a query is
 * easier to edit than a rule.
 *
 * The order is the date the source carries, not the date it arrived. A
 * reader looking for last week's meeting knows when the meeting was.
 */
export async function listSources(
  pool: Pool,
  filter: SpaceFilter,
): Promise<SourceSummary[]> {
  const found = await pool.query<SummaryRow>(
    `SELECT id, kind, title, date, author, space
       FROM sources
      WHERE space = ANY($1::space[])
        AND kind IS NOT NULL
        AND title IS NOT NULL
        AND date IS NOT NULL
        AND author IS NOT NULL
      ORDER BY date DESC, id`,
    [spacesFor(filter)],
  );

  return found.rows
    .map(toSummary)
    .filter((source): source is SourceSummary => source !== null);
}
