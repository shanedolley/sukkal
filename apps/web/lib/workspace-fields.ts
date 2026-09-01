"use client";

// Which custom fields a workspace carries.
//
// The settings page writes this and both issue forms read it, so it cannot
// live in either. It goes to localStorage for the same reason the grouping
// choice does: a setting that resets on every navigation reads as a fault.
//
// The fixtures hold the starting set. A workspace the reader has never touched
// falls back to those, so the list is never empty by accident.

import { createLocalStore } from "./local-store";
import { WORKSPACE_FIELDS } from "./fixtures";
import type { CustomField } from "./types";

/** Every workspace's list, by workspace name, as one JSON string. */
type Saved = Record<string, CustomField[]>;

function parse(value: string): Saved {
  try {
    const read: unknown = JSON.parse(value);
    return read && typeof read === "object" ? (read as Saved) : {};
  } catch {
    return {};
  }
}

const store = createLocalStore<string>("kpa.workspace.fields", "{}", (value) => {
  try {
    const read: unknown = JSON.parse(value);
    return read !== null && typeof read === "object";
  } catch {
    return false;
  }
});

/** The fields a workspace carries now, saved or from the fixtures. */
export function useWorkspaceFields(workspace: string): CustomField[] {
  const saved = parse(store.useValue());
  return saved[workspace] ?? WORKSPACE_FIELDS[workspace] ?? [];
}

/** Replace one workspace's list. The others are left where they are. */
export function setWorkspaceFields(workspace: string, fields: CustomField[]) {
  const saved = parse(
    typeof window === "undefined"
      ? "{}"
      : (window.localStorage.getItem("kpa.workspace.fields") ?? "{}")
  );
  store.set(JSON.stringify({ ...saved, [workspace]: fields }));
}

/** A name becomes the id its values are filed under. */
export function fieldId(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
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
