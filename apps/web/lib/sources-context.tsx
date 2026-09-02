"use client";

// One copy of the sources the memory holds, for the command palette.
//
// Held here for the reason lib/needs-you-context.tsx gives, and for one more.
// The palette opens on a keystroke, so a fetch fired when it opens is a fetch
// fired every time anybody presses Cmd+K. The layout mounts this once, the
// answer arrives before the box does, and the box reads what is already
// there.
//
// This carries the summaries and never the passages. The drawer reads its own
// source by id when it opens, which is one row rather than every body in the
// memory. See lib/sources.ts.
//
// It carries its own status, so a screen reports what actually happened.

import { createContext, useContext, useEffect, useMemo, useState } from "react";

import type { SpaceFilter } from "./space";
import { useSpace } from "./space-context";
import type { SourceSummary } from "./sources";

/** "loading" until the first answer, then "ready" or "error". Never both. */
export type SourcesStatus = "loading" | "ready" | "error";

interface SourcesValue {
  sources: SourceSummary[];
  status: SourcesStatus;
}

/** What came back, and which filter it came back for. The space is held with
 *  it so a changed filter reads as loading during render, rather than as a
 *  second state written from inside an effect. */
interface Answer extends SourcesValue {
  space: SpaceFilter;
  status: "ready" | "error";
}

const SourcesContext = createContext<SourcesValue | null>(null);

const LOADING: SourcesValue = { sources: [], status: "loading" };

export function SourcesProvider({ children }: { children: React.ReactNode }) {
  const { space } = useSpace();
  const [answer, setAnswer] = useState<Answer | null>(null);

  useEffect(() => {
    const stop = new AbortController();

    // No id, so the route answers with the list. See the route's own comment
    // for why one route serves both.
    fetch(`/api/sources?space=${space}`, { signal: stop.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`the read answered ${response.status}`);
        return response.json() as Promise<SourceSummary[]>;
      })
      .then((sources) => setAnswer({ space, sources, status: "ready" }))
      .catch((cause: unknown) => {
        if (stop.signal.aborted) return;
        console.error("sources:", cause);
        setAnswer({ space, sources: [], status: "error" });
      });

    return () => stop.abort();
  }, [space]);

  // An answer for another space is the previous filter's rows. Showing them
  // under the new label would be a wrong answer, and the wall between
  // Collibra and Koinon is the one nothing else enforces.
  const value = useMemo<SourcesValue>(
    () =>
      answer && answer.space === space
        ? { sources: answer.sources, status: answer.status }
        : LOADING,
    [answer, space],
  );

  return <SourcesContext value={value}>{children}</SourcesContext>;
}

export function useSources(): SourcesValue {
  const value = useContext(SourcesContext);
  if (!value) {
    throw new Error("useSources must be used inside SourcesProvider");
  }
  return value;
}
