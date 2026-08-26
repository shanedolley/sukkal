"use client";

// One fact, with everything the brief says a reader needs to judge it:
// the state, the dates it holds between, and where it came from.

import { ArrowUpRightIcon } from "lucide-react";

import { Badge } from "@/components/reui/badge";
import { useSourceDrawer } from "@/components/source-drawer";
import { formatDay } from "@/lib/format";
import { findSource } from "@/lib/fixtures";
import { FACT_STATE_LABELS, SPACE_LABELS, type Fact, type FactState } from "@/lib/types";

// A colour per state, so the queue reads at a glance. Verified is calm,
// stale asks for attention, retired steps back.
const STATE_VARIANT: Record<
  FactState,
  React.ComponentProps<typeof Badge>["variant"]
> = {
  candidate: "secondary",
  proposed: "info-light",
  verified: "success-light",
  stale: "warning-light",
  retired: "outline",
  rejected: "destructive-light",
};

export function FactStateBadge({ state }: { state: FactState }) {
  return (
    <Badge variant={STATE_VARIANT[state]} size="sm">
      {FACT_STATE_LABELS[state]}
    </Badge>
  );
}

export function FactCard({
  fact,
  children,
}: {
  fact: Fact;
  /** The review controls, when the region offers any. */
  children?: React.ReactNode;
}) {
  const { open } = useSourceDrawer();
  const source = findSource(fact.provenance.sourceId);

  return (
    <li className="border-border/70 flex flex-col gap-3 rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <FactStateBadge state={fact.state} />
        <Badge variant="outline" size="sm">
          {SPACE_LABELS[fact.space]}
        </Badge>
        <span className="text-muted-foreground text-xs">{fact.entity}</span>
        {fact.generatedByAgent && (
          <span className="text-muted-foreground text-xs">· written by an agent</span>
        )}
      </div>

      <p className="text-sm leading-snug">{fact.statement}</p>

      <dl className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs">
        <div className="flex gap-1">
          <dt>Valid from</dt>
          <dd className="text-foreground/80">{formatDay(fact.validFrom)}</dd>
        </div>
        <div className="flex gap-1">
          <dt>Valid to</dt>
          {/* An open valid_to is the normal case: only a source or a human
              closes it, so "open" is a fact doing its job, not a gap. */}
          <dd className="text-foreground/80">
            {fact.validTo ? formatDay(fact.validTo) : "open"}
          </dd>
        </div>
        {fact.staleAfter && (
          <div className="flex gap-1">
            <dt>Review by</dt>
            <dd className="text-foreground/80">{formatDay(fact.staleAfter)}</dd>
          </div>
        )}
      </dl>

      {fact.rejectionReason && (
        <p className="text-muted-foreground border-l-2 pl-2 text-xs italic">
          Rejected: {fact.rejectionReason}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        {source ? (
          <button
            type="button"
            onClick={() =>
              open({
                sourceId: fact.provenance.sourceId,
                chunkId: fact.provenance.chunkId,
              })
            }
            className="text-muted-foreground hover:text-foreground focus-visible:ring-ring inline-flex max-w-full items-center gap-1 rounded-sm text-xs underline underline-offset-2 focus-visible:ring-2 focus-visible:outline-none"
          >
            <span className="truncate">{source.title}</span>
            <ArrowUpRightIcon className="size-3 shrink-0" aria-hidden="true" />
          </button>
        ) : (
          <span />
        )}
        {children}
      </div>
    </li>
  );
}
