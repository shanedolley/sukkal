"use client";

// KPA-38, KPA-39, KPA-40. The screen he opens.
//
// The brief's sketch puts four regions and a chat entry on one screen. The
// two review regions sit in the right column so the queue reads as one column
// of work, and the two read-only regions sit on the left.

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowRightIcon, MessagesSquareIcon } from "lucide-react";

import { MeetingsToday } from "@/components/dashboard/meetings-today";
import { ProposedFacts } from "@/components/dashboard/proposed-facts";
import { Region, type RegionStatus } from "@/components/dashboard/region";
import { StaleFacts } from "@/components/dashboard/stale-facts";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { FACTS, MEETINGS, NEEDS_YOU, TODAY } from "@/lib/fixtures";
import { NeedsYou } from "@/components/dashboard/needs-you";
import { applyMove, isProposed, isStale } from "@/lib/review-state";
import { inSpace, useSpace } from "@/lib/space-context";

const STATUSES: RegionStatus[] = ["ready", "loading", "error", "empty"];

function longDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-AU", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

export function Briefing() {
  const { space } = useSpace();
  const params = useSearchParams();

  // The prototype has no backend, so nothing here is ever genuinely busy or
  // broken. ?state= forces a region state so all four can be reviewed.
  const forced = params.get("state") as RegionStatus | null;
  const status: RegionStatus =
    forced && STATUSES.includes(forced) ? forced : "ready";

  const [facts, setFacts] = useState(FACTS);

  const needsYou = inSpace(NEEDS_YOU, space);
  const meetings = inSpace(MEETINGS, space);
  const proposed = inSpace(facts, space).filter(isProposed);
  const stale = inSpace(facts, space).filter(isStale);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold tracking-tight">
            {longDate(TODAY)}
          </h1>
          <p className="text-muted-foreground text-sm">
            {needsYou.length} waiting on you, {proposed.length} to review,{" "}
            {stale.length} going stale.
          </p>
        </div>
        <Button render={<Link href="/chat" />} nativeButton={false} variant="outline">
          <MessagesSquareIcon className="size-4" aria-hidden="true" />
          Ask a question
        </Button>
      </header>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-6">
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
            id="meetings-today"
            title="Meetings today"
            count={meetings.length}
            status={status}
            emptyTitle="No meetings today"
            emptyDescription="Nothing in the calendar for this space."
          >
            <MeetingsToday meetings={meetings} />
          </Region>

          <Card className="bg-muted/30 border-dashed">
            <CardContent className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-col gap-0.5">
                <p className="text-sm font-medium">Dig into anything</p>
                <p className="text-muted-foreground text-xs">
                  One question across three mailboxes, every transcript and the
                  fact graph. Answers open to their sources.
                </p>
              </div>
              <Button render={<Link href="/chat" />} nativeButton={false} size="sm">
                Open chat
                <ArrowRightIcon className="size-4" aria-hidden="true" />
              </Button>
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col gap-6">
          <Region
            id="proposed-facts"
            title="Proposed facts"
            count={proposed.length}
            status={status}
            emptyTitle="The review queue is clear"
            emptyDescription="Nothing an agent wrote is waiting for your confirmation."
          >
            <ProposedFacts
              facts={proposed}
              onAccept={(id) => setFacts((current) => applyMove(current, id, "accept"))}
              onReject={(id, reason) =>
                setFacts((current) => applyMove(current, id, "reject", reason))
              }
            />
          </Region>

          <Region
            id="stale-facts"
            title="Stale facts"
            count={stale.length}
            status={status}
            emptyTitle="Nothing is going stale"
            emptyDescription="Every fact is inside its review window."
          >
            <StaleFacts
              facts={stale}
              today={TODAY}
              onReconfirm={(id) =>
                setFacts((current) => applyMove(current, id, "reconfirm"))
              }
            />
          </Region>
        </div>
      </div>
    </div>
  );
}
