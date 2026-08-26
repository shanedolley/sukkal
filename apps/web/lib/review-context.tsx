"use client";

// One copy of the facts, shared by the queue and the sidebar counts.
//
// Held here rather than in the dashboard page because the sidebar shows the
// same counts. With the state on the page, accepting a fact dropped the
// region count to 3 while the sidebar still said 4, and a count that
// disagrees with the list beside it is worse than no count.

import { createContext, useCallback, useContext, useMemo, useState } from "react";

import { FACTS } from "./fixtures";
import { applyMove } from "./review-state";
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

  const accept = useCallback(
    (factId: string) =>
      setFacts((current) => applyMove(current, factId, "accept")),
    []
  );
  const reject = useCallback(
    (factId: string, reason: string) =>
      setFacts((current) => applyMove(current, factId, "reject", reason)),
    []
  );
  const reconfirm = useCallback(
    (factId: string) =>
      setFacts((current) => applyMove(current, factId, "reconfirm")),
    []
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
