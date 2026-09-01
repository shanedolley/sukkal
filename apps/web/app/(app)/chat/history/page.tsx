"use client";

// Every chat, most recent first.
//
// Each row carries how full its window was when it stopped, because that is
// usually why it stopped, and because reopening a chat already at 79 per cent
// is worth knowing before you type into it.

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { MessagesSquareIcon, PlusIcon, SearchIcon, XIcon } from "lucide-react";

import { ContextMeter } from "@/components/chat/context-meter";
import { QueuePage } from "@/components/queue-page";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Skeleton } from "@/components/ui/skeleton";
import { conversationTokens } from "@/lib/context-window";
import { CONVERSATIONS } from "@/lib/fixtures";
import { formatStamp } from "@/lib/format";
import { useForcedStatus } from "@/lib/forced-state";
import type { Conversation } from "@/lib/types";

/**
 * Search the title and everything said in the chat.
 *
 * Titles alone would not find the chat you remember by a phrase from the
 * answer, which is how anyone actually remembers a conversation.
 */
function matches(conversation: Conversation, query: string) {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const haystack = [
    conversation.title,
    ...conversation.answers.flatMap((answer) => [
      answer.question,
      answer.answer,
    ]),
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(needle);
}

function History() {
  const status = useForcedStatus();
  const [query, setQuery] = useState("");

  const conversations = useMemo(
    () =>
      [...CONVERSATIONS].sort(
        (a, b) => new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime()
      ),
    []
  );

  const shown = conversations.filter((c) => matches(c, query));
  const searching = query.trim().length > 0;

  return (
    <QueuePage
      title="Chat history"
      lede="Every question you have asked, and the answers with their citations. Reopening one continues it rather than starting again."
      // The unfiltered count, so a search that finds nothing shows the
      // no-match message below rather than the never-asked-anything one.
      count={conversations.length}
      status={status}
      emptyTitle="No chats yet"
      emptyDescription="Ask a question and it will be kept here."
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <InputGroup className="w-full sm:max-w-sm">
            <InputGroupAddon>
              <SearchIcon className="size-4" aria-hidden="true" />
            </InputGroupAddon>
            <InputGroupInput
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label="Search your chats"
              placeholder="Search titles and answers..."
            />
            {searching && (
              <InputGroupAddon align="inline-end">
                <InputGroupButton
                  type="button"
                  size="icon-xs"
                  aria-label="Clear the search"
                  onClick={() => setQuery("")}
                >
                  <XIcon aria-hidden="true" />
                </InputGroupButton>
              </InputGroupAddon>
            )}
          </InputGroup>

          <Button
            render={<Link href="/chat" />}
            nativeButton={false}
            variant="outline"
          >
            <PlusIcon className="size-4" aria-hidden="true" />
            New chat
          </Button>
        </div>

        {searching && (
          <p className="text-muted-foreground text-xs" aria-live="polite">
            {shown.length} of {conversations.length} chats
          </p>
        )}

        {shown.length === 0 ? (
          <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed p-6">
            <p className="text-sm font-medium">
              No chat mentions &ldquo;{query.trim()}&rdquo;.
            </p>
            <p className="text-muted-foreground text-xs">
              The search reads titles and everything said in the chat. Ask it as
              a new question instead, and the answer will cite its sources.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                render={
                  <Link href={`/chat?q=${encodeURIComponent(query.trim())}`} />
                }
                nativeButton={false}
                size="sm"
              >
                Ask it in a new chat
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setQuery("")}>
                Clear the search
              </Button>
            </div>
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {shown.map((conversation) => (
              <li
                key={conversation.id}
                className="border-border/70 hover:border-border hover:bg-muted/30 relative flex flex-col gap-3 rounded-lg border p-4 transition-colors"
              >
                <div className="flex min-w-0 flex-col gap-1">
                  <Link
                    href={`/chat/${conversation.id}`}
                    className="focus-visible:ring-ring inline-flex items-center gap-2 rounded-sm text-sm font-medium after:absolute after:inset-0 after:content-[''] focus-visible:ring-2 focus-visible:outline-none"
                  >
                    <MessagesSquareIcon
                      className="text-muted-foreground size-3.5 shrink-0"
                      aria-hidden="true"
                    />
                    {conversation.title}
                  </Link>
                  <p className="text-muted-foreground text-xs">
                    {conversation.answers.length}{" "}
                    {conversation.answers.length === 1 ? "answer" : "answers"}
                    {" · "}
                    {formatStamp(conversation.lastAt)}
                  </p>
                </div>

                <ContextMeter tokens={conversationTokens(conversation)} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </QueuePage>
  );
}

export default function ChatHistoryPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <History />
    </Suspense>
  );
}
