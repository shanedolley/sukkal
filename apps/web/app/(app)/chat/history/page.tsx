"use client";

// Every chat, most recent first.
//
// Each row carries how full its window was when it stopped, because that is
// usually why it stopped, and because reopening a chat that is already at
// 79 per cent is worth knowing before you type into it.

import { Suspense } from "react";
import Link from "next/link";
import { MessagesSquareIcon, PlusIcon } from "lucide-react";

import { ContextMeter } from "@/components/chat/context-meter";
import { QueuePage } from "@/components/queue-page";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { conversationTokens } from "@/lib/context-window";
import { CONVERSATIONS } from "@/lib/fixtures";
import { formatStamp } from "@/lib/format";
import { useForcedStatus } from "@/lib/forced-state";

function History() {
  const status = useForcedStatus();
  const conversations = [...CONVERSATIONS].sort(
    (a, b) => new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime()
  );

  return (
    <QueuePage
      title="Chat history"
      lede="Every question you have asked, and the answers with their citations. Reopening one continues it rather than starting again."
      count={conversations.length}
      status={status}
      emptyTitle="No chats yet"
      emptyDescription="Ask a question and it will be kept here."
    >
      <div className="flex flex-col gap-4">
        <Button
          render={<Link href="/chat" />}
          nativeButton={false}
          variant="outline"
          className="w-fit"
        >
          <PlusIcon className="size-4" aria-hidden="true" />
          New chat
        </Button>

        <ul className="flex flex-col gap-3">
          {conversations.map((conversation) => (
            <li
              key={conversation.id}
              className="border-border/70 hover:border-border hover:bg-muted/30 relative flex flex-col gap-3 rounded-lg border p-4 transition-colors"
            >
              <div className="flex items-start justify-between gap-3">
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
              </div>

              <ContextMeter tokens={conversationTokens(conversation)} />
            </li>
          ))}
        </ul>
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
