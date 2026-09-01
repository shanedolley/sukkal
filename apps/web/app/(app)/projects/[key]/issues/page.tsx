"use client";

// Every issue in one project, whatever sprint it sits in.
//
// The sprint pages ask "what is happening now". This asks "what is on this
// project", which is the question you have when the sprint is not the frame
// you are thinking in. The project page shows the same board under a tab.

import { Suspense } from "react";
import { PlusIcon } from "lucide-react";

import { useProjectBoard } from "@/components/projects/project-board";
import { QueuePage } from "@/components/queue-page";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

function ProjectIssues() {
  const { name, status, board, count } = useProjectBoard();

  return (
    <QueuePage
      title={name}
      lede="Every issue on this project, across every sprint."
      count={count}
      status={status}
      emptyTitle="Nothing on this project"
      emptyDescription="No issue in this space belongs to it. Widen the space filter, or add the first one."
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

export default function ProjectIssuesPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <ProjectIssues />
    </Suspense>
  );
}
