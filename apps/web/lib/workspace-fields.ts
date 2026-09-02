"use client";

// Which custom fields a workspace carries.
//
// The settings page writes this and both issue forms read it, so it cannot
// live in either. `migrations/021_workspace_fields.sql` is where the list
// lives now, and KPA-127 moved this store onto it. ADR-0022 gives the reason:
// a mapping to Jira field ids describes an external system, so two devices
// cannot legitimately disagree about it.
//
// THE LIST IS FILED UNDER `workspaces.id`, NEVER UNDER THE NAME. Every caller
// holds a name and a name changes, so `savedUnder` translates it once. The
// table makes the same rule a foreign key, so a rename now moves nothing and
// a name reaches no row at all.
//
// The fixtures still hold the starting set, for a workspace the table has no
// row for. That is the row the sidebar's plus button adds, which reaches no
// table either.

import { createRemoteStore, send } from "./remote-store";
import { WORKSPACE_FIELDS } from "./fixtures";
import type { CustomField } from "./types";
import type { WorkspaceField } from "./tree";
import { workspaceNamed } from "./workspaces";

export type { WorkspaceField };

const URL = "/api/workspace-fields";

/** Every workspace's list, by `workspaces.id`. */
type Saved = Record<string, WorkspaceField[]>;

const store = createRemoteStore<Saved>(URL, {});

/**
 * The fixtures, in the shape a row has.
 *
 * Built once, so a workspace with no row gets the same array on every render
 * rather than a fresh one. They carry no Jira id, because no rule derives one
 * from the name: migration 021 says why.
 */
const FIXED: Saved = Object.fromEntries(
  Object.entries(WORKSPACE_FIELDS).map(([workspace, fields]) => [
    workspace,
    fields.map((field) => ({ ...field, jiraId: "" })),
  ])
);

/**
 * The key a workspace's saved list is filed under.
 *
 * Every caller holds a name, and a name changes. `workspaces.id` does not, so
 * a rename leaves the list where it is. A name the tree does not hold is
 * passed through, which is what a workspace the plus button added has.
 */
function savedUnder(workspace: string): string {
  return workspaceNamed(workspace)?.id ?? workspace;
}

/**
 * The fields a workspace carries now.
 *
 * A row carries the Jira id beside the three fields a screen renders, because
 * the write needs it and no rule derives it from the name. A fixture carries
 * none, so a workspace with no row falls back to a list the settings screen
 * cannot save.
 */
export function useWorkspaceFields(workspace: string): WorkspaceField[] {
  // The fixtures are still keyed by name. They are a constant a rename edits,
  // where the saved list is data a rename must not touch.
  return store.useValue()[savedUnder(workspace)] ?? FIXED[workspace] ?? [];
}

/** Replace one workspace's list. The others are left where they are. */
export function setWorkspaceFields(
  workspace: string,
  fields: WorkspaceField[]
): void {
  const key = savedUnder(workspace);
  store.put({ ...store.read(), [key]: fields });
  void send(store, URL, "PUT", { workspace: key, fields });
}

/** The required fields a row has not filled in. Empty means it can be filed. */
export function missingFields(
  fields: CustomField[],
  values: Record<string, string>
): CustomField[] {
  return fields.filter(
    (field) => field.required && !(values[field.id] ?? "").trim()
  );
}
