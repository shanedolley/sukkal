"use client";

// The panel behind every card on the briefing.
//
// It answers one question: where did this come from? A row that says Priya
// asked about the archive tier is useless in a reply until you can say it was
// the retention working session on 19 August, and quote her. So every panel
// ends with the source, the date, the author, and the passage itself, with a
// control that puts a citable line on the clipboard.
//
// It reads and never writes to a source. Ingestion stores those verbatim and
// nothing edits one afterwards, so there is no edit control here.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  ArrowUpRightIcon,
  CalendarIcon,
  CheckIcon,
  CopyIcon,
  FileTextIcon,
  MailIcon,
  MessagesSquareIcon,
  RotateCcwIcon,
  ShieldAlertIcon,
  UsersIcon,
  XIcon,
} from "lucide-react";

import { Badge } from "@/components/reui/badge";
import { FactStateBadge } from "@/components/fact-card";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { findAudit } from "@/lib/fixtures";
import { NO_ENTITY } from "@/lib/facts";
import { useNeedsYou } from "@/lib/needs-you-context";
import {
  formatDay,
  formatFullDay,
  formatLongDay,
  formatStamp,
  formatTime,
} from "@/lib/format";
import type { MeetingItem } from "@/lib/meetings";
import { useReview } from "@/lib/review-context";
import { movesFor } from "@/lib/review-state";
import { Skeleton } from "@/components/ui/skeleton";
import {
  SPACE_LABELS,
  type Fact,
  type NeedsYouItem,
  type NeedsYouKind,
  type Provenance,
  type Source,
  type SourceKind,
} from "@/lib/types";
import { cn } from "@/lib/utils";

/** What the panel is showing. */
export type DetailTarget =
  | { kind: "source"; sourceId: string; chunkId?: string }
  | { kind: "fact"; factId: string }
  | { kind: "needsYou"; itemId: string }
  // A meeting travels whole rather than by id, unlike the three above. A fact
  // is resolved on every render because a decision taken inside the panel
  // changes it; a meeting is a calendar row nothing here edits, so the row
  // the list already holds is the row to show. It also keeps the panel out of
  // the meetings read, which only the pages that list them need.
  | { kind: "meeting"; meeting: MeetingItem };

interface DetailPanelValue {
  open: (target: DetailTarget) => void;
}

const DetailPanelContext = createContext<DetailPanelValue | null>(null);

export function useDetailPanel(): DetailPanelValue {
  const value = useContext(DetailPanelContext);
  if (!value) {
    throw new Error("useDetailPanel must be used inside DetailPanelProvider");
  }
  return value;
}

const KIND_ICON: Record<SourceKind, typeof MailIcon> = {
  meeting: UsersIcon,
  mail: MailIcon,
  document: FileTextIcon,
  chat: MessagesSquareIcon,
};

const KIND_LABEL: Record<SourceKind, string> = {
  meeting: "Meeting transcript",
  mail: "Mail",
  document: "Document",
  chat: "Chat",
};

const NEEDS_YOU_LABEL: Record<NeedsYouKind, string> = {
  draft: "Draft ready",
  question: "Question",
  deadline: "Waiting",
  "denied-action": "Refused by policy",
  credential: "Credential",
};

// ── Building blocks ──────────────────────────────────────────────────────

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-muted-foreground text-xs font-medium">{label}</dt>
      <dd className="text-sm leading-relaxed">{value}</dd>
    </div>
  );
}

/** The line a person pastes into Slack or a reply. */
function referenceFor(source: Source, passage?: string) {
  const head = `${source.title} (${KIND_LABEL[source.kind].toLowerCase()}, ${source.author}), ${formatFullDay(source.date)}`;
  return passage ? `${head}\n"${passage}"` : head;
}

function CopyReference({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // A browser without clipboard permission. The passage is on screen and
      // selectable, so nothing is lost but the shortcut.
      setCopied(false);
    }
  }

  return (
    <Button size="sm" variant="outline" onClick={copy}>
      {copied ? (
        <CheckIcon className="size-3.5" aria-hidden="true" />
      ) : (
        <CopyIcon className="size-3.5" aria-hidden="true" />
      )}
      {copied ? "Copied" : "Copy reference"}
    </Button>
  );
}

/** What the drawer knows about a source, and whether it knows yet. */
interface SourceAnswer {
  sourceId: string;
  source: Source | null;
}

/**
 * One source, read from the database when the drawer opens on it.
 *
 * The answer is held with the id it answered for, so a drawer reopened on a
 * different source reads as loading during render rather than showing the
 * previous source under the new heading. That also keeps setState out of the
 * effect body, which the compiler refuses.
 */
function useSource(sourceId: string | undefined): {
  source: Source | null;
  loading: boolean;
} {
  const [answer, setAnswer] = useState<SourceAnswer | null>(null);

  useEffect(() => {
    if (!sourceId) return;
    const stop = new AbortController();

    fetch(`/api/sources?id=${encodeURIComponent(sourceId)}`, { signal: stop.signal })
      .then((response) =>
        response.ok ? (response.json() as Promise<Source>) : null
      )
      .then((source) => setAnswer({ sourceId, source }))
      .catch((cause: unknown) => {
        if (stop.signal.aborted) return;
        console.error("source:", cause);
        setAnswer({ sourceId, source: null });
      });

    return () => stop.abort();
  }, [sourceId]);

  if (!sourceId) return { source: null, loading: false };
  return answer && answer.sourceId === sourceId
    ? { source: answer.source, loading: false }
    : { source: null, loading: true };
}

function OriginNote({ children }: { children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2 border-t pt-4">
      <h3 className="text-muted-foreground text-xs font-medium">
        Where this came from
      </h3>
      <p className="text-muted-foreground text-xs">{children}</p>
    </section>
  );
}

/**
 * Where a thing came from, once the source has been read.
 *
 * Held apart from the fetch below because a source target has already read
 * its own source for the heading, and fetching it again here would ask the
 * database twice for one drawer.
 */
function OriginView({
  source,
  chunkId,
}: {
  source: Source;
  chunkId: string | undefined;
}) {
  const Icon = KIND_ICON[source.kind];
  const passage = source.chunks.find((c) => c.id === chunkId);

  return (
    <section className="flex flex-col gap-3 border-t pt-4">
      <h3 className="text-muted-foreground text-xs font-medium">
        Where this came from
      </h3>

      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary" size="sm">
          <Icon className="size-3" aria-hidden="true" />
          {KIND_LABEL[source.kind]}
        </Badge>
        <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
          <CalendarIcon className="size-3" aria-hidden="true" />
          {formatFullDay(source.date)}
        </span>
      </div>

      <p className="text-sm leading-snug font-medium">{source.title}</p>
      <p className="text-muted-foreground text-xs">{source.author}</p>

      {/* A derived_from edge written before chunking names no passage, and so
          does a source nothing has chunked. A meeting names none either: it
          opens its whole transcript rather than one line of it. The drawer
          opens at the top and says which, rather than marking a passage it
          cannot find. */}
      {!passage && (
        <p className="text-muted-foreground text-xs">
          {source.chunks.length === 0
            ? "Nothing has broken this source into passages yet, so it opens at the top."
            : "No passage is marked, so this opens at the top."}
        </p>
      )}

      <ol className="flex flex-col gap-2">
        {source.chunks.map((chunk) => {
          const cited = chunk.id === chunkId;
          return (
            <li
              key={chunk.id}
              aria-current={cited ? "true" : undefined}
              className={cn(
                "rounded-md border p-3 text-sm leading-relaxed",
                cited
                  ? "border-primary/40 bg-primary/5"
                  : "border-transparent bg-muted/40 text-muted-foreground"
              )}
            >
              {cited && (
                <span className="text-primary mb-1.5 block text-xs font-medium">
                  The passage this came from
                </span>
              )}
              {chunk.text}
            </li>
          );
        })}
      </ol>

      <div className="flex flex-wrap gap-2">
        <CopyReference text={referenceFor(source, passage?.text)} />
      </div>
    </section>
  );
}

/** Where a fact or a queue row came from. It reads its own source, because
 *  the source it names is not the one the drawer opened on. */
function Origin({ provenance }: { provenance: Provenance }) {
  const { source, loading } = useSource(provenance.sourceId);

  if (loading) {
    return (
      <section className="flex flex-col gap-2 border-t pt-4" aria-busy="true">
        <h3 className="text-muted-foreground text-xs font-medium">
          Where this came from
        </h3>
        <Skeleton className="h-3 w-2/3" />
        <Skeleton className="h-12 w-full" />
      </section>
    );
  }

  // Either the memory holds no such source, or the read did not answer. The
  // drawer says so: an empty section reads as a fault in the drawer rather
  // than as a source nothing has ingested yet.
  if (!source) {
    return (
      <OriginNote>
        This source is not in the memory yet, so there is nothing to open.
      </OriginNote>
    );
  }

  return <OriginView source={source} chunkId={provenance.chunkId} />;
}

// ── The three subjects ───────────────────────────────────────────────────

function SourceBody({
  source,
  chunkId,
}: {
  source: Source;
  chunkId: string | undefined;
}) {
  return (
    <div className="flex flex-col gap-4 p-4">
      <OriginView source={source} chunkId={chunkId} />
      <p className="text-muted-foreground text-xs">
        Sources are stored verbatim and never edited. Corrections are made by
        writing a new fact, not by changing this text.
      </p>
    </div>
  );
}

function FactBody({ fact }: { fact: Fact }) {
  const { accept, reject, reconfirm, failure } = useReview();
  const [reason, setReason] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const moves = movesFor(fact);

  return (
    <div className="flex flex-col gap-4 p-4">
      <dl className="grid grid-cols-2 gap-4">
        <Field label="Valid from" value={formatDay(fact.validFrom)} />
        <Field
          label="Valid to"
          value={fact.validTo ? formatDay(fact.validTo) : "open"}
        />
        {fact.staleAfter && (
          <Field label="Review by" value={formatDay(fact.staleAfter)} />
        )}
        <Field
          label="Written by"
          value={fact.generatedByAgent ? "An agent" : "You"}
        />
      </dl>

      {fact.rejectionReason && (
        <p className="text-muted-foreground border-l-2 pl-3 text-sm italic">
          Rejected: {fact.rejectionReason}
        </p>
      )}

      {fact.provenance ? (
        <Origin provenance={fact.provenance} />
      ) : (
        <OriginNote>
          Nothing recorded where this came from. A fact carries a source once a
          derived_from edge names one, and nothing writes that edge yet.
        </OriginNote>
      )}

      {moves.length > 0 && (
        <section className="flex flex-col gap-2 border-t pt-4">
          <h3 className="text-muted-foreground text-xs font-medium">
            Your decision
          </h3>
          {rejecting ? (
            <div className="flex flex-col gap-2">
              <label
                htmlFor="panel-reason"
                className="text-muted-foreground text-xs"
              >
                Why is this wrong? A later run reads the reason and does not
                raise it again.
              </label>
              <Textarea
                id="panel-reason"
                rows={2}
                autoFocus
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="The transcript says three years, not five."
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={reason.trim().length === 0}
                  onClick={() => {
                    reject(fact.id, reason.trim());
                    setRejecting(false);
                  }}
                >
                  Record rejection
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setRejecting(false)}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {moves.includes("accept") && (
                <Button size="sm" variant="outline" onClick={() => accept(fact.id)}>
                  <CheckIcon className="size-3.5" aria-hidden="true" />
                  Accept
                </Button>
              )}
              {moves.includes("reject") && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setRejecting(true);
                    setReason("");
                  }}
                >
                  <XIcon className="size-3.5" aria-hidden="true" />
                  Reject
                </Button>
              )}
              {moves.includes("reconfirm") && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => reconfirm(fact.id)}
                >
                  <RotateCcwIcon className="size-3.5" aria-hidden="true" />
                  Still true
                </Button>
              )}
            </div>
          )}

          {/* A write that failed put the row back. Without this the fact
              simply returns to the state it was in, and a row that comes back
              with no explanation reads as the panel losing the click. */}
          {failure && (
            <p
              role="alert"
              className="border-destructive/40 bg-destructive/5 text-destructive rounded-md border px-3 py-2 text-xs"
            >
              {failure} The fact is still where it was.
            </p>
          )}
        </section>
      )}
    </div>
  );
}

function NeedsYouBody({ item }: { item: NeedsYouItem }) {
  const audit = item.auditId ? findAudit(item.auditId) : undefined;

  return (
    <div className="flex flex-col gap-4 p-4">
      <p className="text-sm leading-relaxed">{item.detail}</p>

      <dl className="grid grid-cols-2 gap-4">
        <Field label="Raised" value={formatStamp(item.raisedAt)} />
        <Field label="Engagement" value={item.entity ?? "Not yet resolved"} />
      </dl>

      {audit && (
        <section className="flex flex-col gap-3 border-t pt-4">
          <h3 className="text-muted-foreground inline-flex items-center gap-1.5 text-xs font-medium">
            <ShieldAlertIcon className="size-3.5" aria-hidden="true" />
            What the policy refused
          </h3>
          <dl className="flex flex-col gap-3">
            <Field label="Intent" value={audit.intent} />
            <Field label="State before" value={audit.before} />
            <Field label="Outcome" value={audit.result} />
            <Field
              label="Rule"
              value={<code className="font-mono text-xs">{audit.rule}</code>}
            />
          </dl>
        </section>
      )}

      {item.provenance && <Origin provenance={item.provenance} />}

      {item.gmailUrl && (
        <a
          href={item.gmailUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary focus-visible:ring-ring inline-flex w-fit items-center gap-1 rounded-sm text-sm font-medium underline underline-offset-2 focus-visible:ring-2 focus-visible:outline-none"
        >
          Open the draft in Gmail
          <ArrowUpRightIcon className="size-3.5" aria-hidden="true" />
        </a>
      )}
    </div>
  );
}

/**
 * One meeting, and the transcript behind it or the reason there is none.
 *
 * A meeting with no transcript is the ordinary case and not a fault. ADR-0013
 * has nabium push the payload after the meeting ends, so the calendar row
 * exists for hours before anything transcribes it. The panel says so rather
 * than opening nothing, which is what the row did before KPA-118.
 */
function MeetingBody({ meeting }: { meeting: MeetingItem }) {
  return (
    <div className="flex flex-col gap-4 p-4">
      <dl className="grid grid-cols-2 gap-4">
        <Field label="Day" value={formatLongDay(meeting.start)} />
        <Field
          label="Time"
          value={`${formatTime(meeting.start)} to ${formatTime(meeting.end)}`}
        />
        <Field label="Engagement" value={meeting.engagement} />
        <Field label="Attendees" value={meeting.attendees.join(", ")} />
      </dl>

      {meeting.sourceId ? (
        <Origin provenance={{ sourceId: meeting.sourceId }} />
      ) : (
        <OriginNote>
          Nabium sends the transcript after the meeting ends, and it has not
          arrived yet. There is nothing to open.
        </OriginNote>
      )}
    </div>
  );
}

// ── The provider ─────────────────────────────────────────────────────────

export function DetailPanelProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [target, setTarget] = useState<DetailTarget | null>(null);
  const { facts } = useReview();
  const { items: needsYou } = useNeedsYou();

  const open = useCallback((next: DetailTarget) => setTarget(next), []);
  const value = useMemo(() => ({ open }), [open]);

  // Resolved on every render, so a decision taken inside the panel is
  // reflected in it rather than leaving a stale copy on screen.
  const fact =
    target?.kind === "fact"
      ? facts.find((f) => f.id === target.factId)
      : undefined;
  const item =
    target?.kind === "needsYou"
      ? needsYou.find((row) => row.id === target.itemId)
      : undefined;
  // The meeting rides on the target, so there is nothing to look up.
  const meeting = target?.kind === "meeting" ? target.meeting : undefined;
  // Read here rather than inside SourceBody, because the heading and the
  // badges need the same source the body renders. One read serves both.
  const { source: opened, loading: openingSource } = useSource(
    target?.kind === "source" ? target.sourceId : undefined
  );
  const source = target?.kind === "source" ? opened : null;

  let heading = "";
  let badges: React.ReactNode = null;

  if (fact) {
    heading = fact.statement;
    badges = (
      <>
        <FactStateBadge state={fact.state} />
        <Badge variant="outline" size="sm">
          {SPACE_LABELS[fact.space]}
        </Badge>
        <span className="text-muted-foreground text-xs">
          {fact.entity ?? NO_ENTITY}
        </span>
      </>
    );
  } else if (item) {
    heading = item.title;
    badges = (
      <>
        <Badge variant="secondary" size="sm">
          {NEEDS_YOU_LABEL[item.kind]}
        </Badge>
        <Badge variant="outline" size="sm">
          {SPACE_LABELS[item.space]}
        </Badge>
        {item.entity && (
          <span className="text-muted-foreground text-xs">{item.entity}</span>
        )}
      </>
    );
  } else if (meeting) {
    heading = meeting.title;
    badges = (
      <>
        <Badge variant="secondary" size="sm">
          <UsersIcon className="size-3" aria-hidden="true" />
          Meeting
        </Badge>
        <Badge variant="outline" size="sm">
          {SPACE_LABELS[meeting.space]}
        </Badge>
        <span className="text-muted-foreground text-xs">
          {meeting.engagement}
        </span>
      </>
    );
  } else if (source) {
    heading = source.title;
    badges = (
      <Badge variant="outline" size="sm">
        {SPACE_LABELS[source.space]}
      </Badge>
    );
  } else if (target?.kind === "source") {
    heading = openingSource
      ? "Opening the source"
      : "This source is not in the memory yet";
  }

  return (
    <DetailPanelContext value={value}>
      {children}
      <Sheet
        open={target !== null}
        onOpenChange={(next) => {
          if (!next) setTarget(null);
        }}
      >
        <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto sm:max-w-xl">
          {target && (
            <>
              <SheetHeader className="gap-3 border-b">
                <div className="flex flex-wrap items-center gap-2">{badges}</div>
                <SheetTitle className="text-left text-base leading-snug">
                  {heading}
                </SheetTitle>
                {source && (
                  <SheetDescription className="text-left">
                    {source.author}
                  </SheetDescription>
                )}
              </SheetHeader>

              {fact && <FactBody fact={fact} />}
              {item && <NeedsYouBody item={item} />}
              {meeting && <MeetingBody meeting={meeting} />}
              {source && (
                <SourceBody
                  source={source}
                  chunkId={
                    target.kind === "source" ? target.chunkId : undefined
                  }
                />
              )}
              {target.kind === "source" && !source && (
                <div className="flex flex-col gap-3 p-4">
                  {openingSource ? (
                    <>
                      <Skeleton className="h-3 w-2/3" />
                      <Skeleton className="h-16 w-full" />
                    </>
                  ) : (
                    <p className="text-muted-foreground text-sm">
                      Nothing has ingested this source, so there is no passage
                      to open. Nothing was changed.
                    </p>
                  )}
                </div>
              )}
            </>
          )}
        </SheetContent>
      </Sheet>
    </DetailPanelContext>
  );
}
