"use client";

// One copy of the audit log, shared by the page and the sidebar's denied
// count.
//
// Held here for the reason lib/needs-you-context.tsx gives for the queue. Two
// fetches would be two answers, and a badge that disagrees with the list
// behind it is worse than no badge.
//
// The outcome filter is not here. auditRows in lib/audit-view.ts applies it,
// and scripts/check-audit.ts proves it, so this holds every entry in the
// space and each reader narrows what it needs.

import { createContext, useContext, useEffect, useMemo, useState } from "react";

import type { SpaceFilter } from "./space";
import { useSpace } from "./space-context";
import type { AuditEntry } from "./types";

/** "loading" until the first answer, then "ready" or "error". Never both. */
export type AuditStatus = "loading" | "ready" | "error";

interface AuditValue {
  entries: AuditEntry[];
  status: AuditStatus;
}

/** What came back, and which filter it came back for. */
interface Answer extends AuditValue {
  space: SpaceFilter;
  status: "ready" | "error";
}

const AuditContext = createContext<AuditValue | null>(null);

const LOADING: AuditValue = { entries: [], status: "loading" };

export function AuditProvider({ children }: { children: React.ReactNode }) {
  const { space } = useSpace();
  const [answer, setAnswer] = useState<Answer | null>(null);

  useEffect(() => {
    const stop = new AbortController();

    fetch(`/api/audit?space=${space}`, { signal: stop.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`the read answered ${response.status}`);
        return response.json() as Promise<AuditEntry[]>;
      })
      .then((entries) => setAnswer({ space, entries, status: "ready" }))
      .catch((cause: unknown) => {
        if (stop.signal.aborted) return;
        console.error("audit:", cause);
        setAnswer({ space, entries: [], status: "error" });
      });

    return () => stop.abort();
  }, [space]);

  // An answer for another space is the previous filter's entries, and showing
  // a Koinon action under a Collibra label is the leak the space filter exists
  // to prevent.
  const value = useMemo<AuditValue>(
    () =>
      answer && answer.space === space
        ? { entries: answer.entries, status: answer.status }
        : LOADING,
    [answer, space],
  );

  return <AuditContext value={value}>{children}</AuditContext>;
}

export function useAudit(): AuditValue {
  const value = useContext(AuditContext);
  if (!value) {
    throw new Error("useAudit must be used inside AuditProvider");
  }
  return value;
}
