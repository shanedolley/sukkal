"use client";

// One copy of the facts, shared by the two queue pages, the two dashboard
// cards, the two sidebar counts, the detail panel and the command palette.
//
// Held here rather than on the dashboard page because the sidebar shows the
// same counts. With the state on the page, accepting a fact dropped the region
// count to 3 while the sidebar still said 4, and a count that disagrees with
// the list beside it is worse than no count.
//
// KPA-121 put a database behind it. Two things follow.
//
// The day comes back with the rows. Three of the six states are derived from
// dates, so the answer is only true as of a particular day, and every screen
// measuring against that answer has to measure against the same day.
//
// The moves are replayed, not written into the rows. A move is optimistic and
// nothing persists it yet -- KPA-122 owns the write -- so the fetched rows stay
// as the database gave them and the moves are folded over them during render.
// Holding a mutated copy in state instead would need the fetch to overwrite it
// from inside an effect, which is the synchronous setState the React compiler
// rule refuses.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { applyMove, movesFor, type ReviewMove } from "./review-state";
import type { SpaceFilter } from "./space";
import { useSpace } from "./space-context";
import type { Fact } from "./types";

/** "loading" until the first answer, then "ready" or "error". Never both. */
export type ReviewStatus = "loading" | "ready" | "error";

interface ReviewValue {
  facts: Fact[];
  /** The day the six states were derived from, `YYYY-MM-DD`. Empty only
   *  before the first answer, when no row is rendered against it. */
  today: string;
  status: ReviewStatus;
  accept: (factId: string) => void;
  reject: (factId: string, reason: string) => void;
  reconfirm: (factId: string) => void;
}

/** One move a click made, kept until something persists it. */
interface Move {
  factId: string;
  move: ReviewMove;
  reason?: string;
}

/** What came back, and which filter it came back for. The space is held with
 *  it so a changed filter reads as loading during render, rather than as a
 *  second state written from inside an effect. */
interface Answer {
  space: SpaceFilter;
  today: string;
  facts: Fact[];
  status: "ready" | "error";
}

const ReviewContext = createContext<ReviewValue | null>(null);

/**
 * Fold the clicks back over the rows the database gave.
 *
 * A move that no longer applies is dropped rather than thrown on. Two clicks
 * on one row land in the same React turn, and the second runs against a fact
 * the first already moved; so does every move once the filter changes under
 * it. `applyMove` throws on both, and a throw during render unmounts the tree
 * with nothing able to catch it, so the check that guards it lives here and
 * `applyMove` stays strict for the rules scripts/check-review-rules.ts proves.
 */
function replay(facts: Fact[], moves: Move[]): Fact[] {
  return moves.reduce((current, { factId, move, reason }) => {
    const fact = current.find((f) => f.id === factId);
    if (!fact || !movesFor(fact).includes(move)) return current;
    return applyMove(current, factId, move, reason);
  }, facts);
}

export function ReviewProvider({ children }: { children: React.ReactNode }) {
  const { space } = useSpace();
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [moves, setMoves] = useState<Move[]>([]);

  useEffect(() => {
    const stop = new AbortController();

    fetch(`/api/facts?space=${space}`, { signal: stop.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`the read answered ${response.status}`);
        return response.json() as Promise<{ today: string; facts: Fact[] }>;
      })
      .then(({ today, facts }) => setAnswer({ space, today, facts, status: "ready" }))
      .catch((cause: unknown) => {
        if (stop.signal.aborted) return;
        console.error("facts:", cause);
        setAnswer({ space, today: "", facts: [], status: "error" });
      });

    return () => stop.abort();
  }, [space]);

  const apply = useCallback(
    (factId: string, move: ReviewMove, reason?: string) =>
      setMoves((current) => [...current, { factId, move, reason }]),
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

  // An answer for another space is the previous filter's rows. Showing them
  // under the new label would be a wrong answer, and the wall between Collibra
  // and Koinon is the one nothing else enforces. The day is not filtered by
  // space, so it survives the change.
  const value = useMemo<ReviewValue>(() => {
    const current = answer && answer.space === space ? answer : null;
    return {
      facts: current ? replay(current.facts, moves) : [],
      today: answer?.today ?? "",
      status: current?.status ?? "loading",
      accept,
      reject,
      reconfirm,
    };
  }, [answer, space, moves, accept, reject, reconfirm]);

  return <ReviewContext value={value}>{children}</ReviewContext>;
}

export function useReview(): ReviewValue {
  const value = useContext(ReviewContext);
  if (!value) {
    throw new Error("useReview must be used inside ReviewProvider");
  }
  return value;
}
