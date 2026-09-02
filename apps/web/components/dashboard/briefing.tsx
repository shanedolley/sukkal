"use client";

// KPA-38, KPA-39. The screen he opens.
//
// Needs you sits here in full, because those rows are the ones that will not
// wait. The three queues are summarised: a count and the engagements the work
// sits with, so the shape of the morning reads before anything is opened.
// Each card is a link to the page that holds the queue itself.

import { useEffect } from "react";
import Link from "next/link";
import { ArrowRightIcon, MessagesSquareIcon } from "lucide-react";

import { QueueCard, byEntity } from "@/components/dashboard/queue-card";
import { Region } from "@/components/dashboard/region";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatLongDay } from "@/lib/format";
import { useForcedState, type PageStatus } from "@/lib/forced-state";
import { NeedsYou } from "@/components/dashboard/needs-you";
import { useMeetings } from "@/lib/meetings-context";
import { useNeedsYou } from "@/lib/needs-you-context";
import { useReview } from "@/lib/review-context";
import { isProposed, isStale } from "@/lib/review-state";

export function Briefing() {
  const { items: needsYou, status: needsLive } = useNeedsYou();
  const { facts, today, status: reviewLive } = useReview();
  const { meetings, status: meetingsLive } = useMeetings();

  // Every region reads a database now, so each reports what happened to its
  // own read rather than sharing one optimistic answer. A card that says a
  // queue is clear when the read failed is worse than a card that says it
  // does not know. ?state= still forces, and forcing wins.
  const forced = useForcedState();
  const needsStatus = forced ?? needsLive;
  const reviewStatus = forced ?? reviewLive;
  const meetingsStatus = forced ?? meetingsLive;

  // The audit log links a denial here, at #needs-you. The region renders only
  // once its read answers, so by then the browser has already looked for that
  // fragment and found nothing. Scroll to it when the rows arrive, which is
  // what the link promises.
  useEffect(() => {
    if (needsStatus !== "ready") return;
    if (window.location.hash !== "#needs-you") return;
    document.getElementById("needs-you")?.scrollIntoView({ block: "start" });
  }, [needsStatus]);

  // No second narrow by space. Each read narrowed in SQL through spacesFor,
  // and that list carries `shared` with every space, so filtering again here
  // would drop every shared row. Found in the integration pass on 2 September
  // 2026 by running the two against one another. ADR-0018.
  const proposed = facts.filter(isProposed);
  const stale = facts.filter(isStale);

  // The summary speaks for all three reads, so it answers to the worst of
  // them. Keyed off one read it said "0 to review, 0 going stale" while that
  // read was failing, which is the sentence a review queue must never say
  // when it does not know. The cards were already right and the line above
  // them was not. Found on 2 September 2026, after the fix that corrected
  // the cards and the sidebar and stopped there.
  const reads = [needsStatus, reviewStatus, meetingsStatus];
  const overall: PageStatus = reads.includes("error")
    ? "error"
    : reads.includes("loading")
      ? "loading"
      : reads.includes("empty")
        ? "empty"
        : "ready";

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
      <header className="bg-background sticky top-12 z-10 -mx-4 flex flex-wrap items-end justify-between gap-3 border-b px-4 py-4 md:-mx-6 md:px-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold tracking-tight">
            {today ? formatLongDay(today) : "Your briefing"}
          </h1>
          <p className="text-muted-foreground text-sm">{summary[overall]}</p>
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
            status={reviewStatus}
            emptyLabel="Nothing an agent wrote is waiting for your confirmation."
          />
          <QueueCard
            title="Stale facts"
            href="/review/stale"
            count={stale.length}
            breakdown={byEntity(stale)}
            status={reviewStatus}
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
            status={meetingsStatus}
            emptyLabel="Nothing in the calendar for this space."
          />
        </div>
      </section>

      <Region
        id="needs-you"
        title="Needs you"
        count={needsYou.length}
        status={needsStatus}
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
