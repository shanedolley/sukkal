// How the sprint list divides and narrows its rows.
//
// Grouping and filtering live together because they share `bucketsFor`, and
// they have to agree: a filter that bucketed an issue differently from the
// grouping would hide a row under a header that still counted it.
//
// Three rules govern the division, and they run in this order.
//
// The tree comes first. A sub-task hangs off its parent, so the parent picks
// the group and the child follows it there. Group by status and a Todo
// sub-task sits under its In Progress parent, because the pair reads as one
// piece of work and splitting them loses that. `nest` builds the tree, and
// `flat` is the same shape with nothing nested, so one pipeline serves both.
//
// Filtering comes second, on the flat list, before anything nests. Values
// inside one field widen the result, so Todo plus In Progress shows both.
// Fields narrow it, so Todo plus Priya shows only her Todo rows.
//
// Grouping comes last, and it reads the parent alone. One issue belongs to
// one group under every field except labels. An issue carries several labels,
// so grouping by labels puts the same row under each one. That is what Jira
// means by a label, and hiding it would under-report every count.

import type { Issue, IssuePriority, IssueStatus } from "./types";

export type GroupField =
  | "none"
  | "status"
  | "project"
  | "assignee"
  | "labels"
  | "sprint";

export const GROUP_FIELDS: GroupField[] = [
  "none",
  "status",
  "project",
  "assignee",
  "labels",
  "sprint",
];

export const GROUP_FIELD_LABELS: Record<GroupField, string> = {
  none: "None",
  status: "Status",
  project: "Project",
  assignee: "Assignee",
  labels: "Labels",
  sprint: "Sprint",
};

export function isGroupField(value: string): value is GroupField {
  return (GROUP_FIELDS as string[]).includes(value);
}

/**
 * One row and the rows that hang off it.
 *
 * One level only. A Jira sub-task carries no sub-tasks of its own, so a
 * deeper tree would model something the tracker cannot express.
 */
export interface IssueNode {
  issue: Issue;
  children: Issue[];
}

export interface IssueGroup {
  /** Unique within one field. Serves as the React key and the aria id. */
  key: string;
  label: string;
  /** Set only when the field is status, so the header draws its glyph. */
  status?: IssueStatus;
  nodes: IssueNode[];
  /** Every row the group shows, parents and children counted together. */
  count: number;
}

/** Rows one node puts on the screen: itself, plus what hangs off it. */
export const rowsIn = (nodes: IssueNode[]): number =>
  nodes.reduce((total, node) => total + 1 + node.children.length, 0);

/** Every issue standing alone. The list with the tree turned off. */
export function flat(issues: Issue[]): IssueNode[] {
  return issues.map((issue) => ({ issue, children: [] }));
}

/**
 * Hang each sub-task off its parent.
 *
 * A sub-task whose parent this list does not hold stands on its own instead.
 * The space filter and the sprint selection both cut rows out, and a child
 * that vanished with its parent would be a row nobody could find.
 */
export function nest(issues: Issue[]): IssueNode[] {
  const present = new Set(issues.map((issue) => issue.key));
  const children = new Map<string, Issue[]>();
  const roots: Issue[] = [];

  for (const issue of issues) {
    if (issue.parent && present.has(issue.parent)) {
      children.set(issue.parent, [
        ...(children.get(issue.parent) ?? []),
        issue,
      ]);
    } else {
      roots.push(issue);
    }
  }

  return roots.map((issue) => ({
    issue,
    children: children.get(issue.key) ?? [],
  }));
}

// The status labels sit here rather than in lib/types.ts, beside the order
// they are printed in. Keeping them there would make this module import a
// value from types.ts, and the check script cannot resolve one.
export const STATUS_LABELS: Record<IssueStatus, string> = {
  backlog: "Backlog",
  todo: "Todo",
  "in-progress": "In Progress",
  "in-review": "In Review",
  done: "Done",
  cancelled: "Cancelled",
};

/** Work in flight first, finished work last. */
/** Urgent first. The list reads down the scale, so an index is the rank. */
export const PRIORITY_ORDER: IssuePriority[] = [
  "urgent",
  "high",
  "medium",
  "low",
  "none",
];

export const STATUS_ORDER: IssueStatus[] = [
  "in-progress",
  "in-review",
  "todo",
  "backlog",
  "done",
  "cancelled",
];

/**
 * What the rows inside a group are put in order by.
 *
 * Each field has one sensible direction and no toggle, because a reader
 * asking for start dates wants the earliest first every time, and a reader
 * asking for priority wants the urgent one at the top. A direction switch
 * would be a second control answering a question nobody asks.
 */
export const ROW_SORTS = [
  "none",
  "priority",
  "status",
  "start",
  "due",
  "updated",
  "title",
] as const;

export type RowSort = (typeof ROW_SORTS)[number];

export const ROW_SORT_LABELS: Record<RowSort, string> = {
  none: "As they come",
  priority: "Priority",
  status: "Status",
  start: "Start date",
  due: "Due date",
  updated: "Last moved",
  title: "Title",
};

export function isRowSort(value: string): value is RowSort {
  return (ROW_SORTS as readonly string[]).includes(value);
}

/** An empty date sorts last, whichever way the field runs. */
const LAST = Number.MAX_SAFE_INTEGER;

function day(iso: string | null): number {
  return iso ? Date.parse(`${iso}T00:00:00Z`) : LAST;
}

/**
 * The values a sort field can hold, where it holds a countable few.
 *
 * These are the fields whose order somebody can arrange by hand. A date has
 * no such list: there is no arranging every day there has ever been.
 */
export function rowValues(by: RowSort): readonly string[] | null {
  if (by === "priority") return PRIORITY_ORDER;
  if (by === "status") return STATUS_ORDER;
  return null;
}

/** Below zero puts a before b. Ties hold the order they arrived in. */
function compare(
  a: Issue,
  b: Issue,
  by: RowSort,
  rank: readonly string[] | null,
): number {
  switch (by) {
    case "priority": {
      // Urgent first, unless somebody said otherwise.
      const order = rank ?? PRIORITY_ORDER;
      return order.indexOf(a.priority) - order.indexOf(b.priority);
    }
    case "status": {
      const order = rank ?? STATUS_ORDER;
      return order.indexOf(a.status) - order.indexOf(b.status);
    }
    case "start":
      return day(a.start) - day(b.start);
    case "due":
      return day(b.due) === day(a.due) ? 0 : day(a.due) - day(b.due);
    case "updated":
      // The other way round: what moved last is what a reader came to see.
      return day(b.updated) - day(a.updated);
    case "title":
      return a.title.localeCompare(b.title);
    default:
      return 0;
  }
}

/**
 * Put the nodes in order, parents only.
 *
 * A sub-task follows its parent wherever the parent lands, so sorting reads
 * the parent alone. Sorting children among themselves would scatter a pair
 * that reads as one piece of work.
 */
export function sortNodes(
  nodes: IssueNode[],
  by: RowSort,
  /** The values in the order somebody arranged them, when they did. */
  rank: readonly string[] | null = null,
): IssueNode[] {
  if (by === "none") return nodes;
  return [...nodes].sort((a, b) => compare(a.issue, b.issue, by, rank));
}

/** The row that names an absence sorts last, whatever it is called. */
const ABSENT = "￿";

export interface GroupKey {
  key: string;
  label: string;
  /** What the group sorts by. Absent values sort last. */
  sort: string;
}

/**
 * The buckets one issue falls into for a field. Labels returns more than one.
 *
 * Grouping and filtering both need this, and they must agree: a filter that
 * bucketed an issue differently would hide a row the grouping shows.
 */
export function bucketsFor(
  issue: Issue,
  field: GroupField,
  sprintNames: Record<string, string>
): GroupKey[] {
  switch (field) {
    case "status": {
      const rank = STATUS_ORDER.indexOf(issue.status);
      return [
        {
          key: issue.status,
          label: STATUS_LABELS[issue.status],
          sort: String(rank).padStart(2, "0"),
        },
      ];
    }
    case "project":
      return [{ key: issue.project, label: issue.project, sort: issue.project }];
    case "assignee":
      return [
        { key: issue.assignee, label: issue.assignee, sort: issue.assignee },
      ];
    case "sprint": {
      if (!issue.sprintId) {
        return [{ key: "no-sprint", label: "No sprint", sort: ABSENT }];
      }
      const name = sprintNames[issue.sprintId] ?? issue.sprintId;
      return [{ key: issue.sprintId, label: name, sort: name }];
    }
    case "labels": {
      if (issue.labels.length === 0) {
        return [{ key: "no-label", label: "No label", sort: ABSENT }];
      }
      return issue.labels.map((label) => ({ key: label, label, sort: label }));
    }
    case "none":
      return [{ key: "all", label: "All issues", sort: "" }];
  }
}

/**
 * Divide the nodes by one field, reading the parent of each node and never
 * its children. The order inside a group is the order the nodes arrived in,
 * so the caller sorts once and the grouping keeps that decision.
 */
export function groupIssues(
  nodes: IssueNode[],
  field: GroupField,
  sprintNames: Record<string, string> = {}
): IssueGroup[] {
  const groups = new Map<string, IssueGroup & { sort: string }>();

  for (const node of nodes) {
    const { issue } = node;
    for (const { key, label, sort } of bucketsFor(issue, field, sprintNames)) {
      const existing = groups.get(key);
      if (existing) {
        existing.nodes.push(node);
        existing.count += 1 + node.children.length;
        continue;
      }
      groups.set(key, {
        key,
        label,
        sort,
        status: field === "status" ? issue.status : undefined,
        nodes: [node],
        count: 1 + node.children.length,
      });
    }
  }

  return [...groups.values()]
    .sort((a, b) => a.sort.localeCompare(b.sort))
    .map((group) => ({
      key: group.key,
      label: group.label,
      status: group.status,
      nodes: group.nodes,
      count: group.count,
    }));
}

/**
 * Take rows out, and take every reference to them out with them.
 *
 * A key that names a row nobody can open is worse than no key at all: the
 * pill counts it, the menu offers it, and the reader goes looking. So a
 * dependency on a removed row goes, and a sub-task whose parent went stands
 * on its own from then on.
 *
 * This is not the filter. A filtered row still exists and comes back. A row
 * removed here is gone, and the links have to agree.
 */
export function withoutIssues(issues: Issue[], keys: string[]): Issue[] {
  const going = new Set(keys);
  if (going.size === 0) return issues;

  return issues
    .filter((issue) => !going.has(issue.key))
    .map((issue) => {
      const blocks = issue.blocks.filter((key) => !going.has(key));
      const orphaned = issue.parent !== undefined && going.has(issue.parent);
      if (blocks.length === issue.blocks.length && !orphaned) return issue;

      const kept = { ...issue, blocks };
      if (orphaned) delete kept.parent;
      return kept;
    });
}

// ── Filtering ─────────────────────────────────────────────────────────
/** Every field except "none", which filters nothing. */
export type FilterField = Exclude<GroupField, "none">;

export const FILTER_FIELDS: FilterField[] = GROUP_FIELDS.filter(
  (field): field is FilterField => field !== "none"
);

/** The chosen values, by field. A field with no entry filters nothing. */
export type Filters = Partial<Record<FilterField, string[]>>;

export interface FilterOption {
  key: string;
  label: string;
  /** Rows carrying this value, counted before any filter runs. */
  count: number;
}

/**
 * The values a field actually holds, in the order the grouping prints them.
 *
 * Counted against the whole list rather than the filtered one, so choosing a
 * value never makes its neighbours disappear from under the cursor.
 */
export function optionsFor(
  issues: Issue[],
  field: FilterField,
  sprintNames: Record<string, string> = {}
): FilterOption[] {
  const seen = new Map<string, FilterOption & { sort: string }>();

  for (const issue of issues) {
    for (const { key, label, sort } of bucketsFor(issue, field, sprintNames)) {
      const found = seen.get(key);
      if (found) {
        found.count += 1;
      } else {
        seen.set(key, { key, label, sort, count: 1 });
      }
    }
  }

  return [...seen.values()]
    .sort((a, b) => a.sort.localeCompare(b.sort))
    .map(({ key, label, count }) => ({ key, label, count }));
}

/** Whether one issue survives one field's chosen values. */
function matches(
  issue: Issue,
  field: FilterField,
  chosen: string[],
  sprintNames: Record<string, string>
): boolean {
  const buckets = bucketsFor(issue, field, sprintNames);
  return buckets.some((bucket) => chosen.includes(bucket.key));
}

/** Values within a field widen the result. Fields narrow it. */
export function applyFilters(
  issues: Issue[],
  filters: Filters,
  sprintNames: Record<string, string> = {}
): Issue[] {
  const active = Object.entries(filters).filter(
    ([, chosen]) => chosen && chosen.length > 0
  ) as [FilterField, string[]][];

  if (active.length === 0) return issues;

  return issues.filter((issue) =>
    active.every(([field, chosen]) =>
      matches(issue, field, chosen, sprintNames)
    )
  );
}

/** Values chosen across every field. The number on the button. */
export function activeCount(filters: Filters): number {
  return Object.values(filters).reduce(
    (total, chosen) => total + (chosen?.length ?? 0),
    0
  );
}

/** Add a value, or take it away. Returns a new object, never a mutation. */
export function toggleValue(
  filters: Filters,
  field: FilterField,
  key: string
): Filters {
  const chosen = filters[field] ?? [];
  const next = chosen.includes(key)
    ? chosen.filter((value) => value !== key)
    : [...chosen, key];

  const updated = { ...filters };
  // An empty array and an absent field mean the same thing, so only one of
  // them is ever stored. Otherwise the count on the button reads wrong.
  if (next.length === 0) {
    delete updated[field];
  } else {
    updated[field] = next;
  }
  return updated;
}

// ── Selection ─────────────────────────────────────────────────────────

/**
 * What the reader has picked, and where a shift-click measures from.
 *
 * The anchor is the last row clicked without shift. Shift then takes
 * everything between it and the new row, in the order the rows appear.
 */
export interface Selection {
  keys: Set<string>;
  anchor: string | null;
}

export const NOTHING_SELECTED: Selection = { keys: new Set(), anchor: null };

/**
 * Work out the next selection from one click.
 *
 * Two gestures. A click adds a row, or takes it away again, and leaves every
 * other row alone. Shift takes the whole run between the anchor and this row.
 *
 * A click never clears the rest. A box that emptied its neighbours would be a
 * box in name only, and picking six rows would take six gestures nobody could
 * guess. Ctrl and Cmd reach the same behaviour from the row itself, where a
 * plain click has to stay free for opening the issue.
 *
 * A filter can hide the anchor. Shift then behaves as a plain click, because
 * a run measured from a row nobody can see is a run nobody asked for.
 */
export function select(
  current: Selection,
  key: string,
  order: string[],
  event: { shiftKey: boolean }
): Selection {
  if (event.shiftKey && current.anchor) {
    const from = order.indexOf(current.anchor);
    const to = order.indexOf(key);
    if (from !== -1 && to !== -1) {
      const run = order.slice(Math.min(from, to), Math.max(from, to) + 1);
      // The run joins what is already chosen. Shift extends a selection in
      // every list that has one; it does not start over.
      return { keys: new Set([...current.keys, ...run]), anchor: current.anchor };
    }
  }

  const keys = new Set(current.keys);
  if (keys.has(key)) keys.delete(key);
  else keys.add(key);
  return { keys, anchor: key };
}
