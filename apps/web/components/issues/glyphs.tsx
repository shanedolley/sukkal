"use client";

// The marks a row and a form both draw.
//
// They live here rather than in the list because the form draws the same
// status and the same priority, and two copies would drift the day one of
// them changed.

import { cn } from "@/lib/utils";
import {
  ISSUE_PRIORITY_LABELS,
  type IssuePriority,
  type IssueStatus,
} from "@/lib/types";

const STATUS_COLOUR: Record<IssueStatus, string> = {
  backlog: "text-muted-foreground",
  todo: "text-muted-foreground",
  "in-progress": "text-warning",
  "in-review": "text-info",
  done: "text-primary",
  cancelled: "text-muted-foreground",
};

/** How many of the three bars are lit. */
const PRIORITY_LEVEL: Record<IssuePriority, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
  urgent: 3,
};

const BAR_HEIGHTS = ["h-1.5", "h-2.5", "h-3.5"];

export function PriorityGlyph({
  priority,
  silent,
}: {
  priority: IssuePriority;
  /** Set where the name is already written beside the mark, such as a chip
   *  in the form. Two names for one control is one too many. */
  silent?: boolean;
}) {
  const label = silent ? undefined : ISSUE_PRIORITY_LABELS[priority];

  // Urgent leaves the scale. Linear marks it, and so does this.
  if (priority === "urgent") {
    return (
      <span
        title={label}
        className="bg-warning text-warning-foreground flex size-4 shrink-0 items-center justify-center rounded-[3px] text-[10px] leading-none font-bold"
      >
        <span aria-hidden="true">!</span>
        {label && <span className="sr-only">{label}</span>}
      </span>
    );
  }

  const lit = PRIORITY_LEVEL[priority];
  return (
    <span
      title={label}
      className="flex size-4 shrink-0 items-end justify-center gap-0.5"
    >
      {BAR_HEIGHTS.map((height, bar) => (
        <span
          key={height}
          aria-hidden="true"
          className={cn(
            "w-[3px] rounded-[1px]",
            height,
            bar < lit ? "bg-foreground/60" : "bg-foreground/15"
          )}
        />
      ))}
      {label && <span className="sr-only">{label}</span>}
    </span>
  );
}

/** The board glyph. In progress is a part-filled pie, as Linear draws it. */
export function StatusGlyph({
  status,
  className,
}: {
  status: IssueStatus;
  className?: string;
}) {
  const shared = cn("size-3.5 shrink-0", STATUS_COLOUR[status], className);

  if (status === "done" || status === "cancelled") {
    return (
      <svg viewBox="0 0 16 16" className={shared} aria-hidden="true">
        <circle cx="8" cy="8" r="7" fill="currentColor" />
        {status === "done" ? (
          <path
            d="m4.8 8.2 2.1 2.1 4.3-4.4"
            fill="none"
            stroke="var(--color-background)"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : (
          <path
            d="M5.5 5.5 10.5 10.5M10.5 5.5 5.5 10.5"
            fill="none"
            stroke="var(--color-background)"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        )}
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 16 16" className={shared} aria-hidden="true">
      <circle
        cx="8"
        cy="8"
        r="6.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeDasharray={status === "backlog" ? "2.2 2.2" : undefined}
      />
      {status === "in-progress" && (
        <path d="M8 8V3.4A4.6 4.6 0 0 1 12 10.3Z" fill="currentColor" />
      )}
      {status === "in-review" && (
        <path d="M8 8V3.4A4.6 4.6 0 0 1 8 12.6Z" fill="currentColor" />
      )}
    </svg>
  );
}

const LABEL_DOTS = [
  "bg-info",
  "bg-primary",
  "bg-warning",
  "bg-destructive",
  "bg-success",
];

/** The same label keeps the same colour on every row. */
export function dotFor(label: string): string {
  const sum = [...label].reduce((total, ch) => total + ch.charCodeAt(0), 0);
  return LABEL_DOTS[sum % LABEL_DOTS.length];
}
