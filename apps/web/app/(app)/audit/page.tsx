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

import { useMemo, useState } from "react";
import { useTable, type ColumnDef } from "@tanstack/react-table";
import { CheckCircle2Icon, ShieldXIcon } from "lucide-react";

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
import { AUDIT } from "@/lib/fixtures";
import { inSpace, useSpace } from "@/lib/space-context";
import { SPACE_LABELS, type AuditEntry, type AuditOutcome } from "@/lib/types";

type OutcomeFilter = AuditOutcome | "all";

function stamp(iso: string) {
  return new Date(iso).toLocaleString("en-AU", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function OutcomeBadge({ outcome }: { outcome: AuditOutcome }) {
  return outcome === "allowed" ? (
    <Badge variant="success-light" size="sm">
      <CheckCircle2Icon className="size-3" aria-hidden="true" />
      Allowed
    </Badge>
  ) : (
    <Badge variant="destructive-light" size="sm">
      <ShieldXIcon className="size-3" aria-hidden="true" />
      Denied
    </Badge>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 border-b pb-3 last:border-b-0">
      <dt className="text-muted-foreground text-xs font-medium">{label}</dt>
      <dd className="text-sm leading-relaxed">{value}</dd>
    </div>
  );
}

export default function AuditPage() {
  const { space } = useSpace();
  const [outcome, setOutcome] = useState<OutcomeFilter>("all");
  const [selected, setSelected] = useState<AuditEntry | null>(null);

  const rows = useMemo(() => {
    const bySpace = inSpace(AUDIT, space);
    return outcome === "all"
      ? bySpace
      : bySpace.filter((entry) => entry.outcome === outcome);
  }, [space, outcome]);

  const columns = useMemo<ColumnDef<DataGridFeatures, AuditEntry>[]>(
    () => [
      {
        id: "at",
        accessorKey: "at",
        header: "When",
        size: 110,
        cell: ({ row }) => (
          <span className="text-muted-foreground text-xs tabular-nums">
            {stamp(row.original.at)}
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
        id: "intent",
        accessorKey: "intent",
        header: "Intent",
        size: 330,
        cell: ({ row }) => (
          // block, not inline: truncate needs a box with a definite width, and
          // a bare <span> has neither, so the text ran under the next column.
          <div className="text-muted-foreground truncate text-sm">
            {row.original.intent}
          </div>
        ),
      },
      {
        id: "outcome",
        accessorKey: "outcome",
        header: "Outcome",
        size: 105,
        cell: ({ row }) => <OutcomeBadge outcome={row.original.outcome} />,
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
          </TabsList>
        </Tabs>
      </header>

      {/* min-w-0 matters: a flex child will not shrink below its content, so
          without it the fixed-width table grew the whole page instead of
          scrolling inside its own card. */}
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
                    {stamp(selected.at)}
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
              </dl>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
