"use client";

// The busy and failed states a whole page shows, as opposed to the per-region
// ones on the briefing. Chat and the audit log each fill a screen with one
// thing, so a failure there is a page-level event, not a card-level one.

import { AlertTriangleIcon } from "lucide-react";

import { Skeleton } from "@/components/ui/skeleton";

export function PageLoading({ label, rows = 4 }: { label: string; rows?: number }) {
  return (
    <div className="flex flex-col gap-3" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading {label}</span>
      {Array.from({ length: rows }, (_, row) => (
        <div key={row} className="flex flex-col gap-2">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-4/5" />
        </div>
      ))}
    </div>
  );
}

export function PageError({ what }: { what: string }) {
  return (
    <div
      role="alert"
      className="border-destructive/30 bg-destructive/5 text-destructive flex items-start gap-2 rounded-md border p-4 text-sm"
    >
      <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div className="flex flex-col gap-1">
        <span className="font-medium">{what} did not load.</span>
        <span className="text-destructive/80 text-xs">
          The worker did not answer. Nothing was changed. It retries on the next
          poll.
        </span>
      </div>
    </div>
  );
}
