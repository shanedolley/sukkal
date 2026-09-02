"use client";

// Connections. Every account the assistant reaches, and one card that adds
// another.
//
// The list is on the server, and so is the key each account is reached with,
// sealed under the connection's own id. KPA-127 moved both there. What this
// screen records is which accounts exist, what each one covers, and whether a
// key is stored against it. Using that key is the worker's job.

import { ConnectionsGrid } from "@/components/connections/connections";

export default function ConnectionsPage() {
  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight">Connections</h1>
        <p className="text-muted-foreground text-sm">
          One card per account. A provider takes as many accounts as you hold
          on it, so the BHP Microsoft account and the Sydney Water one sit side
          by side.
        </p>
      </header>

      <ConnectionsGrid />

      <p className="text-muted-foreground text-xs leading-relaxed">
        A key typed here is sent to the server and sealed there. No screen
        reads one back, and this browser keeps no copy. The worker is what
        reaches the provider with it, and it does not run yet, so a card says
        whether a key is stored rather than whether the account works.
      </p>
    </div>
  );
}
