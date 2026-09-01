// The rules the review controls obey. Pure functions, so the check can prove
// them without a browser. See "A fact's life" and "What sets valid_to".
//
// Three rules matter and all three are easy to break by accident:
//   1. Nothing is deleted. Every move keeps the row.
//   2. A rejection records its reason, so a later run does not re-raise it.
//   3. The staleness sweep never retires. Re-confirm is the only move a stale
//      fact offers, because a stale fact is due for review, not false.

import type { Fact } from "./types";

export type ReviewMove = "accept" | "reject" | "reconfirm";

export class ReviewError extends Error {}

/** Which moves a fact offers, given its state. */
export function movesFor(fact: Fact): ReviewMove[] {
  switch (fact.state) {
    case "proposed":
    case "candidate":
      return ["accept", "reject"];
    case "stale":
      return ["reconfirm"];
    default:
      return [];
  }
}

/**
 * Apply one review move. Returns a new array of the same length: the row is
 * kept and its state changes.
 */
export function applyMove(
  facts: Fact[],
  factId: string,
  move: ReviewMove,
  reason?: string
): Fact[] {
  const fact = facts.find((f) => f.id === factId);
  if (!fact) {
    throw new ReviewError(`no fact with id ${factId}`);
  }
  if (!movesFor(fact).includes(move)) {
    throw new ReviewError(
      `a ${fact.state} fact does not offer "${move}"`
    );
  }
  if (move === "reject" && !reason?.trim()) {
    throw new ReviewError("a rejection must record a reason");
  }

  return facts.map((f) => {
    if (f.id !== factId) return f;
    if (move === "reject") {
      return { ...f, state: "rejected" as const, rejectionReason: reason };
    }
    // Accept and re-confirm both land on verified. Neither sets valid_to,
    // because only a source or a human retires a fact.
    return { ...f, state: "verified" as const };
  });
}

/** The rows each dashboard region shows. */
export const isProposed = (f: Fact) => f.state === "proposed";
export const isStale = (f: Fact) => f.state === "stale";
