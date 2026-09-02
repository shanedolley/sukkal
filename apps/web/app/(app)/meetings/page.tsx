"use client";

// KPA-39, KPA-118. The day's meetings, each tied to the engagement it belongs
// to. The rows come from the `meetings` table, for today, in start order.

import { Suspense } from "react";

import { MeetingsToday } from "@/components/dashboard/meetings-today";
import { QueuePage } from "@/components/queue-page";
import { Skeleton } from "@/components/ui/skeleton";
import { useForcedState } from "@/lib/forced-state";
import { useMeetings } from "@/lib/meetings-context";

function Meetings() {
  const { meetings, status: live } = useMeetings();
  // This region reads a database, so it reports what happened. ?state= still
  // forces it, which is how the other three states get looked at.
  const status = useForcedState() ?? live;

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
