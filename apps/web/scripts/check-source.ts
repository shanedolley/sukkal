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

import assert from "node:assert/strict";

import {
  CHAT_ANSWERS,
  FACTS,
  SOURCES,
  findChunk,
  findSource,
} from "../lib/fixtures.ts";

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

const marked = FACTS.length + CHAT_ANSWERS.reduce((n, a) => n + a.citations.length, 0);
console.log(
  `source OK: ${marked} pointers from facts and citations each open a source and mark one passage`
);
