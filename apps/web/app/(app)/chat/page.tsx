"use client";

// A new chat. KPA-41.

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";

import { Conversation, answerFor } from "@/components/chat/conversation";
import { Skeleton } from "@/components/ui/skeleton";
import { useForcedStatus } from "@/lib/forced-state";

function NewChat() {
  const status = useForcedStatus();
  const handed = useSearchParams().get("q")?.trim();

  return (
    <Conversation
      // The key restarts the view when the palette hands over a new question,
      // so a second Cmd+K does not append to the answer from the first.
      key={handed ?? "new"}
      initialAnswers={handed ? [answerFor(handed, 0)] : []}
      status={status}
    />
  );
}

export default function ChatPage() {
  return (
    <Suspense fallback={<Skeleton className="mx-auto h-96 w-full max-w-3xl" />}>
      <NewChat />
    </Suspense>
  );
}
