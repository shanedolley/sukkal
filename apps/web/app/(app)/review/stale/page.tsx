"use client";

// KPA-40. The output of the staleness sweep.
//
// A stale fact is due for review, not false. The sweep flags and re-confirms,
// and it never retires, so the only control here is "Still true".

import { Suspense } from "react";

import { QueuePage } from "@/components/queue-page";
import { StaleFacts } from "@/components/dashboard/stale-facts";
import { Skeleton } from "@/components/ui/skeleton";
import { useForcedState } from "@/lib/forced-state";
import { useReview } from "@/lib/review-context";
import { isStale } from "@/lib/review-state";

function Stale() {
  // The day comes back with the rows. A fact is on this page because a date
  // passed, so "days past review" has to count from the day that decided it,
  // not from a second opinion the browser forms.
  const { facts, today, status: live, reconfirm } = useReview();
  const status = useForcedState() ?? live;
  // The read narrowed by space in SQL already, through spacesFor, and that
  // list carries `shared` with every space. Narrowing again here would drop
  // every shared row, because inSpace keeps one space and discards the rest.
  // Found in the integration pass on 2 September 2026, by running the two
  // against one another. ADR-0018.
  const stale = facts.filter(isStale);

  return (
    <QueuePage
      title="Stale facts"
      lede="Each of these is past its review date. That makes it due for a second look, not wrong. Retiring one needs a contradicting source or a date from you, and neither happens here."
      count={stale.length}
      status={status}
      emptyTitle="Nothing is going stale"
      emptyDescription="Every fact is inside its review window."
    >
      <StaleFacts facts={stale} today={today} onReconfirm={reconfirm} />
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
