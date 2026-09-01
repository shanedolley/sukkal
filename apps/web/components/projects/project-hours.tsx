"use client";

// How much of a project's hours are left, and where they went.
//
// Only Collibra runs projects on hours, so a project with no assignments
// draws nothing at all rather than a card reading zero.
//
// The card is the summary and the table is the detail, so the card opens the
// table rather than sitting beside it. A tab strip picks the period, and the
// summary columns hold still while the period only ever adds detail beside
// them.

import { useState } from "react";
import { ChevronDownIcon } from "lucide-react";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { HOURS_WEEKS, PROJECT_HOURS } from "@/lib/fixtures";
import { formatShortDay } from "@/lib/format";
import type { ProjectAssignment } from "@/lib/types";

type Period = "total" | "monthly" | "weekly";

function hours(value: number): string {
  return `${Math.round(value)} h`;
}

/** Everything booked on one assignment, the weeks and whatever came before. */
function totalUsed(assignment: ProjectAssignment): number {
  return (
    assignment.usedEarlier + assignment.used.reduce((sum, n) => sum + n, 0)
  );
}

/** The month a week's Monday falls in, as "Jul 2026". */
function monthOf(iso: string): string {
  return new Date(iso).toLocaleDateString("en-AU", {
    timeZone: "Australia/Sydney",
    month: "short",
    year: "numeric",
  });
}

/**
 * The columns the period tab asks for.
 *
 * Total is the summary alone. Monthly and weekly add a column each, to the
 * left of the aggregates, so the row reads forward through time and lands on
 * the totals it adds up to.
 */
function bucketsFor(period: Period): { label: string; weeks: number[] }[] {
  if (period === "total") return [];

  if (period === "weekly") {
    return HOURS_WEEKS.map((week, index) => ({
      label: formatShortDay(week),
      weeks: [index],
    }));
  }

  const months: { label: string; weeks: number[] }[] = [];
  HOURS_WEEKS.forEach((week, index) => {
    const label = monthOf(week);
    const found = months.find((month) => month.label === label);
    if (found) found.weeks.push(index);
    else months.push({ label, weeks: [index] });
  });
  return months;
}

function sumWeeks(assignment: ProjectAssignment, weeks: number[]): number {
  return weeks.reduce((sum, week) => sum + (assignment.used[week] ?? 0), 0);
}

/** The four summary columns, in the order they are read. */
function aggregates(assigned: number, used: number): string[] {
  const left = assigned - used;
  return [
    hours(assigned),
    hours(used),
    hours(left),
    assigned > 0 ? `${Math.round((left / assigned) * 100)}%` : "-",
  ];
}

function aggregatesFor(assignment: ProjectAssignment): string[] {
  return aggregates(assignment.assigned, totalUsed(assignment));
}

const AGGREGATE_HEADS = ["Assigned", "Used", "Remaining", "% left"];

/** Every summary column holds this width, in pixels, so the block lines up. */
const AGGREGATE_WIDTH = 96;

/**
 * Where one summary column pins to the right edge.
 *
 * Seven weeks and four summaries are wider than the page, and the summary is
 * the half worth keeping in view, so the periods scroll underneath it.
 */
function pinnedAt(index: number): number {
  return (AGGREGATE_HEADS.length - 1 - index) * AGGREGATE_WIDTH;
}

function Breakdown({
  assignments,
  period,
}: {
  assignments: ProjectAssignment[];
  period: Period;
}) {
  const buckets = bucketsFor(period);
  const cell = "py-2 pr-4 text-right tabular-nums";
  const pinned = "bg-background sticky";
  // A rule marks where the periods stop and the summary starts. It is heavier
  // and lighter than the row lines, because it divides the table in two and
  // they only separate one row from the next.
  //
  // An inset shadow rather than a border: a collapsed border does not paint on
  // a sticky cell, and these cells have to be sticky to stay in view.
  const rule = buckets.length > 0 ? "pl-4" : "";
  const ruleStyle =
    buckets.length > 0
      ? { boxShadow: "inset 3px 0 0 -1px var(--muted-foreground)" }
      : undefined;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-max border-collapse text-sm">
        <thead>
          <tr className="border-border/70 text-muted-foreground border-b text-xs">
            <th className="py-2 pr-4 text-left font-normal">Person</th>
            {buckets.map((bucket) => (
              <th
                key={bucket.label}
                className="w-16 py-2 pr-3 text-right font-normal"
              >
                {bucket.label}
              </th>
            ))}
            {AGGREGATE_HEADS.map((head, index) => (
              <th
                key={head}
                style={{
                  width: AGGREGATE_WIDTH,
                  right: buckets.length > 0 ? pinnedAt(index) : undefined,
                  ...(index === 0 ? ruleStyle : undefined),
                }}
                className={cn(
                  cell,
                  "font-normal",
                  index === 0 && rule,
                  buckets.length > 0 && pinned
                )}
              >
                {head}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {assignments.map((assignment) => (
            <tr
              key={assignment.resource}
              className="border-border/40 border-b last:border-0"
            >
              <td className="py-2 pr-4">{assignment.resource}</td>
              {buckets.map((bucket) => (
                <td
                  key={bucket.label}
                  className={cn(
                    "text-muted-foreground w-16 py-2 pr-3 text-right tabular-nums"
                  )}
                >
                  {hours(sumWeeks(assignment, bucket.weeks))}
                </td>
              ))}
              {aggregatesFor(assignment).map((value, index) => (
                <td
                  key={AGGREGATE_HEADS[index]}
                  style={{
                    width: AGGREGATE_WIDTH,
                    right: buckets.length > 0 ? pinnedAt(index) : undefined,
                    ...(index === 0 ? ruleStyle : undefined),
                  }}
                  className={cn(
                    cell,
                    index === 0 && rule,
                    buckets.length > 0 && pinned
                  )}
                >
                  {value}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-muted-foreground/40 border-t-2 font-medium">
            <td className="py-2 pr-4">Total</td>
            {buckets.map((bucket) => (
              <td
                key={bucket.label}
                className="w-16 py-2 pr-3 text-right tabular-nums"
              >
                {hours(
                  assignments.reduce(
                    (sum, assignment) => sum + sumWeeks(assignment, bucket.weeks),
                    0
                  )
                )}
              </td>
            ))}
            {aggregates(
              assignments.reduce((sum, a) => sum + a.assigned, 0),
              assignments.reduce((sum, a) => sum + totalUsed(a), 0)
            ).map((value, index) => (
              <td
                key={AGGREGATE_HEADS[index]}
                style={{
                  width: AGGREGATE_WIDTH,
                  right: buckets.length > 0 ? pinnedAt(index) : undefined,
                  ...(index === 0 ? ruleStyle : undefined),
                }}
                className={cn(
                  cell,
                  index === 0 && rule,
                  buckets.length > 0 && pinned
                )}
              >
                {value}
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

export function ProjectHours({ projectKey }: { projectKey: string }) {
  const assignments = PROJECT_HOURS[projectKey];
  const [open, setOpen] = useState(false);
  const [period, setPeriod] = useState<Period>("total");

  if (!assignments || assignments.length === 0) return null;

  const assigned = assignments.reduce((sum, a) => sum + a.assigned, 0);
  const used = assignments.reduce((sum, a) => sum + totalUsed(a), 0);
  const left = Math.max(assigned - used, 0);
  const percent = Math.round((left / assigned) * 100);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-controls="project-hours-breakdown"
        className="border-border/70 hover:bg-accent/40 focus-visible:ring-ring flex w-full flex-col gap-3 rounded-lg border p-4 text-left transition-colors focus-visible:ring-2 focus-visible:outline-none sm:w-64"
      >
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground text-xs">Hours remaining</span>
          <ChevronDownIcon
            className={cn(
              "text-muted-foreground ml-auto size-4 shrink-0 transition-transform duration-200",
              open && "rotate-180"
            )}
            aria-hidden="true"
          />
        </div>

        <span className="text-3xl font-semibold tracking-tight tabular-nums">
          {percent}%
        </span>

        {/* The bar fills with what is left, so a project running low empties. */}
        <span
          aria-hidden="true"
          className="bg-muted h-1.5 w-full overflow-hidden rounded-full"
        >
          <span
            className="bg-primary block h-full rounded-full"
            style={{ width: `${percent}%` }}
          />
        </span>

        <span className="text-muted-foreground text-xs">
          {hours(left)} of {hours(assigned)} left
        </span>
      </button>

      {open && (
        <section
          id="project-hours-breakdown"
          className="flex flex-col gap-3 sm:col-span-2"
        >
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-sm font-medium">Hours by person</h2>

            <Tabs
              className="ml-auto"
              value={period}
              onValueChange={(next) => setPeriod(next as Period)}
            >
              <TabsList aria-label="Period">
                <TabsTrigger value="total">Total</TabsTrigger>
                <TabsTrigger value="monthly">Monthly</TabsTrigger>
                <TabsTrigger value="weekly">Weekly</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          <Breakdown assignments={assignments} period={period} />
        </section>
      )}
    </>
  );
}
