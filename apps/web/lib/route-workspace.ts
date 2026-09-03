// The workspace a `/projects/[key]` route belongs to.
//
// A key names a workspace or a project inside one, and both reach the same
// settings screen. KPA-140 ruled what that screen edits: the workspace's
// custom fields, never a list of the project's own. A custom field belongs to
// a Jira project's field configuration, and Collibra runs every engagement
// through one Jira project, so the fields are per tracker rather than per
// engagement.
//
// IT RESOLVES FROM THE ID, NEVER FROM THE NAME, on the same terms as
// `workspace-fields.ts`. A name changes and an id does not, and the route
// carries the id already.

import { WORKSPACES, type Workspace } from "./workspaces.ts";

/**
 * The workspace a project key edits the fields of.
 *
 * Undefined for a key the tree does not hold, which is what the sidebar's
 * plus button adds. The caller falls back to the display name, which is the
 * key `workspace-fields.ts` passes an unknown workspace through under.
 */
export function routeWorkspace(key: string): Workspace | undefined {
  return WORKSPACES.find(
    (workspace) =>
      workspace.id === key ||
      workspace.projects.some((project) => project.id === key)
  );
}
