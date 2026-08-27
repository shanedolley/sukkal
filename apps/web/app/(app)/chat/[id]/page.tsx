"use client";

// One chat, reopened.
//
// /chat/history resolves before this route, because Next matches a static
// segment ahead of a dynamic one, so "history" is never read as an id.

import { Suspense, use } from "react";
import { notFound } from "next/navigation";

import { Conversation } from "@/components/chat/conversation";
import { Skeleton } from "@/components/ui/skeleton";
import { findConversation } from "@/lib/fixtures";
import { useForcedStatus } from "@/lib/forced-state";

function SavedChat({ id }: { id: string }) {
  const status = useForcedStatus();
  const conversation = findConversation(id);
  if (!conversation) notFound();

  return (
    <Conversation
      title={conversation.title}
      initialAnswers={conversation.answers}
      carriedTokens={conversation.carriedTokens}
      status={status}
    />
  );
}

export default function ChatByIdPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return (
    <Suspense fallback={<Skeleton className="mx-auto h-96 w-full max-w-3xl" />}>
      <SavedChat id={id} />
    </Suspense>
  );
}
