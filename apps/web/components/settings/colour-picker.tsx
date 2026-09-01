"use client";

// A row of colour choices, with one of your own on the end.
//
// The swatch is the label. A name alone tells you nothing about what "Ocean"
// looks like, and a colour with no name is unreadable to a screen reader, so
// each option carries both.
//
// The custom option is a native <input type="color">. The operating system's
// own picker is better than anything worth building here, it is reachable by
// keyboard already, and it costs no dependency.

import { CheckIcon, PipetteIcon } from "lucide-react";

import type { Preset } from "@/lib/appearance";
import { cn } from "@/lib/utils";

export function ColourPicker({
  presets,
  value,
  onChange,
  label,
  custom,
}: {
  presets: Preset[];
  value: string;
  onChange: (id: string) => void;
  label: string;
  custom?: {
    hex: string;
    /** The colour that will actually be used, after the contrast guard. */
    swatch: string;
    onPick: (hex: string) => void;
  };
}) {
  const customActive = value === "custom";

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

      {custom && (
        <label
          className={cn(
            "focus-within:ring-ring inline-flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs transition-colors focus-within:ring-2",
            customActive
              ? "border-foreground/30 bg-muted font-medium"
              : "border-border hover:bg-muted/60"
          )}
        >
          {/* The visible swatch is the colour after the contrast guard, not
              the raw pick, so what you see is what the interface uses. */}
          <span
            aria-hidden="true"
            className="border-border/60 size-4 shrink-0 rounded-full border"
            style={{ background: customActive ? custom.swatch : undefined }}
          >
            {!customActive && (
              <PipetteIcon className="text-muted-foreground size-4 p-0.5" />
            )}
          </span>
          {custom.hex && customActive ? custom.hex.toUpperCase() : "Custom"}
          {customActive && <CheckIcon className="size-3" aria-hidden="true" />}
          <input
            type="color"
            value={custom.hex}
            aria-label={`${label}: choose your own`}
            onChange={(event) => custom.onPick(event.target.value)}
            className="sr-only"
          />
        </label>
      )}
    </div>
  );
}
