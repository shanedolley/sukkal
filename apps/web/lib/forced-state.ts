"use client";

// The prototype reaches no backend, so nothing is ever genuinely busy or
// broken. Every page therefore takes ?state=loading, ?state=error or
// ?state=empty to force the state, which is the only way those screens get
// reviewed at all before the worker exists.

import { useSearchParams } from "next/navigation";

export type PageStatus = "ready" | "loading" | "error" | "empty";

const STATUSES: PageStatus[] = ["ready", "loading", "error", "empty"];

/** The status the URL forces, or null when it forces none. A region that
 *  reads a real backend uses its own status in that case. */
export function useForcedState(): PageStatus | null {
  const forced = useSearchParams().get("state") as PageStatus | null;
  return forced && STATUSES.includes(forced) ? forced : null;
}

export function useForcedStatus(): PageStatus {
  return useForcedState() ?? "ready";
}
