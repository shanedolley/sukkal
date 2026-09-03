"use client";

// The wait after the last question.
//
// The box has to build itself before it can answer anything: a schema, an
// index, a worker and its schedules. That takes a couple of minutes, which is
// long enough for somebody to wonder whether it has hung and reach for the
// reload. So the screen says what it is doing, one step at a time, and keeps
// a clock running. A bar with no words under it says only "wait", and a
// person who is only told to wait assumes the worst.
//
// The steps are the real ones. When the worker reports its own progress this
// screen takes the same shape and reads it, rather than counting seconds.
//
// ponytail: nothing is being built. The stages run on a timer in the browser,
// because no worker exists to report against, so closing the tab loses the
// run. A real bootstrap runs on the server and survives a closed tab: feed
// this from the bootstrap endpoint when there is one, and keep everything
// below the STAGES list.

import { useEffect, useState } from "react";
import { CheckIcon } from "lucide-react";

import { AssistantAvatar } from "@/components/setup/assistant-avatar";
import { Card, CardContent } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

interface Stage {
  id: string;
  label: string;
  /** Roughly how long it takes on the hardware the brief names. */
  seconds: number;
  /** What it is doing now, given how far through this stage it is. */
  detail: (through: number) => string;
}

const STAGES: Stage[] = [
  {
    id: "account",
    label: "Account setup",
    seconds: 6,
    detail: () => "One row, one person",
  },
  {
    id: "database",
    label: "Database creation",
    seconds: 34,
    detail: (through) =>
      `Migration ${Math.max(1, Math.ceil(through * 32))} of 32`,
  },
  {
    id: "memory",
    label: "Memory generation",
    seconds: 28,
    detail: () => "pgvector, HNSW, over an empty table",
  },
  {
    id: "services",
    label: "Starting services",
    seconds: 18,
    detail: () => "Ingestion, agents and the job queue",
  },
  {
    id: "schedules",
    label: "Preparing schedules",
    seconds: 14,
    detail: () => "Trackers every five minutes, the sweep at two",
  },
  {
    id: "interface",
    label: "Loading the interface",
    seconds: 20,
    detail: () => "The first question it answers is its own health",
  },
];

const TOTAL = STAGES.reduce((sum, stage) => sum + stage.seconds, 0);

// The stated times are the real ones. A draft that made a reviewer sit
// through two minutes would be reviewed once, so it runs at a fraction of
// them. Set this to 1 the day the worker reports its own progress.
const DRAFT_PACE = 0.12;

const TICK = 100;

/**
 * A line arriving a letter at a time, with a block for a cursor.
 *
 * The wait is the assistant's first act of work, so it says so itself rather
 * than a caption saying it on its behalf. Typing it out makes the screen feel
 * attended, which is the whole job of this page.
 *
 * The reader who cannot see it gets the finished line at once, because a
 * sentence read out one letter at a time is no sentence at all.
 */
function Typed({ text }: { text: string }) {
  const [shown, setShown] = useState(0);

  // The line is written once and never changes. A caller who wants a second
  // one gives this a key, which starts the typing over.
  //
  // The stop lives here rather than inside the updater. React treats an
  // updater as pure and calls it twice in development, so a timer cleared
  // from inside one is cleared by a call whose result is thrown away.
  useEffect(() => {
    if (shown >= text.length) return;
    const timer = setTimeout(() => setShown(shown + 1), 34);
    return () => clearTimeout(timer);
  }, [shown, text]);

  return (
    <p className="text-sm text-pretty">
      <span className="sr-only">{text}</span>
      <span aria-hidden="true">
        {text.slice(0, shown)}
        <span className="bg-foreground/70 ml-0.5 inline-block h-[1em] w-[0.5em] translate-y-[0.15em] animate-[kpa-caret_1s_step-end_infinite]" />
      </span>
      <style>{`@keyframes kpa-caret { 0%, 50% { opacity: 1 } 50.01%, 100% { opacity: 0 } }`}</style>
    </p>
  );
}

/** "1:07". The clock a person glances at to decide whether to worry. */
function clock(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = Math.floor(seconds % 60);
  return `${minutes}:${rest.toString().padStart(2, "0")}`;
}

/** The mark on the left of a row: done, working, or still to come. */
function Mark({ state }: { state: "done" | "here" | "waiting" }) {
  if (state === "done") {
    return (
      <span className="bg-success/15 text-success flex size-6 shrink-0 items-center justify-center rounded-full">
        <CheckIcon className="size-3.5" aria-hidden="true" />
      </span>
    );
  }
  if (state === "here") {
    return (
      <span className="bg-primary/15 text-primary flex size-6 shrink-0 items-center justify-center rounded-full">
        <Spinner className="size-3.5" />
      </span>
    );
  }
  return (
    <span className="border-border flex size-6 shrink-0 items-center justify-center rounded-full border border-dashed">
      <span className="bg-border size-1.5 rounded-full" aria-hidden="true" />
    </span>
  );
}

export function Provisioning({
  firstName,
  onDone,
}: {
  /** Who it is talking to. It uses the name it was just given theirs. */
  firstName: string;
  onDone: () => void;
}) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const started = Date.now();
    const timer = setInterval(() => {
      setElapsed((Date.now() - started) / 1000 / DRAFT_PACE);
    }, TICK);
    return () => clearInterval(timer);
  }, []);

  const through = Math.min(1, elapsed / TOTAL);
  const finished = elapsed >= TOTAL;

  // The step the clock has reached, and how far into it.
  let before = 0;
  let at = STAGES.length;
  for (const [index, stage] of STAGES.entries()) {
    if (elapsed < before + stage.seconds) {
      at = index;
      break;
    }
    before += stage.seconds;
  }
  // `at < STAGES.length` proves the read and narrows nothing, so the stage is
  // read out and its absence answers the same way as a finished run.
  const stageNow = STAGES[at];
  const into = stageNow ? (elapsed - before) / stageNow.seconds : 1;

  useEffect(() => {
    if (finished) onDone();
  }, [finished, onDone]);

  return (
    <Card className="w-full max-w-lg gap-0 overflow-hidden p-0 shadow-sm">
      <CardContent className="flex flex-col gap-7 px-6 py-9 sm:px-10">
        <div className="flex items-center gap-3">
          <AssistantAvatar variant="face" busy className="size-16 shrink-0" />
          <div className="bg-muted/40 border-border/60 relative min-h-16 flex-1 rounded-xl border px-4 py-3">
            <span
              className="bg-muted/40 border-border/60 absolute top-1/2 -left-1.5 size-3 -translate-y-1/2 rotate-45 border-b border-l"
              aria-hidden="true"
            />
            <Typed
              text={`I'm just setting things up now ${firstName}. This will only take a moment.`}
            />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <div
            className="bg-border h-1.5 overflow-hidden rounded-full"
            role="progressbar"
            aria-valuenow={Math.round(through * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Setting up"
          >
            <div
              className="bg-primary h-full rounded-full transition-[width] duration-200 ease-linear"
              style={{ width: `${through * 100}%` }}
            />
          </div>
          <div className="text-muted-foreground flex items-center justify-between text-xs tabular-nums">
            <span>{Math.round(through * 100)}%</span>
            <span>
              {clock(Math.min(elapsed, TOTAL))} of about {clock(TOTAL)}
            </span>
          </div>
        </div>

        <ol className="flex flex-col">
          {STAGES.map((stage, index) => {
            const state =
              index < at ? "done" : index === at ? "here" : "waiting";
            const last = index === STAGES.length - 1;
            return (
              <li key={stage.id} className="flex gap-3">
                {/* The mark and the line under it, which makes the list read
                    as one run rather than six unrelated rows. */}
                <div className="flex flex-col items-center">
                  <Mark state={state} />
                  {!last && (
                    <span
                      className={cn(
                        "w-px flex-1 transition-colors",
                        index < at ? "bg-success/40" : "bg-border"
                      )}
                      aria-hidden="true"
                    />
                  )}
                </div>

                <div
                  className={cn(
                    "flex min-h-12 flex-col gap-0.5 pb-3 transition-opacity",
                    state === "waiting" && "opacity-45"
                  )}
                >
                  <span
                    className={cn(
                      "text-sm",
                      state === "here" ? "font-medium" : "text-foreground"
                    )}
                  >
                    {stage.label}
                  </span>
                  {/* Only the running step says what it is doing. Six lines
                      of detail at once is a log, and nobody reads a log. */}
                  {state === "here" && (
                    <span className="text-muted-foreground text-xs">
                      {stage.detail(into)}
                    </span>
                  )}
                  {state === "done" && (
                    <span className="text-muted-foreground text-xs">Done</span>
                  )}
                </div>
              </li>
            );
          })}
        </ol>

        <p className="text-muted-foreground border-border/60 border-t pt-4 text-xs text-pretty">
          Keep this open until it finishes. The work runs in this browser for
          now, so closing the tab loses it and the questions start again.
        </p>
      </CardContent>
    </Card>
  );
}
