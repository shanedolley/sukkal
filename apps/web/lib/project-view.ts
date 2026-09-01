// Which issues belong to a project.
//
// Two projects mean two different things here, and one rule covers both.
//
// A workspace is a Jira project, so its issues name it in the project field.
// A Collibra engagement is not: every engagement runs through one Jira
// project, and a label is what tells one engagement's issues from another's.
// That label is the one the project's settings tab holds. It starts as the
// address the project is reached at, and can be written over.

import type { Issue } from "./types";

export function issuesForProject(
  issues: Issue[],
  label: string,
  name: string
): Issue[] {
  return issues.filter(
    (issue) => issue.project === name || issue.labels.includes(label)
  );
}
