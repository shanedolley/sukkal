"use client";

// One project, three ways in.
//
// Overview answers "what is this project", which the contract and the shape
// of the work over time between them tell you. Issues answers "what is on
// it". Settings answers "where does it come from". The last two are the same
// screens the sidebar reaches directly, so a reader who arrived either way
// sees one thing.

import { Suspense } from "react";
import Link from "next/link";
import { ArrowLeftIcon, PlusIcon } from "lucide-react";

import { ProjectOverview } from "@/components/projects/project-overview";
import { ProjectDetailSettings } from "@/components/projects/project-detail-settings";
import { ProjectSettings } from "@/components/projects/project-settings";
import { isWorkspace } from "@/components/blocks/app-shell-1/components/data";
import { useProjectBoard } from "@/components/projects/project-board";
import { QueueBody } from "@/components/queue-page";
import { Badge } from "@/components/reui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

function Project() {
  const { key, name, status, board, count } = useProjectBoard();

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <Link
          href="/dashboard"
          className="text-muted-foreground hover:text-foreground focus-visible:ring-ring inline-flex w-fit items-center gap-1 rounded-sm text-xs focus-visible:ring-2 focus-visible:outline-none"
        >
          <ArrowLeftIcon className="size-3" aria-hidden="true" />
          Back to the briefing
        </Link>
        <h1 className="text-xl font-semibold tracking-tight">{name}</h1>
      </header>

      <Tabs defaultValue="overview">
        <TabsList aria-label="Project sections">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="issues">Issues</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="pt-4">
          <ProjectOverview projectKey={key} />
        </TabsContent>

        <TabsContent value="issues" className="flex flex-col gap-4 pt-4">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-medium">Every issue on this project</h2>
            {status === "ready" && (
              <Badge variant="secondary" size="sm" radius="full">
                {count}
              </Badge>
            )}
            <div className="ml-auto">
              <Button
                variant="outline"
                size="icon-lg"
                aria-label="New issue"
                title="New issue"
                onClick={board.add}
              >
                <PlusIcon aria-hidden="true" />
              </Button>
            </div>
          </div>

          <QueueBody
            title={name}
            count={count}
            status={status}
            emptyTitle="Nothing on this project"
            emptyDescription="No issue in this space belongs to it. Widen the space filter, or add the first one."
          >
            {board.view}
          </QueueBody>
        </TabsContent>

        {/* A workspace holds the tracker and the fields every issue on it
            carries. A project inside one holds its label and its dates, and
            nothing else. Two different screens under one tab. */}
        <TabsContent value="settings" className="pt-4">
          {isWorkspace(key) ? (
            <ProjectSettings name={name} />
          ) : (
            <ProjectDetailSettings projectKey={key} name={name} />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default function ProjectPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <Project />
    </Suspense>
  );
}
