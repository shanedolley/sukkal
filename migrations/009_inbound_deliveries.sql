-- The landing table every inbound webhook writes to.
--
-- A sender posts, this table takes the body verbatim, and the request
-- returns. Nothing here parses what arrived. That is the rule the sources
-- table already obeys, and for the same reason: the sender owns the shape,
-- and a receiver that interprets on the way in loses whatever it failed to
-- understand.
--
-- The table is not nabium's. `source` names the sender, so a second sender
-- needs a value rather than a table. ADR-0013 records why nabium sends this
-- way at all.

CREATE TABLE inbound_deliveries (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  -- Who sent it. 'nabium' today.
  source       text NOT NULL,

  -- The sender's own id for this delivery, and the whole of the idempotency
  -- rule. A sender that retries reuses it, so a retry writes nothing twice.
  -- A sender that cannot produce one gets no at-least-once delivery, which is
  -- a contract failure rather than a schema one.
  delivery_id  text NOT NULL,

  -- What the sender says happened, lifted out of the body so a reader can
  -- filter without parsing every row.
  event        text NOT NULL,

  -- The body as it arrived, parsed no further than JSON.
  payload      jsonb NOT NULL,

  received_at  timestamptz NOT NULL DEFAULT now(),

  -- Set when a worker has taken the row. Null means the work is still owed,
  -- so the backlog is one query and a crash loses nothing.
  processed_at timestamptz,

  -- What went wrong, when something did. A row that fails to process stays
  -- here with its reason rather than disappearing into a log.
  error        text,

  CONSTRAINT inbound_deliveries_unique UNIQUE (source, delivery_id),

  -- An empty identifier is not an identifier, and would make every empty
  -- delivery a duplicate of the first.
  CONSTRAINT inbound_deliveries_identified
    CHECK (length(btrim(source)) > 0 AND length(btrim(delivery_id)) > 0),

  -- A row cannot carry a reason for a failure that has not happened.
  CONSTRAINT inbound_deliveries_error_needs_processing
    CHECK (error IS NULL OR processed_at IS NOT NULL)
);

COMMENT ON TABLE inbound_deliveries IS
  'Webhook bodies, verbatim, waiting for a worker. The sender owns the shape.';

-- The backlog query: what has arrived and nobody has taken. Partial, because
-- the processed rows are the ones this index never has to answer for.
CREATE INDEX inbound_deliveries_unprocessed
  ON inbound_deliveries (source, received_at)
  WHERE processed_at IS NULL;

-- @down

DROP TABLE inbound_deliveries;
