"use client";

// One copy of the facts, shared by the queue and the sidebar counts.
//
// Held here rather than in the dashboard page because the sidebar shows the
// same counts. With the state on the page, accepting a fact dropped the
// region count to 3 while the sidebar still said 4, and a count that
// disagrees with the list beside it is worse than no count.

import { createContext, useCallback, useContext, useMemo, useState } from "react";

import { FACTS } from "./fixtures";
import { applyMove, movesFor, type ReviewMove } from "./review-state";
import type { Fact } from "./types";

interface ReviewValue {
  facts: Fact[];
  accept: (factId: string) => void;
  reject: (factId: string, reason: string) => void;
  reconfirm: (factId: string) => void;
}

const ReviewContext = createContext<ReviewValue | null>(null);

export function ReviewProvider({ children }: { children: React.ReactNode }) {
  const [facts, setFacts] = useState<Fact[]>(FACTS);

  // Two clicks on one row land in the same React turn: the second runs
  // against a fact the first already moved. applyMove throws on that, and a
  // throw inside a state updater unmounts the tree with nothing able to catch
  // it. So the race is absorbed here, and applyMove stays strict for the
  // rules the check proves.
  const apply = useCallback(
    (factId: string, move: ReviewMove, reason?: string) =>
      setFacts((current) => {
        const fact = current.find((f) => f.id === factId);
        if (!fact || !movesFor(fact).includes(move)) return current;
        return applyMove(current, factId, move, reason);
      }),
    []
  );

  const accept = useCallback((factId: string) => apply(factId, "accept"), [apply]);
  const reject = useCallback(
    (factId: string, reason: string) => apply(factId, "reject", reason),
    [apply]
  );
  const reconfirm = useCallback(
    (factId: string) => apply(factId, "reconfirm"),
    [apply]
  );

  const value = useMemo(
    () => ({ facts, accept, reject, reconfirm }),
    [facts, accept, reject, reconfirm]
  );

  return <ReviewContext value={value}>{children}</ReviewContext>;
}

export function useReview(): ReviewValue {
  const value = useContext(ReviewContext);
  if (!value) {
    throw new Error("useReview must be used inside ReviewProvider");
  }
  return value;
}
