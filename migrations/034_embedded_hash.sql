-- Records which text each embedding describes. KPA-114.
--
-- A vector says nothing about the text it was made from. KPA-12 kept a chunk's
-- embedding whenever its byte range was unchanged, so a source body edited in
-- place kept a vector for the old words, and a fact whose title or description
-- changed was never embedded again. `embedded_hash` is the SHA-256, in hex, of
-- the exact text sent to the embedder. A row whose text no longer hashes to it
-- is stale, and the embedder selects it again.
--
-- The hash is also what the embedder's update checks. It writes a vector only
-- when the row still hashes to what it embedded, so two runs at once, or a
-- queued job beside `npm run embed`, can never leave a vector for text the row
-- has since stopped holding.
--
-- NULL on a row embedded before this migration, which reads as stale: nothing
-- records what text that vector described, so it is embedded once more.
--
-- Hash and vector are set together or not at all. A hash with no vector would
-- claim a row is current when it was never embedded.

ALTER TABLE source_chunks
  ADD COLUMN embedded_hash text,
  ADD CONSTRAINT source_chunks_hash_needs_vector
    CHECK (embedded_hash IS NULL OR (embedding IS NOT NULL AND embedded_hash ~ '^[0-9a-f]{64}$'));

ALTER TABLE facts
  ADD COLUMN embedded_hash text,
  ADD CONSTRAINT facts_hash_needs_vector
    CHECK (embedded_hash IS NULL OR (embedding IS NOT NULL AND embedded_hash ~ '^[0-9a-f]{64}$'));

COMMENT ON COLUMN source_chunks.embedded_hash IS
  'SHA-256 in hex of the chunk text the embedding describes. A chunk whose '
  'current text hashes to something else is stale. Null on a row embedded '
  'before KPA-114.';
COMMENT ON COLUMN facts.embedded_hash IS
  'SHA-256 in hex of the title, a blank line and the description that the '
  'embedding describes. A fact whose current text hashes to something else is '
  'stale. Null on a row embedded before KPA-114.';

-- @down

-- The constraint goes with the column.
ALTER TABLE facts DROP COLUMN embedded_hash;
ALTER TABLE source_chunks DROP COLUMN embedded_hash;
