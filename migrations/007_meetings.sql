-- meetings: a calendar event, never the transcript it produces.
--
-- The transcript is a source with kind 'meeting' (004_source_columns.sql).
-- A meeting may point at the source its transcript became, and may point at
-- none: that is the ordinary case until nabium sends one.
--
-- Resolving a meeting to an engagement is a later story, so engagement is
-- text rather than a foreign key: no entities row exists yet for it to name.
-- This story stores the attribution it is given rather than deriving one.

CREATE TABLE meetings (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner_id   bigint NOT NULL DEFAULT 1 REFERENCES users (id),

  -- A meeting carries a time of day, so timestamptz rather than the date
  -- columns elsewhere in this schema: a date alone would lose the time.
  -- "end" is reserved in SQL and cannot stand as a bare column name, so both
  -- columns take the "_at" some other timestamptz columns already use.
  starts_at  timestamptz NOT NULL,
  ends_at    timestamptz NOT NULL,

  title      text NOT NULL,
  engagement text NOT NULL,
  space      space NOT NULL,
  attendees  text[] NOT NULL DEFAULT '{}',

  -- Null until a transcript arrives.
  source_id  bigint REFERENCES sources (id),

  CONSTRAINT meetings_ends_after_starts CHECK (ends_at > starts_at)
);

-- The briefing reads one day's meetings in start order.
CREATE INDEX meetings_starts_at ON meetings (starts_at);
CREATE INDEX meetings_source    ON meetings (source_id);

-- @down

DROP TABLE meetings;
