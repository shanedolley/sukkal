"use client";

// A chart, so the palette setting is something you can see rather than
// something you have to imagine.
//
// It draws the review queue over the past week, which is a real question the
// briefing does not currently answer. The chart reads --chart-1 through the
// --chart-line-primary alias, so it repaints the moment the palette changes.

import { Area, AreaChart } from "@/components/charts/area-chart";
import { TODAY } from "@/lib/fixtures";

/** The last seven days, ending today. */
const QUEUE_DEPTH = Array.from({ length: 7 }, (_, index) => {
  const date = new Date(TODAY);
  date.setDate(date.getDate() - (6 - index));
  return { date, proposed: [3, 6, 5, 9, 7, 11, 4][index] };
});

/** Every colour in the palette, because the chart below draws one series. */
function Swatches() {
  return (
    <div className="flex items-center gap-2">
      <div className="flex overflow-hidden rounded-full">
        {[1, 2, 3, 4, 5].map((slot) => (
          <span
            key={slot}
            aria-hidden="true"
            className="size-5"
            style={{ background: `var(--chart-${slot})` }}
          />
        ))}
      </div>
      <span className="text-muted-foreground text-xs">
        Five series colours
      </span>
    </div>
  );
}

export function ChartPreview() {
  return (
    <div className="flex flex-col gap-3">
      <Swatches />
      <div className="border-border/70 rounded-lg border p-3">
        <AreaChart data={QUEUE_DEPTH} xDataKey="date" aspectRatio="4 / 1">
          <Area dataKey="proposed" />
        </AreaChart>
      </div>
      <p className="text-muted-foreground text-xs">
        Facts waiting on you, over the past week.
      </p>
    </div>
  );
}
