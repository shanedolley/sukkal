"use client";

// One copy of today's meetings, shared by the things that show them: the
// meetings page, the briefing's card, and the sidebar's count.
//
// Held here for the reason lib/needs-you-context.tsx gives. Three fetches
// would be three answers, and a sidebar count that disagrees with the list
// beside it is worse than no count.
//
// It carries its own status, so a page reports what actually happened rather
// than what ?state= forces.

import { createContext, useContext, useEffect, useMemo, useState } from "react";

import type { MeetingItem } from "./meetings";
import type { SpaceFilter } from "./space";
import { useSpace } from "./space-context";

/** "loading" until the first answer, then "ready" or "error". Never both. */
export type MeetingsStatus = "loading" | "ready" | "error";

interface MeetingsValue {
  meetings: MeetingItem[];
  status: MeetingsStatus;
}

/** What came back, and which filter it came back for. The space is held with
 *  it so a changed filter reads as loading during render, rather than as a
 *  second state written from inside an effect. */
interface Answer extends MeetingsValue {
  space: SpaceFilter;
  status: "ready" | "error";
}

const MeetingsContext = createContext<MeetingsValue | null>(null);

const LOADING: MeetingsValue = { meetings: [], status: "loading" };

export function MeetingsProvider({ children }: { children: React.ReactNode }) {
  const { space } = useSpace();
  const [answer, setAnswer] = useState<Answer | null>(null);

  useEffect(() => {
    const stop = new AbortController();

    // No day is named, so the read answers for today in Sydney. The route
    // takes one, which is what lets a check hold a day still.
    fetch(`/api/meetings?space=${space}`, { signal: stop.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`the read answered ${response.status}`);
        return response.json() as Promise<MeetingItem[]>;
      })
      .then((meetings) => setAnswer({ space, meetings, status: "ready" }))
      .catch((cause: unknown) => {
        if (stop.signal.aborted) return;
        console.error("meetings:", cause);
        setAnswer({ space, meetings: [], status: "error" });
      });

    return () => stop.abort();
  }, [space]);

  // An answer for another space is the previous filter's rows. Showing them
  // under the new label would be a wrong answer, and the wall between
  // Collibra and Koinon is the one nothing else enforces.
  const value = useMemo<MeetingsValue>(
    () =>
      answer && answer.space === space
        ? { meetings: answer.meetings, status: answer.status }
        : LOADING,
    [answer, space],
  );

  return <MeetingsContext value={value}>{children}</MeetingsContext>;
}

export function useMeetings(): MeetingsValue {
  const value = useContext(MeetingsContext);
  if (!value) {
    throw new Error("useMeetings must be used inside MeetingsProvider");
  }
  return value;
}
