"use client";

// The backstop. Every region on the briefing draws its own failure, but a
// fault outside a region would otherwise reach Next's default screen, which
// tells the reader nothing about what happened to their work.

import { AlertTriangleIcon } from "lucide-react";

import { Button } from "@/components/ui/button";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main
      role="alert"
      className="mx-auto flex min-h-svh w-full max-w-lg flex-col items-start justify-center gap-4 p-6"
    >
      <AlertTriangleIcon className="text-destructive size-6" aria-hidden="true" />
      <h1 className="text-xl font-semibold tracking-tight">
        This screen stopped working.
      </h1>
      <p className="text-muted-foreground text-sm leading-relaxed">
        Nothing was sent, changed, or filed. Any review decision you had not yet
        made is still waiting for you.
      </p>
      {error.digest && (
        <p className="text-muted-foreground font-mono text-xs">
          Reference {error.digest}
        </p>
      )}
      <Button onClick={reset}>Try again</Button>
    </main>
  );
}
