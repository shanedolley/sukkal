"use client";

// The prototype reaches no backend, so nothing is ever genuinely busy or
// broken. Every page therefore takes ?state=loading, ?state=error or
// ?state=empty to force the state, which is the only way those screens get
// reviewed at all before the worker exists.

import { useSearchParams } from "next/navigation";

export type PageStatus = "ready" | "loading" | "error" | "empty";

const STATUSES: PageStatus[] = ["ready", "loading", "error", "empty"];

export function useForcedStatus(): PageStatus {
  const forced = useSearchParams().get("state") as PageStatus | null;
  return forced && STATUSES.includes(forced) ? forced : "ready";
}
