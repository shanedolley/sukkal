"use client";

// One copy of the open Needs you rows, shared by the three things that show
// them: the briefing, the sidebar's badge, and the command palette.
//
// Held here for the reason lib/review-context.tsx gives for facts. Three
// fetches would be three answers, and a sidebar badge that disagrees with the
// list beside it is worse than no badge.
//
// It carries its own status. Nothing else on the briefing reaches a database
// yet, so ?state= still forces the rest, and this region reports what
// actually happened.

import { createContext, useContext, useEffect, useMemo, useState } from "react";

import type { SpaceFilter } from "./space";
import { useSpace } from "./space-context";
import type { NeedsYouItem } from "./types";

/** "loading" until the first answer, then "ready" or "error". Never both. */
export type NeedsYouStatus = "loading" | "ready" | "error";

interface NeedsYouValue {
  items: NeedsYouItem[];
  status: NeedsYouStatus;
}

/** What came back, and which filter it came back for. The space is held with
 *  it so a changed filter reads as loading during render, rather than as a
 *  second state written from inside an effect. */
interface Answer extends NeedsYouValue {
  space: SpaceFilter;
  status: "ready" | "error";
}

const NeedsYouContext = createContext<NeedsYouValue | null>(null);

const LOADING: NeedsYouValue = { items: [], status: "loading" };

export function NeedsYouProvider({ children }: { children: React.ReactNode }) {
  const { space } = useSpace();
  const [answer, setAnswer] = useState<Answer | null>(null);

  useEffect(() => {
    const stop = new AbortController();

    fetch(`/api/needs-you?space=${space}`, { signal: stop.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`the read answered ${response.status}`);
        return response.json() as Promise<NeedsYouItem[]>;
      })
      .then((items) => setAnswer({ space, items, status: "ready" }))
      .catch((cause: unknown) => {
        if (stop.signal.aborted) return;
        console.error("needs-you:", cause);
        setAnswer({ space, items: [], status: "error" });
      });

    return () => stop.abort();
  }, [space]);

  // An answer for another space is the previous filter's rows. Showing them
  // under the new label would be a wrong answer, and the wall between
  // Collibra and Koinon is the one nothing else enforces.
  const value = useMemo<NeedsYouValue>(
    () =>
      answer && answer.space === space
        ? { items: answer.items, status: answer.status }
        : LOADING,
    [answer, space],
  );

  return <NeedsYouContext value={value}>{children}</NeedsYouContext>;
}

export function useNeedsYou(): NeedsYouValue {
  const value = useContext(NeedsYouContext);
  if (!value) {
    throw new Error("useNeedsYou must be used inside NeedsYouProvider");
  }
  return value;
}
