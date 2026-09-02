"use client";

// KPA-39, KPA-118. The day's meetings, each tied to the engagement it belongs
// to, and each one opening.
//
// Every other list in the application opened a panel and this one did not,
// because a fixture meeting had nothing behind it to open. A row now names
// the source its transcript became, so the panel opens the transcript, or
// says nabium has not sent one yet. ADR-0013 makes the second the ordinary
// case: the calendar row exists long before the recording does.

import { FileTextIcon, UsersIcon } from "lucide-react";

import { Badge } from "@/components/reui/badge";
import { useDetailPanel } from "@/components/detail-panel";
import { formatTime } from "@/lib/format";
import type { MeetingItem } from "@/lib/meetings";
import { SPACE_LABELS } from "@/lib/types";

export function MeetingsToday({ meetings }: { meetings: MeetingItem[] }) {
  const { open } = useDetailPanel();

  return (
    <ul className="flex flex-col gap-3">
      {meetings.map((meeting) => (
        <li
          key={meeting.id}
          className="border-border/70 hover:border-border hover:bg-muted/30 relative flex gap-3 rounded-lg border p-3 transition-colors"
        >
          {/* The time is the thing scanned first, so it leads the row. */}
          <div className="flex w-16 shrink-0 flex-col">
            <span className="text-sm font-medium tabular-nums">
              {formatTime(meeting.start)}
            </span>
            <span className="text-muted-foreground text-xs tabular-nums">
              {formatTime(meeting.end)}
            </span>
          </div>

          <div className="flex min-w-0 flex-col gap-1.5">
            {/* The title stretches over the card, so the whole row is the
                target, the same way a Needs you row works. */}
            <button
              type="button"
              onClick={() => open({ kind: "meeting", meeting })}
              className="focus-visible:ring-ring rounded-sm text-left text-sm leading-snug font-medium after:absolute after:inset-0 after:content-[''] focus-visible:ring-2 focus-visible:outline-none"
            >
              {meeting.title}
              <span className="sr-only">
                . Open its detail and its transcript.
              </span>
            </button>

            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" size="sm">
                {SPACE_LABELS[meeting.space]}
              </Badge>
              <span className="text-muted-foreground text-xs">
                {meeting.engagement}
              </span>
              {/* Said on the row rather than found on opening it, because
                  whether the transcript has landed is the reason to open one
                  at all. */}
              {meeting.sourceId && (
                <Badge variant="secondary" size="sm">
                  <FileTextIcon className="size-3" aria-hidden="true" />
                  Transcript
                </Badge>
              )}
            </div>

            <p className="text-muted-foreground inline-flex items-center gap-1 text-xs">
              <UsersIcon className="size-3 shrink-0" aria-hidden="true" />
              {meeting.attendees.join(", ")}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}
