"use client";

// The sprint views. One route serves them all, because they differ by which
// sprints they select and by nothing else.
//
// The address carries either a scope or a sprint id. "current" and "all" are
// standing views and belong in the nav. A named sprint is where the arrows
// take you, and it keeps its own address so the page can be sent to someone.

import { Suspense, useState } from "react";
import { notFound, useParams } from "next/navigation";
import Link from "next/link";
import { ChevronLeftIcon, ChevronRightIcon, PlusIcon } from "lucide-react";

import { IssueList } from "@/components/issues/issue-list";
import { QueuePage } from "@/components/queue-page";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  IssueDialog,
  type IssueFieldOptions,
} from "@/components/issues/issue-dialog";
import { IssueDetail } from "@/components/issues/issue-detail";
import { ISSUES, SPRINTS, TODAY } from "@/lib/fixtures";
import { formatShortDay } from "@/lib/format";
import { useForcedStatus } from "@/lib/forced-state";
import { withoutIssues } from "@/lib/issue-view";
import { inSpace, useSpace } from "@/lib/space-context";
import type { Issue, Sprint, SprintState } from "@/lib/types";

/** Oldest first, so a step forward always means a later sprint. */
const IN_ORDER = [...SPRINTS].sort((a, b) => a.start.localeCompare(b.start));

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
  const at = IN_ORDER.findIndex((one) => one.id === sprint.id);
  const back = IN_ORDER[at - 1];
  const forward = IN_ORDER[at + 1];

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

/** The projects a new issue can join, and the space each one sits in. */
const PROJECTS = [...new Set(ISSUES.map((issue) => issue.project))].sort();
const ASSIGNEES = [...new Set(ISSUES.map((issue) => issue.assignee))].sort();
const LABELS = [...new Set(ISSUES.flatMap((issue) => issue.labels))].sort();

const SPACE_OF = new Map(
  ISSUES.map((issue) => [issue.project, issue.space] as const)
);

const OPTIONS: IssueFieldOptions = {
  projects: PROJECTS,
  assignees: ASSIGNEES,
  labels: LABELS,
  sprints: IN_ORDER,
  // The one person this assistant works for. Every new row starts with him.
  defaultAssignee: "Shane Dolley",
  spaceOf: (project) => SPACE_OF.get(project) ?? "personal",
};

/** Where a new row goes, whatever sprint the page happens to show. */
const CURRENT_SPRINT_ID =
  SPRINTS.find((sprint) => sprint.state === "active")?.id ?? null;

/** The sprints one address covers, and how to head the page. */
function viewFor(scope: string) {
  if (scope === "all") {
    return {
      title: "All sprints",
      lede: `${SPRINTS.length} sprints, every issue Jira holds against one of them.`,
      sprints: IN_ORDER,
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
  // ponytail: both of these hold for the session. Post them to Jira once that
  // call exists, and the key it hands back replaces the NEW- one.
  //
  // They live here rather than in the list because the page decides which
  // rows belong to this sprint, and an edit can change that. Applied first,
  // filtered second, so a row sent to another sprint leaves at once and the
  // count in the title leaves with it.
  const [drafted, setDrafted] = useState<Issue[]>([]);
  const [edits, setEdits] = useState<Record<string, Partial<Issue>>>({});
  const [gone, setGone] = useState<string[]>([]);
  // A key, not a copy. The detail view writes as it goes, and a snapshot
  // would go on showing what the row said when it opened.
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const view = viewFor(scope);
  if (!view) notFound();

  // Edits first, then the removals, because a removal takes the links to the
  // row with it and an edit could otherwise put one back.
  const known = withoutIssues(
    [...ISSUES, ...drafted].map((issue) =>
      edits[issue.key] ? { ...issue, ...edits[issue.key] } : issue
    ),
    gone
  );

  function remove(keys: string[]) {
    setGone((current) => [...new Set([...current, ...keys])]);
    // The form cannot stay open on a row that has gone.
    if (editingKey && keys.includes(editingKey)) setEditingKey(null);
  }

  const editingRow = editingKey
    ? known.find((issue) => issue.key === editingKey)
    : undefined;

  const ids = view.sprints.map((sprint) => sprint.id);
  const issues = inSpace(known, space).filter(
    (issue) => issue.sprintId && ids.includes(issue.sprintId)
  );

  function record(changes: Record<string, Partial<Issue>>) {
    setEdits((current) => {
      const next = { ...current };
      for (const [key, change] of Object.entries(changes)) {
        next[key] = { ...next[key], ...change };
      }
      return next;
    });
  }

  /**
   * The form hands back a whole row, new or changed.
   *
   * A new one arrives with no key, because the form may stay open and write
   * another. The key is settled here, against the rows that exist by then.
   */
  function save(issue: Issue) {
    if (issue.key && known.some((one) => one.key === issue.key)) {
      record({ [issue.key]: issue });
      return;
    }
    setDrafted((current) => {
      const taken = new Set([
        ...ISSUES.map((one) => one.key),
        ...current.map((one) => one.key),
      ]);
      let n = 1;
      while (taken.has(`NEW-${n}`)) n += 1;
      return [...current, { ...issue, key: `NEW-${n}` }];
    });
  }

  return (
    <QueuePage
      title={view.title}
      lede={view.lede}
      count={issues.length}
      status={status}
      emptyTitle="Nothing in this sprint"
      emptyDescription="No issue in this space sits in the sprint. Widen the space filter, or check the board in Jira."
      action={
        <Button
          variant="outline"
          size="icon-lg"
          aria-label="New issue"
          title="New issue"
          onClick={() => setAdding(true)}
        >
          <PlusIcon aria-hidden="true" />
        </Button>
      }
    >
      <IssueList
        issues={issues}
        today={TODAY}
        sprintNames={Object.fromEntries(
          view.sprints.map((sprint) => [sprint.id, sprint.name])
        )}
        allSprints={IN_ORDER}
        leading={
          view.sprint ? <SprintStepper sprint={view.sprint} /> : undefined
        }
        onEdit={record}
        onOpen={(issue) => setEditingKey(issue.key)}
        onDelete={remove}
      />

      {editingRow && (
        <IssueDetail
          issue={editingRow}
          issues={known}
          options={OPTIONS}
          open
          onOpenChange={(open) => !open && setEditingKey(null)}
          onChange={(change) => record({ [editingRow.key]: change })}
          onOpen={(next) => setEditingKey(next.key)}
          onDelete={() => remove([editingRow.key])}
        />
      )}

      {adding && (
        <IssueDialog
          currentSprintId={CURRENT_SPRINT_ID}
          options={OPTIONS}
          open
          onOpenChange={setAdding}
          onSubmit={save}
        />
      )}
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
