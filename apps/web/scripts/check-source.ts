// The check the source drawer needs. Run: npm run check
//
// Two things open the drawer, and both hand it the same pair: a source and the
// chunk to mark. A citation on a chat answer opens it, and so does the
// provenance on a fact card. The drawer then marks that one chunk.
//
// A pointer that resolves to nothing opens a drawer that marks nothing, and
// the reader cannot tell that from a source whose passage was never cited.
// This check follows the lookup the drawer itself calls, so a rename of a
// chunk id fails here rather than on the screen.
//
// KPA-42. The keyboard behaviour is not proved here. Focus trapping and focus
// return come from Base UI, and a DOM assertion needs a test runner this
// project does not have.
//
// KPA-119 moved the drawer onto the database, and sections 6 to 9 below carry
// that half. A real source holds a body and a byte range per chunk, so the
// passage is cut out rather than stored twice, and the cut is the part that
// goes wrong silently. Sections 1 to 5 still guard the fixtures the facts and
// the chat answers still read.

import assert from "node:assert/strict";

import {
  CHAT_ANSWERS,
  FACTS,
  SOURCES,
  findChunk,
  findSource,
} from "../lib/fixtures.ts";
import { toSource, type ChunkRow, type SourceRow } from "../lib/sources.ts";

// 1. The provenance on every fact card opens a source that exists and marks a
//    passage inside it.
for (const fact of FACTS) {
  const source = findSource(fact.provenance.sourceId);
  assert.ok(source, `fact ${fact.id} opens a source that does not exist`);
  const chunk = findChunk(fact.provenance);
  assert.ok(chunk, `fact ${fact.id} marks a passage that does not exist`);
  assert.ok(
    source.chunks.some((c) => c.id === chunk.id),
    `fact ${fact.id} marks a passage from another source`
  );
}

// 2. Every citation on every chat answer, the same way.
for (const answer of CHAT_ANSWERS) {
  for (const citation of answer.citations) {
    const source = findSource(citation.sourceId);
    assert.ok(source, `chat answer ${answer.id} cites a source that does not exist`);
    assert.ok(
      findChunk(citation),
      `chat answer ${answer.id} marks a passage that does not exist`
    );
    assert.ok(
      citation.label.trim().length > 0,
      `a citation on ${answer.id} has no label, so the chip reads blank`
    );
  }
}

// 3. A chunk id is unique inside its source. Two chunks with one id mark two
//    passages, and the reader cannot tell which one the fact came from.
for (const source of SOURCES) {
  const ids = source.chunks.map((chunk) => chunk.id);
  assert.equal(
    new Set(ids).size,
    ids.length,
    `source ${source.id} repeats a chunk id`
  );
  assert.ok(ids.length > 0, `source ${source.id} holds no passage to mark`);
}

// 4. Every passage carries text. A marked chunk with none draws a highlighted
//    empty box, which reads as a fault in the drawer rather than in the data.
for (const source of SOURCES) {
  for (const chunk of source.chunks) {
    assert.ok(
      chunk.text.trim().length > 0,
      `${source.id}#${chunk.id} is empty, so the drawer marks nothing`
    );
  }
}

// 5. The drawer shows the kind, the date, the space and the author beside the
//    text, so each source has to carry all four.
for (const source of SOURCES) {
  for (const field of ["kind", "date", "space", "author", "title"] as const) {
    assert.ok(
      String(source[field]).trim().length > 0,
      `source ${source.id} has no ${field}, so the drawer heading is incomplete`
    );
  }
}

// ── The database read ────────────────────────────────────────────────────

/** A row as the read hands it over, with every column filled. */
function row(over: Partial<SourceRow> = {}): SourceRow {
  return {
    id: "7",
    kind: "meeting",
    title: "BHP Meridian: retention working session",
    date: "2026-08-19",
    author: "nabium transcript",
    space: "collibra",
    body: "Priya: café au lait. Nigel: three years hot.",
    ...over,
  };
}

// 6. A byte range is cut with a Buffer, not with String.slice. The body above
//    carries one two-byte character, so the two disagree from that point on,
//    and only the Buffer agrees with what Postgres counted.
//
//    "Priya: caf" is 10 bytes and 10 code units. "é" takes two bytes and one
//    code unit, so the second passage starts at byte 12 and code unit 11.
const body = row().body;
const second: ChunkRow = { id: "2", byte_start: 12, byte_end: 20 };
const cut = toSource(row(), [second]);
assert.equal(
  cut?.chunks[0]?.text,
  Buffer.from(body, "utf8").subarray(12, 20).toString("utf8"),
  "the passage was not cut on the byte range Postgres recorded"
);
assert.notEqual(
  cut?.chunks[0]?.text,
  body.slice(12, 20),
  "the check body has no wide character, so it proves nothing about the cut"
);

// 7. Every passage keeps the order the read gave it, which is ordinal order.
//    A drawer that reorders them marks the right passage in the wrong place.
const ordered = toSource(row(), [
  { id: "1", byte_start: 0, byte_end: 10 },
  { id: "2", byte_start: 12, byte_end: 20 },
  { id: "3", byte_start: 21, byte_end: 30 },
]);
assert.deepEqual(ordered?.chunks.map((chunk) => chunk.id), ["1", "2", "3"]);

// 8. A source missing any of the five columns migration 004 added opens
//    nothing. Every one of them is nullable and nothing fills them yet, so a
//    half-drawn heading is the failure this refuses.
for (const field of ["kind", "title", "date", "author", "space"] as const) {
  assert.equal(
    toSource(row({ [field]: null }), []),
    null,
    `a source with no ${field} still opened the drawer`
  );
}

// 9. A source nothing has chunked still opens, with no passage marked. That
//    is the derived_from edge written before chunking existed, and it is a
//    source at the top rather than an error.
const unchunked = toSource(row(), []);
assert.ok(unchunked, "a source with no passages failed to open");
assert.deepEqual(unchunked.chunks, []);
assert.equal(unchunked.title, "BHP Meridian: retention working session");
assert.equal(unchunked.date, "2026-08-19");

const marked = FACTS.length + CHAT_ANSWERS.reduce((n, a) => n + a.citations.length, 0);
console.log(
  `source OK: ${marked} fixture pointers each open a source and mark one passage, and a byte range cuts the passage a wide character would move`
);
