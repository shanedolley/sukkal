"use client";

// KPA-39. The items that wait on a decision from Shane.
//
// Every row opens a panel that says where it came from: the meeting or the
// mail, the date, the author, and the passage itself. A row that says Priya
// asked about the archive tier is no use in a reply until you can cite the
// session it came from, so the panel carries a control that puts a quotable
// line on the clipboard.
//
// A draft row links out to Gmail rather than showing an editor. The brief's
// "Triaging mail" ends with Shane reviewing and sending in Gmail, and the
// policy says a message leaves the box only after he clicks.

import {
  ArrowUpRightIcon,
  CalendarClockIcon,
  CircleHelpIcon,
  MailIcon,
  ShieldAlertIcon,
} from "lucide-react";

import { Badge } from "@/components/reui/badge";
import { useDetailPanel } from "@/components/detail-panel";
import { SPACE_LABELS, type NeedsYouItem, type NeedsYouKind } from "@/lib/types";

// Semantic tokens, not palette steps: the ReUI theme defines these and they
// carry a meaning that survives a change of preset.
const KIND: Record<
  NeedsYouKind,
  { icon: typeof MailIcon; label: string; tone: string }
> = {
  draft: { icon: MailIcon, label: "Draft ready", tone: "text-info" },
  question: { icon: CircleHelpIcon, label: "Question", tone: "text-primary" },
  deadline: { icon: CalendarClockIcon, label: "Waiting", tone: "text-warning" },
  "denied-action": {
    icon: ShieldAlertIcon,
    label: "Refused by policy",
    tone: "text-destructive",
  },
};

export function NeedsYou({ items }: { items: NeedsYouItem[] }) {
  const { open } = useDetailPanel();

  return (
    <ul className="flex flex-col gap-3">
      {items.map((item) => {
        const kind = KIND[item.kind];
        const Icon = kind.icon;
        return (
          <li
            key={item.id}
            className="border-border/70 hover:border-border hover:bg-muted/30 relative flex flex-col gap-2 rounded-lg border p-3 transition-colors"
          >
            <div className="flex flex-wrap items-center gap-2">
              <Icon
                className={`size-3.5 shrink-0 ${kind.tone}`}
                aria-hidden="true"
              />
              <span className="text-muted-foreground text-xs">{kind.label}</span>
              <Badge variant="outline" size="sm">
                {SPACE_LABELS[item.space]}
              </Badge>
              {item.entity && (
                <span className="text-muted-foreground text-xs">
                  {item.entity}
                </span>
              )}
            </div>

            {/* The title stretches over the card, so the whole row is the
                target, while the Gmail link below stays its own control. */}
            <button
              type="button"
              onClick={() => open({ kind: "needsYou", itemId: item.id })}
              className="focus-visible:ring-ring rounded-sm text-left text-sm leading-snug font-medium after:absolute after:inset-0 after:content-[''] focus-visible:ring-2 focus-visible:outline-none"
            >
              {item.title}
              <span className="sr-only">. Open its detail and source.</span>
            </button>

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
                rel="noopener noreferrer"
                className="text-primary focus-visible:ring-ring relative z-10 inline-flex w-fit items-center gap-1 rounded-sm text-xs font-medium underline underline-offset-2 focus-visible:ring-2 focus-visible:outline-none"
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
