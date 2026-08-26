"use client";

// KPA-40. The output of the staleness sweep.
//
// One control only. The brief is explicit: the sweep flags and re-confirms,
// and it never retires. A stale fact is due for review, not false, so there is
// no retire button here. Retirement needs a contradicting source or Shane
// setting a date, and neither happens from this queue.

import { RotateCcwIcon } from "lucide-react";

import { FactCard } from "@/components/fact-card";
import { Button } from "@/components/ui/button";
import type { Fact } from "@/lib/types";

function daysOverdue(staleAfter: string, today: string) {
  const ms = new Date(today).getTime() - new Date(staleAfter).getTime();
  return Math.max(0, Math.round(ms / 86_400_000));
}

export function StaleFacts({
  facts,
  today,
  onReconfirm,
}: {
  facts: Fact[];
  today: string;
  onReconfirm: (factId: string) => void;
}) {
  return (
    <ul className="flex flex-col gap-3">
      {facts.map((fact) => (
        <FactCard key={fact.id} fact={fact}>
          <div className="flex shrink-0 items-center gap-3">
            {fact.staleAfter && (
              <span className="text-muted-foreground text-xs">
                {daysOverdue(fact.staleAfter, today)} days past review
              </span>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={() => onReconfirm(fact.id)}
              aria-label={`Re-confirm: ${fact.statement}`}
            >
              <RotateCcwIcon className="size-3.5" aria-hidden="true" />
              Still true
            </Button>
          </div>
        </FactCard>
      ))}
    </ul>
  );
}
