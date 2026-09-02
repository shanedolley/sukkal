"use client";

// KPA-40. Everything an agent wrote that is waiting on your confirmation.
//
// The brief's third policy rule: the assistant never marks its own facts
// verified. This page is the work that rule creates, and the work is what
// keeps the memory trustworthy.

import { Suspense } from "react";

import { ProposedFacts } from "@/components/dashboard/proposed-facts";
import { QueuePage } from "@/components/queue-page";
import { Skeleton } from "@/components/ui/skeleton";
import { useForcedState } from "@/lib/forced-state";
import { useReview } from "@/lib/review-context";
import { isProposed } from "@/lib/review-state";

function Proposed() {
  const { facts, status: live, accept, reject, failure } = useReview();
  // The page reads a database now, so it reports what actually happened.
  // ?state= still forces a state for review, and forcing one wins.
  const status = useForcedState() ?? live;
  // The read narrowed by space in SQL already, through spacesFor, and that
  // list carries `shared` with every space. Narrowing again here would drop
  // every shared row, because inSpace keeps one space and discards the rest.
  // Found in the integration pass on 2 September 2026, by running the two
  // against one another. ADR-0018.
  const proposed = facts.filter(isProposed);

  return (
    <div className="flex flex-col gap-4">
      {/* A write that failed put its row back. Without this the row simply
          reappears, and a row that comes back with no explanation reads as the
          queue losing the click. */}
      {failure && (
        <p
          role="alert"
          className="border-destructive/40 bg-destructive/5 text-destructive rounded-md border px-3 py-2 text-sm"
        >
          {failure} The fact is still where it was.
        </p>
      )}
      <QueuePage
        title="Proposed facts"
        lede="An agent wrote each of these and none of them count until you say so. Open a row to see the passage it came from."
        count={proposed.length}
        status={status}
        emptyTitle="The review queue is clear"
        emptyDescription="Nothing an agent wrote is waiting for your confirmation."
      >
        <ProposedFacts facts={proposed} onAccept={accept} onReject={reject} />
      </QueuePage>
    </div>
  );
}

export default function ProposedFactsPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <Proposed />
    </Suspense>
  );
}
