# Building dashboards in Sukkal

A post-implementation briefing. Read this before you build a dashboard, a
board view, or any screen that reports on data. It states the operating model,
the path a screen takes through the code, and the parts you can reuse.

The project brief in `docs/project-brief.md` says what the assistant is for.
This document says how its screens are put together.

---

## 1. The operating model

Six rules govern every screen. Break one and the screen disagrees with the
rest of the application.

### 1.1 No backend answers yet

Every screen reads fixtures from `apps/web/lib/fixtures.ts`. No worker, no
database, no external service. Production replaces that one file and keeps the
shapes in `apps/web/lib/types.ts`.

Write your dashboard against the types, never against the fixture rows. A
screen that reads `ISSUES[0]` breaks the day the data arrives.

### 1.2 Four states, never one

Every screen renders four states: ready, loading, error, and empty. A screen
that only renders ready is unfinished.

Nothing is genuinely slow or broken yet, so the states need a way to be seen.
Add `?state=loading`, `?state=error`, or `?state=empty` to any URL and the
screen forces that state. `apps/web/lib/forced-state.ts` holds the hook.

```tsx
const status = useForcedStatus(); // "ready" | "loading" | "error" | "empty"
```

Read the state with that hook. Then hand it to a frame that already draws all
four. Section 3.1 lists the frames.

Warning: `useForcedStatus` calls `useSearchParams`. Wrap the component in
`<Suspense>`, or the build fails on that route.

### 1.3 The space filter narrows everything

Three spaces exist: Collibra, Koinon, and Personal. The workspace switcher at
the top of the sidebar sets one, or sets "All spaces".

Every count and every row obeys it:

```tsx
const { space } = useSpace();
const rows = inSpace(ISSUES, space);
```

A dashboard that ignores the filter shows a number the sidebar contradicts.
Any row carrying a `space` field passes through `inSpace`.

### 1.4 Colour comes from tokens

Never write a hex value. The menu accent and the chart palette are user
settings, and both repaint without a rebuild.

| Purpose | Token |
|---|---|
| Series 1 to 5 | `--chart-1` to `--chart-5` |
| The single-series default | `--chart-line-primary`, an alias of `--chart-1` |
| Accent, borders, text | `primary`, `border`, `muted-foreground`, and the rest |
| Meaning | `info`, `success`, `warning`, `destructive` |

`apps/web/lib/appearance.ts` resolves the palettes. Preferences at `/settings`
change them.

### 1.5 A number needs its source

The brief bans an assertion with no address. A count that cannot be opened is
one. Where a row comes from a source, a meeting, or an audit entry, open it in
the detail panel rather than restating it.

### 1.6 Nothing invents data

The fixtures are checked. Add rows and the checks hold you to the shapes.
Add logic and you add a check beside it. Section 5 lists what runs.

---

## 2. How a screen works

A screen passes through six files. The sprint list is the worked example, and
every one of its files is listed here.

### 2.1 The route

Routes live under `apps/web/app/(app)/`. The group folder `(app)` gives the
screen the sidebar, the breadcrumb, and every provider.

One dynamic route serves a family of views. `/sprints/[scope]` serves the
current, future, and all-sprints views, because they differ by which sprints
they select and by nothing else.

### 2.2 The page

A page is a client component. It reads the space, reads the state, selects its
rows, and hands them to a frame.

```tsx
"use client";

function SprintView() {
  const { scope } = useParams<{ scope: string }>();
  const { space } = useSpace();
  const status = useForcedStatus();
  const issues = inSpace(ISSUES, space).filter(/* … */);

  return (
    <QueuePage title={…} lede={…} count={issues.length} status={status} …>
      <IssueList issues={issues} today={TODAY} />
    </QueuePage>
  );
}

export default function SprintPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <SprintView />
    </Suspense>
  );
}
```

### 2.3 The nav entry

`apps/web/components/blocks/app-shell-1/components/data.tsx` holds the nav
content. `NavGroup`, exported from `nav-main.tsx`, draws one labelled group.
It handles the collapsed rail, the active row, and the submenu already.

Three groups exist: Assistant, Project management, and Resources. Add a fourth
by calling `NavGroup` and dropping it into `app-sidebar.tsx`.

### 2.4 The breadcrumb

`apps/web/app/(app)/layout.tsx` maps a path to its trail. A static path takes
a row in the `CRUMBS` map. A dynamic path takes a prefix test in `crumbFor`.

Forget this and the breadcrumb reads "Assistant" on a screen that is not one.

### 2.5 The data

Add the shapes to `lib/types.ts` and the rows to `lib/fixtures.ts`.

One trap: a module that a check script reads must import from `lib/types.ts`
with `import type`. `node --experimental-strip-types` cannot resolve an
extensionless import of a runtime value, so a constant crossing that boundary
belongs in the module that uses it.

### 2.6 The check

Non-trivial logic leaves one runnable check. See section 5.

---

## 3. What already exists

Reuse before you build. This is the whole inventory.

### 3.1 Page frames

| Part | File | Use |
|---|---|---|
| `QueuePage` | `components/queue-page.tsx` | A whole page: title, count badge, lede, and all four states |
| `Region` | `components/dashboard/region.tsx` | One card-shaped region with all four states |
| `PageLoading`, `PageError` | `components/page-status.tsx` | The busy and failed states alone |
| `Empty` | `components/ui/empty.tsx` | The empty state alone |

`QueuePage` and `Region` are the two you want. Both take `status` and draw
every state from it, so a new screen gets all four for one prop.

### 3.2 Summary tiles

`QueueCard` in `components/dashboard/queue-card.tsx` draws a queue as a big
number, a breakdown by engagement, and a link to the page behind it. `byEntity`
counts rows per engagement, heaviest first.

The breakdown is the point. "4" says there is work. "BHP Meridian 2, Maybank 1,
Sydney Water 1" says where the morning will go.

### 3.3 Lists

`IssueList` in `components/issues/issue-list.tsx` draws the Jira row: priority
glyph, key, status glyph, title, context pills, assignee, and date. It groups
on any field, to two levels, and the reader picks the fields.

`lib/issue-grouping.ts` holds the grouping alone. `groupIssues(rows, field,
sprintNames)` returns labelled groups in the right order. It is a pure
function, so a new list can group without touching the component.

`components/reui/data-grid/` holds the ReUI data grid, built on TanStack
Table. It brings sorting, filtering, pagination, column visibility, virtual
rows, and drag ordering. Reach for it when a screen needs a real table.
Nothing uses it yet, and it carries lint warnings of its own.

### 3.4 Charts

`components/charts/` holds a custom chart library on visx and motion. The
usable surface is small:

```tsx
import { Area, AreaChart } from "@/components/charts/area-chart";

<AreaChart data={rows} xDataKey="date" aspectRatio="4 / 1">
  <Area dataKey="proposed" />
</AreaChart>
```

`AreaChart` accepts `Area`, `PatternArea`, `Grid`, `XAxis`, and the tooltip
parts as children. It also takes `status="loading"` and a `loadingLabel`, so a
chart draws its own busy state.

Colour comes from the palette tokens, so a chart repaints when the setting
changes. Pass no colour and one series takes `--chart-line-primary`.

`components/settings/chart-preview.tsx` is the only working example. Read it
first; it is 55 lines.

`AreaChart` is the only chart component here. `Area` is flexible enough to
cover three shapes: an area by default, a plain line with `fillOpacity={0}`,
and scatter points with `showMarkers`. It also does dashed projections through
`dashFromIndex`, several series through several `Area` children, and two
y-scales through `yAxisId`.

Four things are absent. The library carries support code for `LineChart`,
`BarChart`, and `ComposedChart`, but none of the three components was copied
in. No `YAxis` component exists either, though the layout code names one. A
bar chart needs writing, and it is the shape a sprint dashboard most wants.

### 3.5 The detail panel

`useDetailPanel().open(target)` opens a row in a side sheet. Three targets
exist: a source, a fact, and a Needs-you row.

```tsx
const { open } = useDetailPanel();
open({ kind: "fact", factId: fact.id });
```

Add a target by extending `DetailTarget` in `components/detail-panel.tsx`.

### 3.6 State that survives a reload

`createLocalStore(key, fallback, isValid)` in `lib/local-store.ts` keeps one
string in `localStorage` and reads it the way React wants it read. Four callers
already: the space filter, the appearance presets, and the two grouping
fields.

Use it for a display preference. Reading storage in an effect renders twice
and the linter refuses it.

`useIsClient()` from the same file gates anything that cannot be prerendered.

### 3.7 Dates

`lib/format.ts` holds every date the interface prints. The timezone is pinned
to Sydney on purpose: a bare date parses as UTC midnight, and an unpinned
render disagrees with itself between the server and the browser.

`formatDay`, `formatLongDay`, `formatFullDay`, `formatShortDay`, `formatTime`,
`formatStamp`, and `daysPast`. Add a format here rather than inline.

### 3.8 Primitives

`components/ui/` holds the shadcn set: card, tabs, dialog, popover, select,
sheet, tooltip, command, skeleton, breadcrumb, sidebar, and the rest. It holds
no table, so a table means the ReUI data grid or your own markup.
`components/reui/` holds ReUI's badge, alert, and data grid.

Search these before writing a component. Most of what a dashboard needs is
already here.

---

## 4. A worked shape

A dashboard that reports on sprint health would need nothing new:

1. A route at `app/(app)/sprints/health/page.tsx`.
2. A `NavGroup` child pointing at it, plus a `CRUMBS` row.
3. Three `QueueCard` tiles across the top: issues in flight, issues overdue,
   issues finished this sprint. Each links to the list that holds them.
4. One `Region` holding an `AreaChart` of the burn-down, drawn from a new
   `SPRINT_BURNDOWN` fixture.
5. One `Region` holding an `IssueList` of the overdue rows, grouped by
   assignee.
6. `inSpace` on every selection, and `useForcedStatus` handed to every frame.

The only new code is the fixture, the selection, and the layout.

---

## 5. Before you call it done

Run all four, and read the output:

```
npm run check   # fixtures, review rules, colour, grouping
npm run lint    # new code must add no error
npm run build   # proves the route compiles
```

`npm run check` runs the scripts in `apps/web/scripts/`. Each owns one
concern. `check-fixtures.ts` proves the data resolves and every space carries
a row. `check-grouping.ts` proves every row lands in a group and every subgroup
sums to its parent.

Add a check when you add logic that would break silently. A count that
disagrees with the rows under it raises no build error, and no reader trusts
the screen again once they find one.

Then open the screen in a browser and force each of the four states.

Known: `hooks/use-mobile.ts`, `components/blocks/…/nav-user.tsx`, and the ReUI
data grid carry lint errors that predate this work. New code must add none.

---

## 6. What is missing

Name these rather than working around them in silence.

1. **No Jira connection.** The sprint views read fixtures. The credentials
   exist as `KOINON_JIRA_SITE`, `KOINON_JIRA_EMAIL`, and `KOINON_JIRA_TOKEN`
   in `~/.zshenv`, but no code calls the API.
2. **No bar chart.** `AreaChart` is the only chart component, and the sprint
   dashboards will want bars.
3. **Issue rows open nothing.** A row in `IssueList` is not a link and does
   not open the detail panel.
4. **Projects added in the sidebar hold in memory only.** A reload drops them.
   The `ponytail:` comment in `nav-projects.tsx` marks it.
5. **The data grid is unproven.** It is installed and nothing renders it.
