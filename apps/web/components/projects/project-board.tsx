"use client";

// One project's issues, wired once.
//
// Two screens ask for them: the project page's Issues tab, and the
// /projects/[key]/issues address the sidebar links to. They draw different
// frames around the same board, so the board is built here and the frame is
// each screen's own.

import { useParams } from "next/navigation";

import { useBoard } from "@/components/issues/issue-board";
import {
  CURRENT_SPRINT_ID,
  ISSUE_OPTIONS,
  SPRINTS_IN_ORDER,
} from "@/components/issues/issue-options";
import { ISSUES, TODAY } from "@/lib/fixtures";
import { useForcedStatus } from "@/lib/forced-state";
import { useProjectSetting } from "@/lib/project-settings";
import { issuesForProject } from "@/lib/project-view";
import { inSpace, useSpace } from "@/lib/space-context";
import { projectName } from "@/app/(app)/projects/[key]/project-name";

/** Every sprint, because a project's issues span all of them. */
const SPRINT_NAMES = Object.fromEntries(
  SPRINTS_IN_ORDER.map((sprint) => [sprint.id, sprint.name])
);

/** The board for whichever project the address names. */
export function useProjectBoard() {
  const { key } = useParams<{ key: string }>();
  const { space } = useSpace();
  const status = useForcedStatus();
  const name = projectName(key);
  const { label } = useProjectSetting(key);

  const board = useBoard({
    base: ISSUES,
    issues: (known) => issuesForProject(inSpace(known, space), label, name),
    today: TODAY,
    options: ISSUE_OPTIONS,
    currentSprintId: CURRENT_SPRINT_ID,
    sprintNames: SPRINT_NAMES,
  });

  return {
    key,
    name,
    status,
    board,
    count: issuesForProject(board.known, label, name).length,
  };
}
