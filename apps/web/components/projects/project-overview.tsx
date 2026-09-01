"use client";

// What a project is, above what is on it.
//
// The description and the dates come from outside Jira, so a project can hold
// none of them. Each part says so in its own words rather than leaving a gap
// the reader has to interpret.

import { Area, AreaChart } from "@/components/charts/area-chart";
import { Grid } from "@/components/charts/grid";
import { Line } from "@/components/charts/line-chart";
import { ChartTooltip } from "@/components/charts/tooltip";
import { XAxis } from "@/components/charts/x-axis";
import { ProjectHours } from "@/components/projects/project-hours";
import { PROJECT_ACTIVITY, PROJECT_OVERVIEW } from "@/lib/fixtures";
import { formatFullDay } from "@/lib/format";
import { useProjectSetting } from "@/lib/project-settings";

/** Closed work is done with, so it sits behind the open line in grey. */
const CLOSED = "var(--chart-foreground-muted)";

/** A line of the chart, named and coloured the way the chart draws it. */
function Key({ colour, label }: { colour: string; label: string }) {
  return (
    <span className="text-muted-foreground flex items-center gap-1.5 text-xs">
      <span
        aria-hidden="true"
        className="h-0.5 w-4 rounded-full"
        style={{ background: colour }}
      />
      {label}
    </span>
  );
}

/** One fact about the project, or a plain note that nothing holds it. */
function Fact({ term, value }: { term: string; value: string | null }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-muted-foreground text-xs">{term}</dt>
      <dd className={value ? "text-sm" : "text-muted-foreground text-sm"}>
        {value ?? "Not set"}
      </dd>
    </div>
  );
}

export function ProjectOverview({ projectKey }: { projectKey: string }) {
  const overview = PROJECT_OVERVIEW[projectKey];
  const activity = PROJECT_ACTIVITY[projectKey] ?? [];
  // The dates come from the settings tab, which starts them off from the
  // fixture and lets a person write over them.
  const { start, end } = useProjectSetting(projectKey);

  // The chart reads a Date, and the fixtures store the day as text.
  const series = activity.map((day) => ({ ...day, date: new Date(day.date) }));

  return (
    <div className="flex flex-col gap-6">
      {/* About takes the room it needs and the hours card sits beside it. The
          breakdown the card opens spans both, so it gets the full width. */}
      <div className="grid items-start gap-6 sm:grid-cols-[minmax(0,1fr)_auto]">
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium">About</h2>
          {overview?.description ? (
            <p className="max-w-2xl text-sm">{overview.description}</p>
          ) : (
            <p className="text-muted-foreground max-w-2xl text-sm">
              Nobody has written a description for this project yet.
            </p>
          )}
          <dl className="flex flex-wrap gap-x-10 gap-y-4">
            <Fact
              term="Start"
              value={start ? formatFullDay(start) : null}
            />
            <Fact
              term="End"
              value={end ? formatFullDay(end) : null}
            />
          </dl>
        </section>

        <ProjectHours projectKey={projectKey} />
      </div>

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <h2 className="text-sm font-medium">Issues over time</h2>
          <div className="flex items-center gap-4">
            <Key colour="var(--chart-line-primary)" label="Open" />
            <Key colour={CLOSED} label="Closed" />
          </div>
        </div>

        {series.length > 0 ? (
          <div className="border-border/70 rounded-lg border px-3 pt-8 pb-3">
            {/* AreaChart, not LineChart: it reads every series with a data
                key into the shared y-domain, so the taller closed area cannot
                run off the top of a scale drawn from the open line alone. */}
            <AreaChart data={series} xDataKey="date" aspectRatio="3 / 1">
              <Grid />
              <XAxis />
              {/* Closed sits behind, because the line has to stay readable. */}
              {/* The gradient runs to nothing at the bottom by default, which
                  leaves a thin area reading as a bare line. A floor under it
                  keeps the shape visible however shallow it gets. */}
              <Area
                dataKey="closed"
                fill={CLOSED}
                stroke={CLOSED}
                fillOpacity={0.4}
                gradientToOpacity={0.14}
              />
              {/* Heavier than the default 2.5, to hold its own over the fill. */}
              <Line dataKey="open" strokeWidth={3.5} />
              {/* No y-axis is drawn, so the tooltip is where a count is read. */}
              <ChartTooltip
                rows={(point) => [
                  {
                    color: "var(--chart-line-primary)",
                    label: "Open",
                    value: Number(point.open),
                  },
                  {
                    color: CLOSED,
                    label: "Closed",
                    value: Number(point.closed),
                  },
                ]}
              />
            </AreaChart>
          </div>
        ) : (
          <p className="text-muted-foreground max-w-2xl text-sm">
            No history is recorded for this project yet.
          </p>
        )}
      </section>
    </div>
  );
}
