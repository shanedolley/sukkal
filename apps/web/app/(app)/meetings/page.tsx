"use client";

// KPA-39. The day's meetings, each tied to the engagement it belongs to.

import { Suspense } from "react";

import { MeetingsToday } from "@/components/dashboard/meetings-today";
import { QueuePage } from "@/components/queue-page";
import { Skeleton } from "@/components/ui/skeleton";
import { MEETINGS } from "@/lib/fixtures";
import { useForcedStatus } from "@/lib/forced-state";
import { inSpace, useSpace } from "@/lib/space-context";

function Meetings() {
  const { space } = useSpace();
  const status = useForcedStatus();
  const meetings = inSpace(MEETINGS, space);

  return (
    <QueuePage
      title="Meetings today"
      lede="What is in the calendar, and which engagement each one belongs to. Transcripts arrive from nabium after the meeting ends."
      count={meetings.length}
      status={status}
      emptyTitle="No meetings today"
      emptyDescription="Nothing in the calendar for this space."
    >
      <MeetingsToday meetings={meetings} />
    </QueuePage>
  );
}

export default function MeetingsPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <Meetings />
    </Suspense>
  );
}
