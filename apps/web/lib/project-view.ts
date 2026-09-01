// Which issues belong to a row under Workspaces.
//
// Two kinds of row live there, and they are found different ways. A workspace
// is a Jira project, so its issues name it. A project inside one is found by
// the rule it carries, which lib/workspaces.ts sets out.

import { inProject, type Project } from "./workspaces";
import type { Issue } from "./types";

/** Every issue on a workspace. */
export function issuesForWorkspace(issues: Issue[], name: string): Issue[] {
  return issues.filter((issue) => issue.workspace === name);
}

/**
 * Every issue on a project.
 *
 * The label is the one the project's settings hold. It starts as the address
 * the project is reached at, and can be written over.
 */
export function issuesForProject(
  issues: Issue[],
  project: Project,
  label: string
): Issue[] {
  return issues.filter((issue) => inProject(issue, project, label));
}
