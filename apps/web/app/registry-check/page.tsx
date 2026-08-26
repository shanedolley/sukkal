"use client";

// Proves both registries resolve and render. KPA-45.
// Delete this route once the dashboard renders the real components.

import { AreaChart, Area } from "@/components/charts/area-chart";
import { Badge } from "@/components/reui/badge";

// The five states a fact holds, from the brief's "A fact's life".
const FACT_STATES = [
  { label: "Candidate", variant: "secondary" },
  { label: "Proposed", variant: "info" },
  { label: "Verified", variant: "success" },
  { label: "Stale", variant: "warning" },
  { label: "Retired", variant: "outline" },
] as const;

// Review queue depth across one week. Placeholder until KPA-48 writes the fixtures.
const QUEUE = [
  { date: new Date("2026-08-20"), proposed: 3 },
  { date: new Date("2026-08-21"), proposed: 6 },
  { date: new Date("2026-08-22"), proposed: 5 },
  { date: new Date("2026-08-23"), proposed: 9 },
  { date: new Date("2026-08-24"), proposed: 7 },
  { date: new Date("2026-08-25"), proposed: 11 },
  { date: new Date("2026-08-26"), proposed: 4 },
];

export default function RegistryCheck() {
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-10 p-10">
      <section className="flex flex-col gap-3">
        <h1 className="text-2xl font-semibold">Registry check</h1>
        <p className="text-muted-foreground text-sm">
          ReUI supplies the badges. Bklit supplies the chart.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium">ReUI Badge: the five fact states</h2>
        <div className="flex flex-wrap gap-2">
          {FACT_STATES.map((state) => (
            <Badge key={state.label} variant={state.variant}>
              {state.label}
            </Badge>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium">Bklit AreaChart: review queue depth</h2>
        <div className="border-border rounded-lg border p-4">
          <AreaChart data={QUEUE} xDataKey="date" aspectRatio="3 / 1">
            <Area dataKey="proposed" />
          </AreaChart>
        </div>
      </section>
    </main>
  );
}
