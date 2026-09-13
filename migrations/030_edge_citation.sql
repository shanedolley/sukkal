-- Keeps a citation's words on the edge it became. KPA-131.
--
-- A `sources:` entry is a sentence, and most name where a fact came from as
-- well as linking it: "Shane, answers in [[index]], 23 August 2026". Before
-- this column the migration kept the link and threw the sentence away, so the
-- edge pointed at `index` and the author, the place and the date were gone.
-- Eight entries in the frozen vault lost their words that way, measured on
-- 13 September 2026: seven naming `[[index]]`, and one naming a real source.
--
-- The target does not move. An entry still resolves to the note its wikilink
-- names, exactly as before, and `citation` holds the entry verbatim beside it.
-- Changing the target instead, to a node holding the whole sentence, would
-- have kept the words and lost the link, which is the same defect the other
-- way round.
--
-- Every `derived_from` edge the migration writes carries its entry, including
-- the ones whose target already holds the same text, so the rule reads as one
-- sentence: a citation edge keeps the words it was written in. A `links_to` or
-- `supersedes` edge names no citation, and the constraint holds that.
--
-- Nullable, because the migration is the only writer that has a sentence to
-- keep. `src/migrate/load.ts` and `src/memory/retire.ts` are the only code that
-- writes an edge today, and the second writes `supersedes`.

ALTER TABLE edges
  ADD COLUMN citation text,
  ADD CONSTRAINT edges_citation_is_derived_from
    CHECK (kind = 'derived_from' OR citation IS NULL);

COMMENT ON COLUMN edges.citation IS
  'The sources: entry a derived_from edge was written from, verbatim. It keeps '
  'the author, the place and the date a citation stated, which the target '
  'alone does not carry. Null on every other kind.';

-- @down

-- The constraint goes with the column, so naming it here would drop it twice.
ALTER TABLE edges DROP COLUMN citation;
