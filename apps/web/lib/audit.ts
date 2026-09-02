// Reading the audit log from the database.
//
// The brief calls this the safety net. Nothing approves an action before it
// runs, so this record is what catches a mistake afterwards, and it is only
// as good as what it shows without a click.
//
// Two joins carry the story a key alone cannot tell.
//
// `policies` holds the rule's own words. `audit.rule` names a policy by its
// key, on purpose, so a rule's wording can change without rewriting every
// entry that cited it. That is also why the words have to be read rather than
// copied.
//
// `needs_you` holds where a denial went. A denied action is queued for
// Shane's decision, and a constraint makes that link mandatory on every
// denial, so the log can say which decision is still open and which is not.
//
// It reads and never writes. The table has an append-only trigger and a
// second one against TRUNCATE, and nothing here is meant to meet either.

import type { Pool } from "pg";

import { spacesFor, type SpaceFilter } from "./space.ts";
import type { AuditEntry, AuditOutcome, Space } from "./types";

/** One row of the read below. */
export interface AuditRow {
  id: string;
  at: Date;
  action: string;
  intent: string;
  before: string;
  outcome: AuditOutcome;
  result: string;
  reverse: string;
  space: Space;
  /** The policy's key. Null on an allowed entry, and a check makes it
   *  mandatory on a denial. */
  rule: string | null;
  /** The policy's own words, from `policies`. */
  governs: string | null;
  effect: string | null;
  /** The open Needs you row this denial raised, when one is still open. */
  needs_you_id: string | null;
  needs_you_title: string | null;
}

/** A row as the page renders it. Every field maps from a column. */
export function toEntry(row: AuditRow): AuditEntry {
  return {
    id: row.id,
    at: row.at.toISOString(),
    action: row.action,
    intent: row.intent,
    before: row.before,
    outcome: row.outcome,
    result: row.result,
    reverse: row.reverse,
    space: row.space,
    ...(row.rule ? { rule: row.rule } : {}),
    // Both words or neither. A rule with a `governs` and no `effect` would
    // render half a sentence, and `policies` requires both anyway.
    ...(row.governs && row.effect
      ? { policy: { governs: row.governs, effect: row.effect } }
      : {}),
    ...(row.needs_you_id && row.needs_you_title
      ? { decision: { id: row.needs_you_id, title: row.needs_you_title } }
      : {}),
  };
}

/**
 * Every entry in the chosen spaces, newest first.
 *
 * The outcome filter stays out of this read. `auditRows` in
 * `lib/audit-view.ts` applies it, `scripts/check-audit.ts` proves it, and one
 * read then serves both the page and the sidebar's denied count, so the two
 * cannot disagree.
 *
 * The lateral join takes one open Needs you row rather than joining plainly.
 * Nothing stops two rows naming one entry, and a plain join would then show
 * that entry twice.
 */
export async function readAudit(
  pool: Pool,
  filter: SpaceFilter,
): Promise<AuditEntry[]> {
  const result = await pool.query<AuditRow>(
    `SELECT a.id,
            a.at,
            a.action,
            a.intent,
            a.before,
            a.outcome,
            a.result,
            a.reverse,
            a.space,
            a.rule,
            p.governs,
            p.effect,
            n.id    AS needs_you_id,
            n.title AS needs_you_title
       FROM audit a
       LEFT JOIN policies p ON p.key = a.rule
       LEFT JOIN LATERAL (
            SELECT id, title
              FROM needs_you
             WHERE audit_id = a.id AND closed_at IS NULL
             ORDER BY raised_at DESC
             LIMIT 1
       ) n ON true
      WHERE a.space = ANY($1::space[])
      ORDER BY a.at DESC`,
    [spacesFor(filter)],
  );

  return result.rows.map(toEntry);
}
