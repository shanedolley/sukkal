// The audit log's row rules, held apart from the page so a check can import
// them. The page decides nothing of its own: it renders what this returns.
//
// The space filter is not here. It belongs to every page alike and lives in
// lib/space.ts, so the page narrows by space first and passes the result in.

import type { AuditEntry, AuditOutcome } from "./types";

/** "all" means every outcome. */
export type OutcomeFilter = AuditOutcome | "all";

/**
 * The rows the audit log shows, newest first.
 *
 * The fixtures are written in narrative order, and a log out of time order is
 * not a log. The sort copies its input, so the fixture keeps the order it was
 * written in.
 */
export function auditRows(
  entries: AuditEntry[],
  outcome: OutcomeFilter
): AuditEntry[] {
  const filtered =
    outcome === "all"
      ? entries
      : entries.filter((entry) => entry.outcome === outcome);
  return [...filtered].sort(
    (a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()
  );
}
