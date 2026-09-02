"use client";

// KPA-43. The audit log, as a sub-page rather than a dashboard region.
//
// Without an approval step in front of the agent, this record is the safety
// net, so every entry carries all four fields the brief names: the intent,
// the state before, the outcome, and how to reverse it. A denial names the
// rule that denied it.
//
// The table is the ReUI DataGrid rather than hand-rolled markup. The four
// fields are prose, so they open in a panel instead of becoming columns.

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { useTable, type ColumnDef } from "@tanstack/react-table";
import {
  ArrowUpRightIcon,
  CheckCircle2Icon,
  CircleDashedIcon,
  ShieldXIcon,
} from "lucide-react";

import { Badge } from "@/components/reui/badge";
import {
  DataGrid,
  DataGridContainer,
  dataGridFeatures,
  type DataGridFeatures,
} from "@/components/reui/data-grid/data-grid";
import { DataGridTable } from "@/components/reui/data-grid/data-grid-table";
import { DataGridScrollArea } from "@/components/reui/data-grid/data-grid-scroll-area";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useAudit } from "@/lib/audit-context";
import { formatStamp } from "@/lib/format";
import { useForcedState } from "@/lib/forced-state";
import { PageError, PageLoading } from "@/components/page-status";
import { Skeleton } from "@/components/ui/skeleton";
import { auditRows, type OutcomeFilter } from "@/lib/audit-view";
import { SPACE_LABELS, type AuditEntry, type AuditOutcome } from "@/lib/types";

function OutcomeBadge({ outcome }: { outcome: AuditOutcome }) {
  if (outcome === "allowed") {
    return (
      <Badge variant="success-light" size="sm">
        <CheckCircle2Icon className="size-3" aria-hidden="true" />
        Allowed
      </Badge>
    );
  }
  // The agent wrote this row, called out, and never came back to say how the
  // call ended. ADR-0015 calls it the most valuable row in the log, so it gets
  // a badge of its own rather than falling through to Denied. Falling through
  // would say the policy refused an action the policy allowed.
  if (outcome === "attempted") {
    return (
      <Badge variant="warning-light" size="sm">
        <CircleDashedIcon className="size-3" aria-hidden="true" />
        Attempted
      </Badge>
    );
  }
  return (
    <Badge variant="destructive-light" size="sm">
      <ShieldXIcon className="size-3" aria-hidden="true" />
      Denied
    </Badge>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 border-b pb-3 last:border-b-0">
      <dt className="text-muted-foreground text-xs font-medium">{label}</dt>
      <dd className="text-sm leading-relaxed">{value}</dd>
    </div>
  );
}

/** One of the four fields, in the grid. It is prose in a fixed column, so it
 *  shortens here and stays whole in the panel. */
function Prose({ children }: { children: string }) {
  // block, not inline: truncate needs a box with a definite width.
  return (
    <div className="text-muted-foreground truncate text-sm" title={children}>
      {children}
    </div>
  );
}

function AuditLog() {
  const { entries, status: live } = useAudit();
  const forced = useForcedState();
  const status = forced ?? live;
  const [outcome, setOutcome] = useState<OutcomeFilter>("all");
  const [selected, setSelected] = useState<AuditEntry | null>(null);

  // The read narrows by space in SQL and orders newest first. The outcome
  // filter stays here, in lib/audit-view.ts, so scripts/check-audit.ts can
  // prove it, and so one read serves this page and the sidebar's count.
  const rows = useMemo(
    () => (status === "empty" ? [] : auditRows(entries, outcome)),
    [entries, outcome, status]
  );

  const columns = useMemo<ColumnDef<DataGridFeatures, AuditEntry>[]>(
    () => [
      {
        id: "at",
        accessorKey: "at",
        header: "When",
        size: 110,
        cell: ({ row }) => (
          <span className="text-muted-foreground text-xs tabular-nums">
            {formatStamp(row.original.at)}
          </span>
        ),
      },
      {
        id: "action",
        accessorKey: "action",
        header: "Action",
        size: 150,
        cell: ({ row }) => (
          <span className="text-sm font-medium">{row.original.action}</span>
        ),
      },
      {
        id: "outcome",
        accessorKey: "outcome",
        header: "Outcome",
        size: 105,
        cell: ({ row }) => <OutcomeBadge outcome={row.original.outcome} />,
      },
      // The four fields the brief requires, each in its own column. They were
      // behind a click, and two of the four were not on the row at all, so
      // the log could not be read without opening every entry in it. The
      // panel keeps the full prose; these shorten and carry it as a tooltip.
      {
        id: "intent",
        accessorKey: "intent",
        header: "Intent",
        size: 300,
        cell: ({ row }) => <Prose>{row.original.intent}</Prose>,
      },
      {
        id: "before",
        accessorKey: "before",
        header: "State before",
        size: 240,
        cell: ({ row }) => <Prose>{row.original.before}</Prose>,
      },
      {
        id: "result",
        accessorKey: "result",
        header: "What happened",
        size: 280,
        cell: ({ row }) => <Prose>{row.original.result}</Prose>,
      },
      {
        id: "reverse",
        accessorKey: "reverse",
        header: "How to reverse it",
        size: 260,
        cell: ({ row }) => <Prose>{row.original.reverse}</Prose>,
      },
      {
        id: "rule",
        accessorKey: "rule",
        header: "Rule",
        size: 175,
        cell: ({ row }) =>
          row.original.rule ? (
            <span className="text-muted-foreground font-mono text-xs">
              {row.original.rule}
            </span>
          ) : (
            <span className="text-muted-foreground/50 text-xs">-</span>
          ),
      },
    ],
    []
  );

  const table = useTable({
    features: dataGridFeatures,
    data: rows,
    columns,
    getRowId: (row) => row.id,
    // The fixtures are one page. Without this the grid slices to ten rows and
    // the pagination controls never appear to say so.
    manualPagination: true,
  });

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold tracking-tight">Audit log</h1>
          <p className="text-muted-foreground max-w-2xl text-sm">
            Every action the assistant took, what it meant to do, and how to
            reverse it. Nothing is approved in advance, so this is the record
            that catches a mistake afterwards.
          </p>
        </div>

        <Tabs
          value={outcome}
          onValueChange={(value) => setOutcome(value as OutcomeFilter)}
        >
          <TabsList aria-label="Filter by outcome">
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="allowed">Allowed</TabsTrigger>
            <TabsTrigger value="denied">Denied</TabsTrigger>
            <TabsTrigger value="attempted">Attempted</TabsTrigger>
          </TabsList>
        </Tabs>
      </header>

      {/* min-w-0 matters: a flex child will not shrink below its content, so
          without it the fixed-width table grew the whole page instead of
          scrolling inside its own card. */}
      {status === "loading" && <PageLoading label="the audit log" rows={5} />}
      {status === "error" && <PageError what="The audit log" />}

      {status !== "loading" && status !== "error" && (
      <DataGrid
        table={table}
        recordCount={rows.length}
        onRowClick={(row) => setSelected(row)}
        emptyMessage="No actions match this filter."
        tableLayout={{ headerBackground: true, width: "fixed" }}
        className="min-w-0"
      >
        <DataGridContainer className="min-w-0">
          <DataGridScrollArea orientation="horizontal">
            <DataGridTable />
          </DataGridScrollArea>
        </DataGridContainer>
      </DataGrid>
      )}

      <Sheet
        open={selected !== null}
        onOpenChange={(next) => {
          if (!next) setSelected(null);
        }}
      >
        <SheetContent className="flex w-full flex-col gap-0 sm:max-w-lg">
          {selected && (
            <>
              <SheetHeader className="gap-3 border-b">
                <div className="flex flex-wrap items-center gap-2">
                  <OutcomeBadge outcome={selected.outcome} />
                  <Badge variant="outline" size="sm">
                    {SPACE_LABELS[selected.space]}
                  </Badge>
                  <span className="text-muted-foreground text-xs tabular-nums">
                    {formatStamp(selected.at)}
                  </span>
                </div>
                <SheetTitle className="text-left text-base">
                  {selected.action}
                </SheetTitle>
                {selected.rule && (
                  <SheetDescription className="text-left font-mono text-xs">
                    {selected.rule}
                  </SheetDescription>
                )}
              </SheetHeader>

              <dl className="flex flex-col gap-3 overflow-y-auto p-4">
                <Field label="Intent" value={selected.intent} />
                <Field label="State before" value={selected.before} />
                <Field label="Outcome" value={selected.result} />
                <Field label="How to reverse it" value={selected.reverse} />

                {/* The rule's own words, read from the policy rather than
                    copied onto the entry. A key alone says which rule fired
                    and nothing about what it governs. */}
                {selected.policy && (
                  <Field
                    label="The rule"
                    value={
                      <>
                        <span className="block">{selected.policy.governs}</span>
                        <span className="text-muted-foreground block">
                          {selected.policy.effect}
                        </span>
                      </>
                    }
                  />
                )}

                {/* Where a denial went. Nothing approves an action in advance,
                    so a refusal is queued for Shane, and the log says whether
                    that decision is still waiting. */}
                {selected.outcome === "denied" && (
                  <Field
                    label="Your decision"
                    value={
                      selected.decision ? (
                        <Link
                          href="/dashboard#needs-you"
                          className="text-primary focus-visible:ring-ring inline-flex w-fit items-center gap-1 rounded-sm font-medium underline underline-offset-2 focus-visible:ring-2 focus-visible:outline-none"
                        >
                          {selected.decision.title}
                          <ArrowUpRightIcon
                            className="size-3.5"
                            aria-hidden="true"
                          />
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">
                          Closed. Nothing is waiting on you for this one.
                        </span>
                      )
                    }
                  />
                )}
              </dl>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

export default function AuditPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <AuditLog />
    </Suspense>
  );
}
