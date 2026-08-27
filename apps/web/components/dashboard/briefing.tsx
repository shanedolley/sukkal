"use client";

// KPA-38, KPA-39. The screen he opens.
//
// Needs you sits here in full, because those rows are the ones that will not
// wait. The three queues are summarised: a count and the engagements the work
// sits with, so the shape of the morning reads before anything is opened.
// Each card is a link to the page that holds the queue itself.

import Link from "next/link";
import { ArrowRightIcon, MessagesSquareIcon } from "lucide-react";

import { QueueCard, byEntity } from "@/components/dashboard/queue-card";
import { Region } from "@/components/dashboard/region";
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
  const { facts } = useReview();

  const needsYou = inSpace(NEEDS_YOU, space);
  const meetings = inSpace(MEETINGS, space);
  const proposed = inSpace(facts, space).filter(isProposed);
  const stale = inSpace(facts, space).filter(isStale);

  // The summary counts rows, so it has to say something different in each
  // state. A confident number beside a spinner is worse than no number.
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

      <section className="flex flex-col gap-3">
        <h2 className="text-muted-foreground text-xs font-medium">
          The review queue
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <QueueCard
            title="Proposed facts"
            href="/review/proposed"
            count={proposed.length}
            breakdown={byEntity(proposed)}
            status={status}
            emptyLabel="Nothing an agent wrote is waiting for your confirmation."
          />
          <QueueCard
            title="Stale facts"
            href="/review/stale"
            count={stale.length}
            breakdown={byEntity(stale)}
            status={status}
            tone="warning"
            emptyLabel="Every fact is inside its review window."
          />
          <QueueCard
            title="Meetings today"
            href="/meetings"
            count={meetings.length}
            breakdown={byEntity(
              meetings.map((m) => ({ ...m, entity: m.engagement }))
            )}
            status={status}
            emptyLabel="Nothing in the calendar for this space."
          />
        </div>
      </section>

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

      <Card className="bg-muted/30 border-dashed">
        <CardContent className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <p className="text-sm font-medium">Dig into anything</p>
            <p className="text-muted-foreground text-xs">
              One question across three mailboxes, every transcript and the fact
              graph. Answers open to their sources.
            </p>
          </div>
          <Button render={<Link href="/chat" />} nativeButton={false} size="sm">
            Open chat
            <ArrowRightIcon className="size-4" aria-hidden="true" />
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
