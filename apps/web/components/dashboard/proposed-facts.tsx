"use client";

// KPA-40. The brief sketches this row as "Proposed facts (4) [y][n]".
//
// The reason box is inline rather than a modal. The queue is work done in a
// sitting, and a dialog per row makes that work slower than it needs to be.

import { useState } from "react";
import { CheckIcon, XIcon } from "lucide-react";

import { FactCard } from "@/components/fact-card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { Fact } from "@/lib/types";

export function ProposedFacts({
  facts,
  onAccept,
  onReject,
}: {
  facts: Fact[];
  onAccept: (factId: string) => void;
  onReject: (factId: string, reason: string) => void;
}) {
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  return (
    <ul className="flex flex-col gap-3">
      {facts.map((fact) => (
        <FactCard key={fact.id} fact={fact}>
          {rejecting === fact.id ? null : (
            <div className="flex shrink-0 gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => onAccept(fact.id)}
                aria-label={`Accept: ${fact.statement}`}
              >
                <CheckIcon className="size-3.5" aria-hidden="true" />
                Accept
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setRejecting(fact.id);
                  setReason("");
                }}
                aria-label={`Reject: ${fact.statement}`}
              >
                <XIcon className="size-3.5" aria-hidden="true" />
                Reject
              </Button>
            </div>
          )}

          {rejecting === fact.id && (
            <div className="flex w-full flex-col gap-2">
              <label
                htmlFor={`reason-${fact.id}`}
                className="text-muted-foreground text-xs"
              >
                Why is this wrong? A later run reads the reason and does not
                raise it again.
              </label>
              <Textarea
                id={`reason-${fact.id}`}
                value={reason}
                autoFocus
                rows={2}
                onChange={(event) => setReason(event.target.value)}
                placeholder="The transcript says three years, not five."
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={reason.trim().length === 0}
                  onClick={() => {
                    onReject(fact.id, reason.trim());
                    setRejecting(null);
                  }}
                >
                  Record rejection
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setRejecting(null)}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </FactCard>
      ))}
    </ul>
  );
}
