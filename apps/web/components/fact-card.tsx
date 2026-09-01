"use client";

// One fact, with everything the brief says a reader needs to judge it:
// the state, the dates it holds between, and where it came from.
//
// The whole card opens the panel, but the card is not a button. The statement
// is, and it stretches over the card with an ::after overlay. The review
// controls and the provenance sit above that overlay. A button inside a button
// would be invalid markup and would give the keyboard two targets for one row.

import { Badge } from "@/components/reui/badge";
import { useDetailPanel } from "@/components/detail-panel";
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
  const { open } = useDetailPanel();
  const source = findSource(fact.provenance.sourceId);

  return (
    <li className="border-border/70 hover:border-border hover:bg-muted/30 relative flex flex-col gap-3 rounded-lg border p-3 transition-colors">
      <div className="flex flex-wrap items-center gap-2">
        <FactStateBadge state={fact.state} />
        <Badge variant="outline" size="sm">
          {SPACE_LABELS[fact.space]}
        </Badge>
        <span className="text-muted-foreground text-xs">{fact.entity}</span>
        {fact.generatedByAgent && (
          <span className="text-muted-foreground text-xs">
            &middot; written by an agent
          </span>
        )}
      </div>

      <button
        type="button"
        onClick={() => open({ kind: "fact", factId: fact.id })}
        className="focus-visible:ring-ring rounded-sm text-left text-sm leading-snug after:absolute after:inset-0 after:content-[''] focus-visible:ring-2 focus-visible:outline-none"
      >
        {fact.statement}
        <span className="sr-only">. Open its detail and source.</span>
      </button>

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

      <div className="relative z-10 flex flex-wrap items-center justify-between gap-2">
        {source ? (
          // KPA-42. The provenance opens the same drawer a citation opens, on
          // the chunk this fact came from. It sits above the statement's
          // overlay, so it takes the click rather than passing it on.
          <button
            type="button"
            onClick={() =>
              open({
                kind: "source",
                sourceId: fact.provenance.sourceId,
                chunkId: fact.provenance.chunkId,
              })
            }
            className="text-muted-foreground hover:text-foreground focus-visible:ring-ring max-w-full truncate rounded-sm text-xs underline decoration-dotted underline-offset-2 transition-colors focus-visible:ring-2 focus-visible:outline-none"
          >
            {source.title}
            <span className="sr-only">. Open the passage this came from.</span>
          </button>
        ) : (
          <span />
        )}
        {children}
      </div>
    </li>
  );
}
