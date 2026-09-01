// What the menus in the issue form offer.
//
// Read from the fixtures rather than written out, so a project or a label
// added there reaches every menu without a second edit.

import { ISSUES, SPRINTS } from "@/lib/fixtures";
import type { IssueFieldOptions } from "./issue-fields";

/** Oldest first, so a step forward always means a later sprint. */
export const SPRINTS_IN_ORDER = [...SPRINTS].sort((a, b) =>
  a.start.localeCompare(b.start)
);

const SPACE_OF = new Map(
  ISSUES.map((issue) => [issue.project, issue.space] as const)
);

export const ISSUE_OPTIONS: IssueFieldOptions = {
  projects: [...new Set(ISSUES.map((issue) => issue.project))].sort(),
  assignees: [...new Set(ISSUES.map((issue) => issue.assignee))].sort(),
  labels: [...new Set(ISSUES.flatMap((issue) => issue.labels))].sort(),
  sprints: SPRINTS_IN_ORDER,
  // The one person this assistant works for. Every new row starts with him.
  defaultAssignee: "Shane Dolley",
  spaceOf: (project) => SPACE_OF.get(project) ?? "personal",
};

/** Where a new row goes, whatever sprint the page happens to show. */
export const CURRENT_SPRINT_ID =
  SPRINTS.find((sprint) => sprint.state === "active")?.id ?? null;
