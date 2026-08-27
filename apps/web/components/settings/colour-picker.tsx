"use client";

// A row of colour choices.
//
// The swatch is the label. A name alone tells you nothing about what "Ocean"
// looks like, and a colour with no name is unreadable to a screen reader, so
// each option carries both.

import { CheckIcon } from "lucide-react";

import type { Preset } from "@/lib/appearance";
import { cn } from "@/lib/utils";

export function ColourPicker({
  presets,
  value,
  onChange,
  label,
}: {
  presets: Preset[];
  value: string;
  onChange: (id: string) => void;
  label: string;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-2">
      {presets.map((preset) => {
        const active = preset.id === value;
        return (
          <button
            key={preset.id}
            type="button"
            onClick={() => onChange(preset.id)}
            aria-pressed={active}
            className={cn(
              "focus-visible:ring-ring inline-flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs transition-colors focus-visible:ring-2 focus-visible:outline-none",
              active
                ? "border-foreground/30 bg-muted font-medium"
                : "border-border hover:bg-muted/60"
            )}
          >
            <span
              aria-hidden="true"
              className="size-4 shrink-0 rounded-full"
              style={{ background: preset.swatch }}
            />
            {preset.label}
            {active && <CheckIcon className="size-3" aria-hidden="true" />}
          </button>
        );
      })}
    </div>
  );
}
