/**
 * Retirement: how a fact stops being true.
 *
 * **Only a source or a human sets `valid_to`. Time alone never does.** A fact
 * past its `stale_after` is due for review, not false, so the staleness sweep
 * reads and never writes.
 *
 * Nothing is deleted at any point. Retiring sets a date, so asking what was
 * true in March stays a plain query and decay stays visible.
 *
 * Known limitation, recorded rather than fixed: these two columns answer what
 * was *true* in March, not what the system *believed* in March. A backdated
 * retirement rewrites the first answer with no record that it used to differ.
 * A `recorded_at` column upgrades this later without a rewrite. It is
 * deliberately absent.
 */
import type { ClientBase } from 'pg';

/** A date as `YYYY-MM-DD`. */
export type Day = string;

export interface Retired {
  id: string;
  path: string;
  validTo: Day;
  /** True when the date came from the source's own date rather than a stated one. */
  inferred: boolean;
}

/**
 * Sets `valid_to` on one live fact.
 *
 * One statement, so it is atomic on its own. It joins the caller's transaction
 * when there is one, which is how a supersede commits with its replacement.
 */
async function setValidTo(
  client: ClientBase,
  path: string,
  validTo: Day,
  inferred: boolean,
): Promise<Retired> {
  const updated = await client.query<{ id: string }>(
    `UPDATE facts SET valid_to = $2, valid_to_inferred = $3
      WHERE path = $1 AND valid_to IS NULL
      RETURNING id`,
    [path, validTo, inferred],
  );
  const row = updated.rows[0];
  if (!row) {
    throw new Error(`nothing live to retire at ${path}`);
  }
  return { id: row.id, path, validTo, inferred };
}

/**
 * A contradicting source retires a fact.
 *
 * `effective` is the date the change took effect according to that source. An
 * email saying someone left in June retires the fact as of June, not as of the
 * day Sukkal read the email.
 *
 * Where the source states no date, pass `sourceDate` alone. `valid_to` then
 * takes the source's own date and the fact records that the date was inferred,
 * because recording the uncertainty is what the vault's never-guess rule
 * requires. Guessing silently closes the question wrongly, for years.
 */
export function retireBySource(
  client: ClientBase,
  path: string,
  dates: { effective?: Day; sourceDate: Day },
): Promise<Retired> {
  const stated = dates.effective !== undefined;
  return setValidTo(client, path, stated ? dates.effective! : dates.sourceDate, !stated);
}

/** Shane retires a fact, on whatever date he gives. Never inferred: he stated it. */
export function retireByHuman(client: ClientBase, path: string, validTo: Day): Promise<Retired> {
  return setValidTo(client, path, validTo, false);
}

/**
 * A replacement retires the fact it supersedes, and links the two.
 *
 * The old fact's `valid_to` becomes the replacement's `valid_from`, so exactly
 * one answer stands at any date: no gap, and no overlap.
 *
 * Two statements, so **the caller must hold a transaction**. Two answers must
 * never both be live, and a half-applied supersede is exactly that.
 */
export async function supersede(
  client: ClientBase,
  replacementId: string,
  contradictedPath: string,
  validFrom: Day,
): Promise<Retired> {
  const retired = await setValidTo(client, contradictedPath, validFrom, false);
  await client.query(
    "INSERT INTO edges (from_id, to_id, kind) VALUES ($1, $2, 'supersedes')",
    [replacementId, retired.id],
  );
  return retired;
}

/** The facts that were true on `day`. Retirement is a date, so this is a query. */
export async function asAt(client: ClientBase, day: Day): Promise<string[]> {
  const live = await client.query<{ path: string }>(
    `SELECT path FROM facts
      WHERE valid_from <= $1 AND (valid_to IS NULL OR valid_to > $1)
      ORDER BY path`,
    [day],
  );
  return live.rows.map((row) => row.path);
}

/**
 * The live facts past their review date on `day`.
 *
 * **This reads and never writes.** A stale fact is a fact doing its job rather
 * than a defect, and retiring one on a timer would make the system quietly
 * forget things nobody contradicted. src/memory/sweep.ts raises the review
 * item on top of this.
 *
 * Two conditions come from ADR-0010, which settled the state after this
 * function was written. A fact goes stale strictly past `stale_after`, so one
 * falling due today is not yet stale. And only a verified fact can go stale,
 * because an unverified one has nothing to have gone stale from: it is still
 * waiting on its first confirmation. `factState` derives the same two, and the
 * two must not disagree, because KPA-13 diffs this report against the vault's.
 */
export async function stale(client: ClientBase, day: Day): Promise<string[]> {
  const due = await client.query<{ path: string }>(
    `SELECT path FROM facts
      WHERE valid_to IS NULL AND verified IS NOT NULL
        AND stale_after IS NOT NULL AND stale_after < $1
      ORDER BY stale_after, path`,
    [day],
  );
  return due.rows.map((row) => row.path);
}
