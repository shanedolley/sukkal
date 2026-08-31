"use client";

// One Jira project. The key in the address is the one the sidebar links to,
// so a project added there reaches a real page rather than a 404.

import { Suspense } from "react";
import { useParams } from "next/navigation";

import { QueuePage } from "@/components/queue-page";
import { Skeleton } from "@/components/ui/skeleton";
import { PROJECTS } from "@/components/blocks/app-shell-1/components/data";
import { useForcedStatus } from "@/lib/forced-state";

/** A key the sidebar knows keeps its name. Anything else reads back its key. */
function nameFor(key: string): string {
  const known = PROJECTS.find((project) => project.id === key);
  if (known) return known.label;
  return key.replace(/(^|-)(.)/g, (_, __, letter) => ` ${letter.toUpperCase()}`).trim();
}

function Project() {
  const { key } = useParams<{ key: string }>();
  const status = useForcedStatus();

  return (
    <QueuePage
      title={nameFor(key)}
      lede="The issues Jira holds for this project, and the sprint each one sits in."
      count={0}
      // Nothing reaches Jira yet, so ready means empty.
      status={status === "ready" ? "empty" : status}
      emptyTitle="Jira is not connected"
      emptyDescription="Issues appear here once the Jira credentials are in place."
    >
      {null}
    </QueuePage>
  );
}

export default function ProjectPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <Project />
    </Suspense>
  );
}
