// The three levels this application files work under, and what tells them
// apart. They are not interchangeable, and the words are load-bearing.
//
// A SPACE is whose world you are looking at: Collibra, Koinon, or personal.
// The filter in the sidebar header cuts every screen by it, and the policy
// the brief sets out is written in terms of it.
//
// A WORKSPACE is a Jira project. It holds the tracker connection and the
// custom fields, and an issue names it in its `workspace` field. One
// workspace belongs to one space, so the space an issue sits in is read from
// its workspace rather than stored beside it. Two copies of one fact drift.
//
// A PROJECT is one piece of work inside a workspace. It holds a label and the
// two contract dates, and it is found in one of two ways. Collibra runs every
// engagement through PSAPAC, so a label on the issue says which engagement it
// belongs to. Koinon Engineering gives each project a Jira project of its
// own, so the key prefix says it instead. The rule travels with the project,
// rather than being guessed at by whoever asks.
//
// The tree also lives in `migrations/018_workspaces_and_projects.sql`, which
// seeds these exact rows. Every screen still reads the constant, and slice
// seven is where the table replaces it. `test/workspaces.test.ts` compares the
// two field by field, so a row added here and nowhere else fails the suite.

import type { Issue, Space } from "./types";

/** How to tell whether an issue belongs to a project. */
export type ProjectMatch =
  /** One tracker, many engagements. The label names which. */
  | { by: "label"; label: string }
  /** A tracker each. Every key in it starts with the prefix. */
  | { by: "key"; prefix: string };

export interface Project {
  /** The address it is reached at, and the key its settings are filed under.
   *  Derived from the name once, and never again: a rename changes `name`
   *  alone, because deriving this a second time orphans the settings. */
  id: string;
  name: string;
  match: ProjectMatch;
}

export interface Workspace {
  /** The stable key, on the same terms as a project's. KPA-97 files a custom
   *  field under this rather than under the name. */
  id: string;
  /** What an issue carries in its workspace field. */
  name: string;
  space: Space;
  projects: Project[];
}

export const WORKSPACES: Workspace[] = [
  {
    id: "collibra",
    name: "Collibra",
    space: "collibra",
    projects: [
      {
        id: "bhp-meridian",
        name: "BHP Meridian",
        match: { by: "label", label: "bhp-meridian" },
      },
      {
        id: "sydney-water",
        name: "Sydney Water",
        match: { by: "label", label: "sydney-water" },
      },
      {
        id: "transport-for-nsw",
        name: "Transport for NSW",
        match: { by: "label", label: "transport-for-nsw" },
      },
    ],
  },
  {
    id: "koinon-engineering",
    name: "Koinon Engineering",
    space: "koinon",
    projects: [
      {
        id: "mp",
        name: "MP · Marinucci Engineering",
        match: { by: "key", prefix: "MP" },
      },
      {
        id: "ms",
        name: "MS · Marinucci Support",
        match: { by: "key", prefix: "MS" },
      },
      {
        id: "kpa",
        name: "KPA · Personal Assistant",
        match: { by: "key", prefix: "KPA" },
      },
    ],
  },
  // ponytail: nothing personal is tracked in Jira yet. The + in the sidebar
  // fills this.
  { id: "personal", name: "Personal", space: "personal", projects: [] },
];

/** Every project, whichever workspace holds it. */
export const PROJECTS: Project[] = WORKSPACES.flatMap(
  (workspace) => workspace.projects
);

export function workspaceNamed(name: string): Workspace | undefined {
  return WORKSPACES.find((workspace) => workspace.name === name);
}

/** The workspace a project sits in. */
export function workspaceOf(projectId: string): Workspace | undefined {
  return WORKSPACES.find((workspace) =>
    workspace.projects.some((project) => project.id === projectId)
  );
}

/**
 * The space a workspace belongs to.
 *
 * A workspace nobody has heard of is personal. A row added in the sidebar this
 * session names no space, and personal is the space that grants the least.
 */
export function spaceOf(workspace: string): Space {
  return workspaceNamed(workspace)?.space ?? "personal";
}

/** Whether a key names a workspace rather than a project inside one. */
export function isWorkspace(key: string): boolean {
  return WORKSPACES.some((workspace) => workspace.id === key);
}

export function projectNamed(id: string): Project | undefined {
  return PROJECTS.find((project) => project.id === id);
}

/**
 * Whether an issue belongs to a project.
 *
 * The label is the one the project's settings hold, which starts as the
 * project's own and can be written over. A project matched by its key prefix
 * ignores it, because no label decides the answer there.
 */
export function inProject(issue: Issue, project: Project, label: string) {
  return project.match.by === "label"
    ? issue.labels.includes(label)
    : issue.key.startsWith(`${project.match.prefix}-`);
}
