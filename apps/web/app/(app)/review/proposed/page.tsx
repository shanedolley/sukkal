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
import { useForcedStatus } from "@/lib/forced-state";
import { useReview } from "@/lib/review-context";
import { isProposed } from "@/lib/review-state";
import { inSpace, useSpace } from "@/lib/space-context";

function Proposed() {
  const { space } = useSpace();
  const status = useForcedStatus();
  const { facts, accept, reject } = useReview();
  const proposed = inSpace(facts, space).filter(isProposed);

  return (
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
  );
}

export default function ProposedFactsPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <Proposed />
    </Suspense>
  );
}
