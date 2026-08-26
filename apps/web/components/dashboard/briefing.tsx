"use client";

// KPA-38, KPA-39, KPA-40. The screen he opens.
//
// The brief's sketch puts four regions and a chat entry on one screen. On a
// wide screen the two review queues take the right column, so the work reads
// as one column. On a narrow one the grid collapses, and the source order
// puts the queue second rather than below three read-only cards: the screen
// exists to surface decisions, so a decision should never be 900px down.

import Link from "next/link";
import { ArrowRightIcon, MessagesSquareIcon } from "lucide-react";

import { MeetingsToday } from "@/components/dashboard/meetings-today";
import { ProposedFacts } from "@/components/dashboard/proposed-facts";
import { Region } from "@/components/dashboard/region";
import { StaleFacts } from "@/components/dashboard/stale-facts";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatLongDay } from "@/lib/format";
import { MEETINGS, NEEDS_YOU, TODAY } from "@/lib/fixtures";
import { useForcedStatus, type PageStatus } from "@/lib/forced-state";
import { NeedsYou } from "@/components/dashboard/needs-you";
import { useReview } from "@/lib/review-context";
import { isProposed, isStale } from "@/lib/review-state";
import { inSpace, useSpace } from "@/lib/space-context";

export function Briefing() {
  const { space } = useSpace();
  const status = useForcedStatus();
  const { facts, accept, reject, reconfirm } = useReview();

  const needsYou = inSpace(NEEDS_YOU, space);
  const meetings = inSpace(MEETINGS, space);
  const proposed = inSpace(facts, space).filter(isProposed);
  const stale = inSpace(facts, space).filter(isStale);

  // The summary counts rows, so it has to say something different in each
  // state. A confident number beside a spinner is worse than no number, and
  // "Reading your briefing" above four regions that each say they are empty
  // contradicts the screen underneath it.
  const summary: Record<PageStatus, string> = {
    ready: `${needsYou.length} waiting on you, ${proposed.length} to review, ${stale.length} going stale.`,
    loading: "Reading your briefing.",
    error: "Some of this did not load. Nothing was changed.",
    empty: "Nothing needs you today.",
  };

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold tracking-tight">
            {formatLongDay(TODAY)}
          </h1>
          <p className="text-muted-foreground text-sm">{summary[status]}</p>
        </div>
        <Button
          render={<Link href="/chat" />}
          nativeButton={false}
          variant="outline"
        >
          <MessagesSquareIcon className="size-4" aria-hidden="true" />
          Ask a question
        </Button>
      </header>

      {/* One grid, not two stacked columns. The explicit row placement keeps
          the wide layout ("read-only left, queue right") while letting the
          narrow one follow source order. */}
      <div className="grid items-start gap-6 lg:grid-cols-2">
        <Region
          id="needs-you"
          title="Needs you"
          count={needsYou.length}
          status={status}
          emptyTitle="Nothing is waiting on you"
          emptyDescription="Every decision has been made. New items arrive after the next mail poll."
        >
          <NeedsYou items={needsYou} />
        </Region>

        <Region
          id="proposed-facts"
          title="Proposed facts"
          count={proposed.length}
          status={status}
          emptyTitle="The review queue is clear"
          emptyDescription="Nothing an agent wrote is waiting for your confirmation."
        >
          <ProposedFacts facts={proposed} onAccept={accept} onReject={reject} />
        </Region>

        <Region
          id="meetings-today"
          title="Meetings today"
          count={meetings.length}
          status={status}
          emptyTitle="No meetings today"
          emptyDescription="Nothing in the calendar for this space."
        >
          <MeetingsToday meetings={meetings} />
        </Region>

        <Region
          id="stale-facts"
          title="Stale facts"
          count={stale.length}
          status={status}
          emptyTitle="Nothing is going stale"
          emptyDescription="Every fact is inside its review window."
        >
          <StaleFacts facts={stale} today={TODAY} onReconfirm={reconfirm} />
        </Region>

        <Card className="bg-muted/30 border-dashed lg:col-span-2">
          <CardContent className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-col gap-0.5">
              <p className="text-sm font-medium">Dig into anything</p>
              <p className="text-muted-foreground text-xs">
                One question across three mailboxes, every transcript and the
                fact graph. Answers open to their sources.
              </p>
            </div>
            <Button
              render={<Link href="/chat" />}
              nativeButton={false}
              size="sm"
            >
              Open chat
              <ArrowRightIcon className="size-4" aria-hidden="true" />
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
