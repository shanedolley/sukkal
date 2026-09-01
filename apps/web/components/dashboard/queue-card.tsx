"use client";

// A queue, summarised. The briefing shows the shape of the work; the page
// behind the card shows the work itself.
//
// The breakdown by engagement is the point. A count of four says there is
// work. "BHP Meridian 2, Maybank 1, Sydney Water 1" says where the morning
// is going to go, which is the thing worth knowing before you open anything.

import Link from "next/link";
import { ArrowRightIcon } from "lucide-react";

import { Badge } from "@/components/reui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { PageStatus } from "@/lib/forced-state";
import { cn } from "@/lib/utils";

/** Count rows per engagement, heaviest first. */
export function byEntity<T extends { entity: string }>(rows: T[]) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    counts.set(row.entity, (counts.get(row.entity) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([entity, count]) => ({ entity, count }))
    .sort((a, b) => b.count - a.count || a.entity.localeCompare(b.entity));
}

export function QueueCard({
  title,
  href,
  count,
  breakdown,
  status,
  emptyLabel,
  tone = "default",
}: {
  title: string;
  href: string;
  count: number;
  breakdown: { entity: string; count: number }[];
  status: PageStatus;
  /** What to say when there is nothing in the queue. */
  emptyLabel: string;
  /** warning marks the queue that is going out of date. */
  tone?: "default" | "warning";
}) {
  if (status === "loading") {
    return (
      <Card className="gap-0 py-0">
        <CardContent className="flex flex-col gap-3 p-4" aria-busy="true">
          <span className="sr-only">Loading {title}</span>
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-8 w-12" />
          <Skeleton className="h-4 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (status === "error") {
    return (
      <Card className="border-destructive/30 bg-destructive/5 gap-0 py-0">
        <CardContent className="flex flex-col gap-1 p-4" role="alert">
          <p className="text-sm font-medium">{title}</p>
          <p className="text-destructive text-xs">
            Did not load. Nothing was changed.
          </p>
        </CardContent>
      </Card>
    );
  }

  const empty = status === "empty" || count === 0;
  const shown = breakdown.slice(0, 3);
  const rest = breakdown.length - shown.length;

  return (
    <Card className="hover:border-border hover:bg-muted/30 relative gap-0 py-0 transition-colors">
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-2">
          {/* The title carries the link and stretches over the card, so the
              whole card is one target with one accessible name. */}
          <Link
            href={href}
            className="focus-visible:ring-ring rounded-sm text-sm font-medium after:absolute after:inset-0 after:content-[''] focus-visible:ring-2 focus-visible:outline-none"
          >
            {title}
          </Link>
          <ArrowRightIcon
            className="text-muted-foreground size-4 shrink-0"
            aria-hidden="true"
          />
        </div>

        <p
          className={cn(
            "text-3xl leading-none font-semibold tabular-nums",
            empty && "text-muted-foreground",
            !empty && tone === "warning" && "text-warning"
          )}
        >
          {empty ? "0" : count}
        </p>

        {empty ? (
          <p className="text-muted-foreground text-xs">{emptyLabel}</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {shown.map(({ entity, count: n }) => (
              <Badge key={entity} variant="secondary" size="sm">
                {entity}
                <span className="text-muted-foreground ml-1 tabular-nums">
                  {n}
                </span>
              </Badge>
            ))}
            {rest > 0 && (
              <Badge variant="outline" size="sm">
                +{rest} more
              </Badge>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
