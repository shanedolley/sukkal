"use client";

// KPA-39. The items that wait on a decision from Shane.
//
// A draft row links out to Gmail rather than showing an editor. The brief's
// "Triaging mail" ends with Shane reviewing and sending in Gmail, and the
// policy says a message leaves the box only after he clicks. Keeping the send
// button where he already trusts it is the point.

import {
  ArrowUpRightIcon,
  CalendarClockIcon,
  CircleHelpIcon,
  MailIcon,
  ShieldAlertIcon,
} from "lucide-react";

import { Badge } from "@/components/reui/badge";
import { SPACE_LABELS, type NeedsYouItem, type NeedsYouKind } from "@/lib/types";

const KIND: Record<
  NeedsYouKind,
  { icon: typeof MailIcon; label: string; tone: string }
> = {
  draft: { icon: MailIcon, label: "Draft ready", tone: "text-sky-600 dark:text-sky-400" },
  question: { icon: CircleHelpIcon, label: "Question", tone: "text-violet-600 dark:text-violet-400" },
  deadline: { icon: CalendarClockIcon, label: "Waiting", tone: "text-amber-600 dark:text-amber-400" },
  "denied-action": { icon: ShieldAlertIcon, label: "Refused by policy", tone: "text-rose-600 dark:text-rose-400" },
};

export function NeedsYou({ items }: { items: NeedsYouItem[] }) {
  return (
    <ul className="flex flex-col gap-3">
      {items.map((item) => {
        const kind = KIND[item.kind];
        const Icon = kind.icon;
        return (
          <li
            key={item.id}
            className="border-border/70 flex flex-col gap-2 rounded-lg border p-3"
          >
            <div className="flex flex-wrap items-center gap-2">
              <Icon className={`size-3.5 shrink-0 ${kind.tone}`} aria-hidden="true" />
              <span className="text-muted-foreground text-xs">{kind.label}</span>
              <Badge variant="outline" size="sm">
                {SPACE_LABELS[item.space]}
              </Badge>
              <span className="text-muted-foreground text-xs">{item.entity}</span>
            </div>

            <p className="text-sm leading-snug font-medium">{item.title}</p>
            <p className="text-muted-foreground text-xs leading-relaxed">
              {item.detail}
            </p>

            {item.rule && (
              <p className="text-muted-foreground font-mono text-xs">
                rule: {item.rule}
              </p>
            )}

            {item.gmailUrl && (
              <a
                href={item.gmailUrl}
                target="_blank"
                rel="noreferrer"
                className="text-primary focus-visible:ring-ring inline-flex w-fit items-center gap-1 rounded-sm text-xs font-medium underline underline-offset-2 focus-visible:ring-2 focus-visible:outline-none"
              >
                Open in Gmail
                <ArrowUpRightIcon className="size-3" aria-hidden="true" />
              </a>
            )}
          </li>
        );
      })}
    </ul>
  );
}
