"use client";

// KPA-40. The output of the staleness sweep.
//
// A stale fact is due for review, not false. The sweep flags and re-confirms,
// and it never retires, so the only control here is "Still true".

import { Suspense } from "react";

import { QueuePage } from "@/components/queue-page";
import { StaleFacts } from "@/components/dashboard/stale-facts";
import { Skeleton } from "@/components/ui/skeleton";
import { TODAY } from "@/lib/fixtures";
import { useForcedStatus } from "@/lib/forced-state";
import { useReview } from "@/lib/review-context";
import { isStale } from "@/lib/review-state";
import { inSpace, useSpace } from "@/lib/space-context";

function Stale() {
  const { space } = useSpace();
  const status = useForcedStatus();
  const { facts, reconfirm } = useReview();
  const stale = inSpace(facts, space).filter(isStale);

  return (
    <QueuePage
      title="Stale facts"
      lede="Each of these is past its review date. That makes it due for a second look, not wrong. Retiring one needs a contradicting source or a date from you, and neither happens here."
      count={stale.length}
      status={status}
      emptyTitle="Nothing is going stale"
      emptyDescription="Every fact is inside its review window."
    >
      <StaleFacts facts={stale} today={TODAY} onReconfirm={reconfirm} />
    </QueuePage>
  );
}

export default function StaleFactsPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <Stale />
    </Suspense>
  );
}
