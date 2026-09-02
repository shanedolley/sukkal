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
// The moves are replayed, not written into the rows. The fetched rows stay as
// the database gave them and the moves are folded over them during render.
// Holding a mutated copy in state instead would need the fetch to overwrite it
// from inside an effect, which is the synchronous setState the React compiler
// rule refuses.
//
// KPA-122 put the write behind the click, and a move now has two halves.
//
// The optimistic half moves the row on screen at once, so the queue stays
// quick to work. `applyMove` builds it, and it is deliberately approximate:
// it sets the state and leaves the dates alone.
//
// The settled half is the row the store answers with. It replaces the fetched
// row, so what a screen shows after a write is what the database holds rather
// than what the browser guessed. That matters most on a re-confirm, where the
// new review date is arithmetic only the store does. A settled row offers no
// move, so `replay` drops its own optimistic move without being told to.
//
// A write that fails takes its optimistic move back and says why. The row
// returns to where it was, which is where the store still has it.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
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
  /** What the last write that failed says, for the screen to show. Null while
   *  every move has landed. A move that fails puts its row back, so this is
   *  the only thing that tells the reader the row came back on purpose. */
  failure: string | null;
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
function replay(facts: Fact[], settled: Record<string, Fact>, moves: Move[]): Fact[] {
  // The store's own answer wins over the row the read returned. A settled row
  // is already in the state its move asked for, so `movesFor` returns nothing
  // for it and the loop below skips that move rather than applying it twice.
  const rows = facts.map((fact) => settled[fact.id] ?? fact);

  return moves.reduce((current, { factId, move, reason }) => {
    const fact = current.find((f) => f.id === factId);
    if (!fact || !movesFor(fact).includes(move)) return current;
    return applyMove(current, factId, move, reason);
  }, rows);
}

export function ReviewProvider({ children }: { children: React.ReactNode }) {
  const { space } = useSpace();
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [moves, setMoves] = useState<Move[]>([]);
  const [settled, setSettled] = useState<Record<string, Fact>>({});
  const [failure, setFailure] = useState<string | null>(null);

  // Which facts a write has already claimed. A ref rather than state, because
  // two clicks on one row land in the same React turn: state read in the
  // second handler is still the value the turn began with, so both would pass
  // the guard and both would reach the server. This is what makes the second
  // click a no-op against the store rather than a second write.
  const claimed = useRef<Set<string>>(new Set());

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

  const apply = useCallback((factId: string, move: ReviewMove, reason?: string) => {
    if (claimed.current.has(factId)) return;
    claimed.current.add(factId);

    setFailure(null);
    setMoves((current) => [...current, { factId, move, reason }]);

    /** Put the row back where the store still has it, and say why. */
    const undo = (why: string) => {
      claimed.current.delete(factId);
      setMoves((current) => current.filter((one) => one.factId !== factId));
      setFailure(why);
    };

    fetch("/api/facts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: factId, move, reason }),
    })
      .then(async (response) => {
        const body = (await response
          .json()
          .catch(() => null)) as { fact?: Fact; error?: string } | null;

        if (response.ok && body?.fact) {
          setSettled((current) => ({ ...current, [factId]: body.fact! }));
          return;
        }
        undo(body?.error ?? `The store answered ${response.status}.`);
      })
      .catch((cause: unknown) => {
        console.error("facts:", cause);
        undo("The write did not reach the server.");
      });
  }, []);

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
      facts: current ? replay(current.facts, settled, moves) : [],
      today: answer?.today ?? "",
      status: current?.status ?? "loading",
      accept,
      reject,
      reconfirm,
      failure,
    };
  }, [answer, space, settled, moves, failure, accept, reject, reconfirm]);

  return <ReviewContext value={value}>{children}</ReviewContext>;
}

export function useReview(): ReviewValue {
  const value = useContext(ReviewContext);
  if (!value) {
    throw new Error("useReview must be used inside ReviewProvider");
  }
  return value;
}
