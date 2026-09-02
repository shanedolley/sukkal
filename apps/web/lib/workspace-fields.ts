"use client";

// Which custom fields a workspace carries.
//
// The settings page writes this and both issue forms read it, so it cannot
// live in either. It goes to localStorage for the same reason the grouping
// choice does: a setting that resets on every navigation reads as a fault.
//
// The fixtures hold the starting set. A workspace the reader has never touched
// falls back to those, so the list is never empty by accident.
//
// `migrations/021_workspace_fields.sql` is where the list belongs, and KPA-127
// is the story that moves this read to it.

import { createLocalStore } from "./local-store";
import { WORKSPACE_FIELDS } from "./fixtures";
import type { CustomField } from "./types";
import { workspaceNamed } from "./workspaces";

/** Read twice: once by the store, once by the setter, which holds no hook. */
const KEY = "kpa.workspace.fields";

/** Every workspace's list, by `workspaces.id`, as one JSON string. */
type Saved = Record<string, CustomField[]>;

function parse(value: string): Saved {
  try {
    const read: unknown = JSON.parse(value);
    return read && typeof read === "object" ? (read as Saved) : {};
  } catch {
    return {};
  }
}

const store = createLocalStore<string>(KEY, "{}", (value) => {
  try {
    const read: unknown = JSON.parse(value);
    return read !== null && typeof read === "object";
  } catch {
    return false;
  }
});

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

/** The fields a workspace carries now, saved or from the fixtures. */
export function useWorkspaceFields(workspace: string): CustomField[] {
  const saved = parse(store.useValue());
  // The fixtures are still keyed by name. They are a constant a rename edits,
  // where the saved list is data a rename must not touch.
  return saved[savedUnder(workspace)] ?? WORKSPACE_FIELDS[workspace] ?? [];
}

/** Replace one workspace's list. The others are left where they are. */
export function setWorkspaceFields(workspace: string, fields: CustomField[]) {
  const saved = parse(
    typeof window === "undefined"
      ? "{}"
      : (window.localStorage.getItem(KEY) ?? "{}")
  );
  store.set(JSON.stringify({ ...saved, [savedUnder(workspace)]: fields }));
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
