"use client";

// The sprint views. One route serves them all, because they differ by which
// sprints they select and by nothing else.
//
// The address carries either a scope or a sprint id. "current" and "all" are
// standing views and belong in the nav. A named sprint is where the arrows
// take you, and it keeps its own address so the page can be sent to someone.

import { Suspense } from "react";
import { notFound, useParams } from "next/navigation";
import Link from "next/link";
import { ChevronLeftIcon, ChevronRightIcon, PlusIcon } from "lucide-react";

import { useBoard } from "@/components/issues/issue-board";
import {
  CURRENT_SPRINT_ID,
  ISSUE_OPTIONS,
  SPRINTS_IN_ORDER,
} from "@/components/issues/issue-options";
import { QueuePage } from "@/components/queue-page";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ISSUES, SPRINTS, TODAY } from "@/lib/fixtures";
import { formatShortDay } from "@/lib/format";
import { useForcedStatus } from "@/lib/forced-state";
import { issuesInSpace, useSpace } from "@/lib/space-context";
import type { Sprint, SprintState } from "@/lib/types";

const TITLES: Record<SprintState, string> = {
  active: "Current sprint",
  future: "Future sprint",
  closed: "Past sprint",
};

/** What the sprint is, given the toolbar already says its name and dates. */
function ledeFor(sprint: Sprint): string {
  switch (sprint.state) {
    case "active":
      return "The sprint in flight, across every Jira project this assistant reads.";
    case "future":
      return `Not started. It opens on ${formatShortDay(sprint.start)}.`;
    case "closed":
      return `Closed on ${formatShortDay(sprint.end)}.`;
  }
}

/**
 * One step back, the sprint, one step forward.
 *
 * The name sits between the two arrows rather than beside them, because the
 * arrows mean nothing until you know what they are moving away from.
 */
function SprintStepper({ sprint }: { sprint: Sprint }) {
  const at = SPRINTS_IN_ORDER.findIndex((one) => one.id === sprint.id);
  const back = SPRINTS_IN_ORDER[at - 1];
  const forward = SPRINTS_IN_ORDER[at + 1];

  const step = (to: Sprint | undefined, where: "back" | "forward") => {
    const icon =
      where === "back" ? (
        <ChevronLeftIcon aria-hidden="true" />
      ) : (
        <ChevronRightIcon aria-hidden="true" />
      );
    const label = where === "back" ? "Previous sprint" : "Next sprint";

    // The end of the record is a disabled button, not a missing one. A
    // control that vanishes moves everything beside it.
    if (!to) {
      return (
        <Button variant="ghost" size="icon-lg" disabled aria-label={label}>
          {icon}
        </Button>
      );
    }
    return (
      <Button
        variant="ghost"
        size="icon-lg"
        render={<Link href={`/sprints/${to.id}`} />}
        nativeButton={false}
        aria-label={`${label}: ${to.name}`}
        title={to.name}
      >
        {icon}
      </Button>
    );
  };

  return (
    <div className="flex items-center gap-1">
      {step(back, "back")}
      <p className="px-1 text-xs whitespace-nowrap">
        <span className="font-medium">{sprint.name}</span>
        {/* The gap is a margin, which a screen reader cannot hear. Without
            this it reads "Sprint 404 Aug". */}
        <span className="sr-only">, </span>
        <span className="text-muted-foreground ml-2 tabular-nums">
          {formatShortDay(sprint.start)} to {formatShortDay(sprint.end)}
        </span>
      </p>
      {step(forward, "forward")}
    </div>
  );
}

/** The sprints one address covers, and how to head the page. */
function viewFor(scope: string) {
  if (scope === "all") {
    return {
      title: "All sprints",
      lede: `${SPRINTS.length} sprints, every issue Jira holds against one of them.`,
      sprints: SPRINTS_IN_ORDER,
      sprint: undefined,
    };
  }

  const sprint =
    scope === "current"
      ? SPRINTS.find((one) => one.state === "active")
      : SPRINTS.find((one) => one.id === scope);
  if (!sprint) return null;

  return {
    title: TITLES[sprint.state],
    lede: ledeFor(sprint),
    sprints: [sprint],
    sprint,
  };
}

function SprintView() {
  const { scope } = useParams<{ scope: string }>();
  const { space } = useSpace();
  const status = useForcedStatus();
  const view = viewFor(scope);

  const ids = view?.sprints.map((sprint) => sprint.id) ?? [];
  const board = useBoard({
    base: ISSUES,
    issues: (known) =>
      issuesInSpace(known, space).filter(
        (issue) => issue.sprintId && ids.includes(issue.sprintId)
      ),
    today: TODAY,
    options: ISSUE_OPTIONS,
    currentSprintId: CURRENT_SPRINT_ID,
    sprintNames: Object.fromEntries(
      (view?.sprints ?? []).map((sprint) => [sprint.id, sprint.name])
    ),
    leading: view?.sprint ? <SprintStepper sprint={view.sprint} /> : undefined,
  });

  if (!view) notFound();

  const count = board.known.filter(
    (issue) => issue.sprintId && ids.includes(issue.sprintId)
  ).length;

  return (
    <QueuePage
      title={view.title}
      lede={view.lede}
      count={count}
      status={status}
      emptyTitle="Nothing in this sprint"
      emptyDescription="No issue in this space sits in the sprint. Widen the space filter, or check the board in Jira."
      action={
        <Button
          variant="outline"
          size="icon-lg"
          aria-label="New issue"
          title="New issue"
          onClick={board.add}
        >
          <PlusIcon aria-hidden="true" />
        </Button>
      }
    >
      {board.view}
    </QueuePage>
  );
}

export default function SprintPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <SprintView />
    </Suspense>
  );
}
