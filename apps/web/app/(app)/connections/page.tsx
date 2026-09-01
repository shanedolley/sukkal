"use client";

// Connections. Every account the assistant reaches, and one card that adds
// another.
//
// The list is per browser, the same as Preferences, because nothing on the
// server holds it yet. What it records is which accounts exist and what each
// one covers. Authorising them is the worker's job.

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
        Nothing here reaches a provider yet. The list lives in this browser and
        names the accounts the worker will authorise, so no key or token is
        asked for on this screen.
      </p>
    </div>
  );
}
