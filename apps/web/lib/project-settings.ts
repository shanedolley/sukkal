"use client";

// What one project carries, as opposed to the workspace it sits in.
//
// A workspace is a Jira project and holds a connection, custom fields and a
// display choice. A project inside it holds none of those. It holds the label
// that says which of the workspace's issues are its own, and the two dates
// the contract sets.
//
// The settings tab writes this, the overview reads the dates and the issue
// board reads the label, so it lives in none of the three. It goes to
// localStorage for the reason the custom fields do: a setting that resets on
// every navigation reads as a fault.
//
// ponytail: the second store of this shape, after lib/project-fields.ts. A
// third one earns a shared keyed-record helper in lib/local-store.ts.

import { createLocalStore } from "./local-store";
import { PROJECT_OVERVIEW } from "./fixtures";

export interface ProjectSetting {
  /** The Jira label an issue must carry to belong to this project. */
  label: string;
  /** ISO date. Null when no contract names one. */
  start: string | null;
  /** ISO date. Null when no contract names one. */
  end: string | null;
}

type Saved = Record<string, ProjectSetting>;

function parse(value: string): Saved {
  try {
    const read: unknown = JSON.parse(value);
    return read && typeof read === "object" ? (read as Saved) : {};
  } catch {
    return {};
  }
}

const store = createLocalStore<string>("kpa.project.settings", "{}", (value) => {
  try {
    const read: unknown = JSON.parse(value);
    return read !== null && typeof read === "object";
  } catch {
    return false;
  }
});

/**
 * What a project starts with.
 *
 * The address the project is reached at is also the label its issues carry,
 * which is what makes a project findable before anyone has been near this
 * form.
 */
function fallback(key: string): ProjectSetting {
  const overview = PROJECT_OVERVIEW[key];
  return {
    label: key,
    start: overview?.start ?? null,
    end: overview?.end ?? null,
  };
}

/** Every project that has been given settings, by key. */
export function useProjectSettings(): Saved {
  return parse(store.useValue());
}

/** One project's settings, saved or as they started. */
export function useProjectSetting(key: string): ProjectSetting {
  const saved = parse(store.useValue());
  return saved[key] ?? fallback(key);
}

/** Replace one project's settings. The others are left where they are. */
export function setProjectSetting(key: string, setting: ProjectSetting) {
  const saved = parse(
    typeof window === "undefined"
      ? "{}"
      : (window.localStorage.getItem("kpa.project.settings") ?? "{}")
  );
  store.set(JSON.stringify({ ...saved, [key]: setting }));
}
