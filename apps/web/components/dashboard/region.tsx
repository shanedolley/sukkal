"use client";

// One region of the briefing. The brief sketches four plus the chat entry.
//
// Every region renders its own empty, busy and failed states. The prototype
// has no backend, so ?state=loading, ?state=error and ?state=empty on the
// dashboard force them, which is how they get reviewed at all.

import { AlertTriangleIcon } from "lucide-react";

import { Badge } from "@/components/reui/badge";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";

export type RegionStatus = "ready" | "loading" | "error" | "empty";

export function Region({
  id,
  title,
  count,
  status,
  emptyTitle,
  emptyDescription,
  action,
  children,
}: {
  id: string;
  title: string;
  count: number;
  status: RegionStatus;
  emptyTitle: string;
  emptyDescription: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  const showEmpty = status === "empty" || (status === "ready" && count === 0);

  return (
    <Card id={id} className="scroll-mt-20 gap-0 py-0">
      {/* CardHeader is a grid by default, so flex-row alone leaves the count
          on its own row. flex has to come with it. */}
      <CardHeader className="flex flex-row items-center gap-2 border-b px-4 py-3">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        {status === "ready" && (
          <Badge variant="secondary" size="sm" radius="full">
            {count}
          </Badge>
        )}
        {action && <CardAction>{action}</CardAction>}
      </CardHeader>

      <CardContent className="p-4">
        {status === "loading" && (
          <div className="flex flex-col gap-3" aria-busy="true" aria-live="polite">
            <span className="sr-only">Loading {title}</span>
            {[0, 1].map((row) => (
              <div key={row} className="flex flex-col gap-2">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-1/3" />
              </div>
            ))}
          </div>
        )}

        {status === "error" && (
          <div
            role="alert"
            className="border-destructive/30 bg-destructive/5 text-destructive flex items-start gap-2 rounded-md border p-3 text-sm"
          >
            <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <div className="flex flex-col gap-1">
              <span className="font-medium">This region did not load.</span>
              <span className="text-destructive/80 text-xs">
                The worker did not answer. The rows below may be out of date.
                Nothing was changed.
              </span>
            </div>
          </div>
        )}

        {showEmpty && (
          <Empty className="border-none py-6">
            <EmptyTitle className="text-sm">{emptyTitle}</EmptyTitle>
            <EmptyDescription className="text-xs">
              {emptyDescription}
            </EmptyDescription>
          </Empty>
        )}

        {status === "ready" && count > 0 && children}
      </CardContent>
    </Card>
  );
}
