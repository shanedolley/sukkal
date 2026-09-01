"use client";

// How full the context window is, at the top of every chat.
//
// It stays quiet below 70 per cent, because a number nobody needs to act on
// is a number that trains you to ignore the meter. Past 70 it says so. Past
// 90 it says what to do about it, because by then a new chat is the answer
// rather than a shorter question.

import Link from "next/link";
import { PlusIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { contextUsage, CONTEXT_WINDOW_TOKENS } from "@/lib/context-window";
import { cn } from "@/lib/utils";

const TONE = {
  ample: { bar: "bg-muted-foreground/40", text: "text-muted-foreground" },
  filling: { bar: "bg-warning", text: "text-warning" },
  tight: { bar: "bg-destructive", text: "text-destructive" },
} as const;

const MESSAGE = {
  ample: "",
  filling: "This chat is getting long. A new one starts fresh.",
  tight: "Almost full. Start a new chat before the beginning is dropped.",
} as const;

function compact(tokens: number) {
  return tokens >= 1000 ? `${Math.round(tokens / 1000)}k` : `${tokens}`;
}

export function ContextMeter({ tokens }: { tokens: number }) {
  const { percent, level } = contextUsage(tokens);
  const tone = TONE[level];
  const rounded = Math.round(percent);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-3">
        <div
          className="bg-muted h-1 w-24 shrink-0 overflow-hidden rounded-full"
          role="meter"
          aria-valuenow={rounded}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Context window used"
        >
          <div
            className={cn("h-full rounded-full transition-all", tone.bar)}
            style={{ width: `${Math.max(2, percent)}%` }}
          />
        </div>

        <span className={cn("text-xs tabular-nums", tone.text)}>
          {rounded}% of context
        </span>

        <span className="text-muted-foreground hidden text-xs tabular-nums sm:inline">
          {compact(tokens)} of {compact(CONTEXT_WINDOW_TOKENS)} tokens
        </span>

        {level === "tight" && (
          <Button
            render={<Link href="/chat" />}
            nativeButton={false}
            size="sm"
            variant="outline"
            // relative z-10: in the history list this meter sits inside a card
            // whose title stretches an ::after overlay across it. Without a
            // stacking context of its own the button paints under that overlay
            // and the row's own link swallows the click.
            className="relative z-10 ml-auto"
          >
            <PlusIcon className="size-3.5" aria-hidden="true" />
            New chat
          </Button>
        )}
      </div>

      {MESSAGE[level] && (
        <p className={cn("text-xs", tone.text)}>{MESSAGE[level]}</p>
      )}
    </div>
  );
}
