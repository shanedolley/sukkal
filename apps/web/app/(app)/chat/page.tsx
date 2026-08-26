"use client";

// KPA-41. One question, searched across everything, answered with citations
// that open.
//
// The crossing flag is the piece that matters. The brief keeps Collibra and
// Koinon apart as a guideline: nothing blocks an answer that draws on both,
// but the answer has to say so.

import { Suspense, useState } from "react";
import {
  ArrowUpIcon,
  InfoIcon,
  QuoteIcon,
  SparklesIcon,
  TriangleAlertIcon,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/reui/alert";
import { useSourceDrawer } from "@/components/source-drawer";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyTitle } from "@/components/ui/empty";
import { Textarea } from "@/components/ui/textarea";
import { CHAT_ANSWERS } from "@/lib/fixtures";
import { useForcedStatus } from "@/lib/forced-state";
import { PageError, PageLoading } from "@/components/page-status";
import { Skeleton } from "@/components/ui/skeleton";
import { SPACE_LABELS, type ChatAnswer } from "@/lib/types";

const SUGGESTIONS = CHAT_ANSWERS.map((a) => a.question);

function CrossingFlag({ answer }: { answer: ChatAnswer }) {
  const names = answer.spaces.map((s) => SPACE_LABELS[s]).join(" and ");
  return (
    <Alert variant="warning">
      <TriangleAlertIcon aria-hidden="true" />
      <AlertTitle>This answer draws on {names}.</AlertTitle>
      <AlertDescription>
        Retrieval filters by space by default. A crossing answer is flagged,
        never blocked.
      </AlertDescription>
    </Alert>
  );
}

function Answer({ answer }: { answer: ChatAnswer }) {
  const { open } = useSourceDrawer();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <p className="bg-muted max-w-[80%] rounded-2xl rounded-br-sm px-4 py-2.5 text-sm">
          {answer.question}
        </p>
      </div>

      <Card>
        <CardContent className="flex flex-col gap-4">
          <div className="text-muted-foreground flex items-center gap-2 text-xs">
            <SparklesIcon className="size-3.5" aria-hidden="true" />
            Answered from {answer.citations.length} sources
          </div>

          <p className="text-sm leading-relaxed">{answer.answer}</p>

          {answer.spaces.length > 1 && <CrossingFlag answer={answer} />}

          <div className="flex flex-col gap-2 border-t pt-3">
            <p className="text-muted-foreground text-xs font-medium">Citations</p>
            <ul className="flex flex-wrap gap-2">
              {answer.citations.map((citation, index) => (
                <li key={`${citation.sourceId}-${citation.chunkId}-${index}`}>
                  <button
                    type="button"
                    onClick={() =>
                      open({
                        sourceId: citation.sourceId,
                        chunkId: citation.chunkId,
                      })
                    }
                    className="border-border bg-background hover:bg-muted focus-visible:ring-ring inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors focus-visible:ring-2 focus-visible:outline-none"
                  >
                    <QuoteIcon className="size-3 shrink-0" aria-hidden="true" />
                    {citation.label}
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <p className="text-muted-foreground flex items-start gap-1.5 text-xs">
            <InfoIcon className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
            This answer is filed as a candidate fact, so the same analysis is
            not paid for twice.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function Chat() {
  const status = useForcedStatus();
  const [asked, setAsked] = useState<ChatAnswer[]>([]);
  const [question, setQuestion] = useState("");

  // The prototype answers from fixtures. An unmatched question returns the
  // nearest fixture, which is enough to review the layout.
  function ask(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    const match =
      CHAT_ANSWERS.find(
        (a) => a.question.toLowerCase() === trimmed.toLowerCase()
      ) ?? CHAT_ANSWERS[asked.length % CHAT_ANSWERS.length];
    setAsked((current) => [...current, { ...match, question: trimmed }]);
    setQuestion("");
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6">
      <div className="flex flex-1 flex-col gap-6">
        {status === "loading" && <PageLoading label="your answer" rows={3} />}
        {status === "error" && <PageError what="This answer" />}
        {status !== "loading" && status !== "error" && asked.length === 0 ? (
          <Empty className="flex-1 border-none">
            <EmptyTitle className="text-base">Ask about anything</EmptyTitle>
            <EmptyDescription>
              Three mailboxes, every transcript and the whole fact graph, in one
              question.
            </EmptyDescription>
            <ul className="mt-4 flex flex-col items-center gap-2">
              {SUGGESTIONS.map((suggestion) => (
                <li key={suggestion}>
                  <button
                    type="button"
                    onClick={() => ask(suggestion)}
                    className="border-border hover:bg-muted focus-visible:ring-ring rounded-full border px-3 py-1.5 text-xs transition-colors focus-visible:ring-2 focus-visible:outline-none"
                  >
                    {suggestion}
                  </button>
                </li>
              ))}
            </ul>
          </Empty>
        ) : (
          status === "ready" &&
          asked.map((answer, index) => (
            <Answer key={`${answer.id}-${index}`} answer={answer} />
          ))
        )}
      </div>

      <form
        className="bg-background sticky bottom-0 flex flex-col gap-2 pb-4"
        onSubmit={(event) => {
          event.preventDefault();
          ask(question);
        }}
      >
        <div className="border-input focus-within:border-ring focus-within:ring-ring/50 flex items-end gap-2 rounded-xl border p-2 transition-[color,box-shadow] focus-within:ring-[3px]">
          <Textarea
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                ask(question);
              }
            }}
            rows={1}
            aria-label="Your question"
            placeholder="What did BHP agree about lineage retention?"
            className="max-h-40 min-h-9 resize-none border-0 shadow-none focus-visible:ring-0"
          />
          <Button
            type="submit"
            size="icon"
            disabled={question.trim().length === 0}
            aria-label="Ask"
          >
            <ArrowUpIcon className="size-4" aria-hidden="true" />
          </Button>
        </div>
        <p className="text-muted-foreground text-center text-xs">
          Answers cite their sources. Every citation opens the passage it came
          from.
        </p>
      </form>
    </div>
  );
}

export default function ChatPage() {
  return (
    <Suspense fallback={<Skeleton className="mx-auto h-96 w-full max-w-3xl" />}>
      <Chat />
    </Suspense>
  );
}
