"use client";

// The frame the three queue pages share: a title, what the queue is for, the
// count, and the same busy, failed and empty states the briefing uses.

import Link from "next/link";
import { ArrowLeftIcon } from "lucide-react";

import { Badge } from "@/components/reui/badge";
import { PageError, PageLoading } from "@/components/page-status";
import { Empty, EmptyDescription, EmptyTitle } from "@/components/ui/empty";
import type { PageStatus } from "@/lib/forced-state";

export function QueuePage({
  title,
  lede,
  count,
  status,
  emptyTitle,
  emptyDescription,
  action,
  children,
}: {
  title: string;
  lede: string;
  count: number;
  status: PageStatus;
  emptyTitle: string;
  emptyDescription: string;
  /** A control on the right of the title, such as the + that adds a row. */
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  const empty = status === "empty" || (status === "ready" && count === 0);

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
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          {status === "ready" && (
            <Badge variant="secondary" size="sm" radius="full">
              {count}
            </Badge>
          )}
          {action && <div className="ml-auto">{action}</div>}
        </div>
        <p className="text-muted-foreground max-w-2xl text-sm">{lede}</p>
      </header>

      {status === "loading" && <PageLoading label={title} rows={4} />}
      {status === "error" && <PageError what={title} />}

      {empty && (
        <Empty className="border-none py-10">
          <EmptyTitle className="text-base">{emptyTitle}</EmptyTitle>
          <EmptyDescription>{emptyDescription}</EmptyDescription>
        </Empty>
      )}

      {status === "ready" && count > 0 && children}
    </div>
  );
}
