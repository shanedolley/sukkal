-- The colours the owner picked, on the row that owns them.
--
-- ADR-0022 asks of each browser key whether it belongs to the person or to the
-- device. An accent is taste, so `kpa.accent`, `kpa.accent.hex`, `kpa.charts`
-- and `kpa.charts.hex` follow the person to a second device. `kpa.appearance`
-- stays in the browser: it is the resolved token blob
-- `apps/web/components/appearance-bootstrap.tsx` reads before React runs, and a
-- network read on that path flashes.
--
-- ONE JSONB COLUMN, NOT FOUR TEXT ONES. ADR-0022 argues the shape under
-- "Whether a display preference ever follows the user", and all three of its
-- reasons hold here. The four values change together, because the settings
-- screen writes them from one selection. Nothing queries them: no read filters,
-- joins or orders by an accent. The set grows, because every preset family
-- added later is another column under the other shape and no migration under
-- this one.
--
-- NULL MEANS NOBODY HAS CHOSEN. The provider then uses its own default, which
-- is the green the stylesheet already paints. That is why this column joins
-- neither `users_the_account_is_whole` nor any other constraint over the four
-- account columns: a person may set a colour before running the wizard, and a
-- person who never opens the settings screen still has an account.
--
-- WHAT IT REFUSES. `jsonb` admits a number, a string and an array as well as an
-- object, and the reader expects four named fields. The check refuses the three
-- that could never carry them. It stops there rather than naming the fields,
-- because the field names are preset ids that live in
-- `apps/web/lib/appearance.ts` and change with the presets. A constraint
-- repeating them would be a second list to keep in step, and the route that
-- writes this column validates against the first list.

ALTER TABLE users
  ADD COLUMN appearance jsonb
    CONSTRAINT users_appearance_is_an_object
    CHECK (appearance IS NULL OR jsonb_typeof(appearance) = 'object');

COMMENT ON COLUMN users.appearance IS
  'The accent and chart colours the owner picked. Null until they pick one.';

-- @down

-- Dropping the column drops the constraint and the comment naming it, so
-- neither needs a line here.

ALTER TABLE users DROP COLUMN appearance;
