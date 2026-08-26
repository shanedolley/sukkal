"use client";

// KPA-39. The day's meetings, each tied to the engagement it belongs to.

import { UsersIcon } from "lucide-react";

import { Badge } from "@/components/reui/badge";
import { formatTime } from "@/lib/format";
import { SPACE_LABELS, type Meeting } from "@/lib/types";

export function MeetingsToday({ meetings }: { meetings: Meeting[] }) {
  return (
    <ul className="flex flex-col gap-3">
      {meetings.map((meeting) => (
        <li
          key={meeting.id}
          className="border-border/70 flex gap-3 rounded-lg border p-3"
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
            <p className="text-sm leading-snug font-medium">{meeting.title}</p>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" size="sm">
                {SPACE_LABELS[meeting.space]}
              </Badge>
              <span className="text-muted-foreground text-xs">
                {meeting.engagement}
              </span>
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
