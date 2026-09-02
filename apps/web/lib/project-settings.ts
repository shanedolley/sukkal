"use client";

// What one project carries, as opposed to the workspace it sits in.
//
// A workspace is a Jira project and holds a connection, custom fields and a
// display choice. A project inside it holds none of those. It holds the label
// that says which of the workspace's issues are its own, and the two dates
// the contract sets.
//
// The settings tab writes this, the overview reads the dates and the issue
// board reads the label, so it lives in none of the three.
//
// THE ROW HOLDS ALL FOUR. `projects` carries the label from migration 018,
// and the description, both contract dates and the source of each date from
// migration 020. A poller reads the row and could not read a browser, so
// KPA-127 moved this store onto the table. ADR-0022 gives the reason: a
// contract date arrives from Salesforce through Certinia, and data the
// product fetched from another system is not a preference one browser holds.
//
// THE FIXTURE NO LONGER SUPPLIES A DATE. The row is the answer, and migration
// 020 seeded none, so a project shows "Not set" until somebody types the dates
// or Salesforce sends them. `PROJECT_OVERVIEW` still carries the description,
// which the overview reads from the fixture directly.

import { createRemoteStore, send } from "./remote-store";
import type { ProjectSetting } from "./tree";

export type { ProjectSetting };

const URL = "/api/projects";

type Saved = Record<string, ProjectSetting>;

const store = createRemoteStore<Saved>(URL, {});

/**
 * What a project starts with.
 *
 * The address a project is reached at is also the label its issues carry,
 * which is what makes it findable before anybody has been near this form.
 * `readProjects` applies the same rule to a row whose `match_label` is null,
 * so this covers a key the table does not hold at all.
 *
 * Each one is made once and kept. The read lands after the first render, so a
 * caller that seeds a form from this compares what it has against what it is
 * given, and a fresh object per render would never look the same twice.
 */
const fallbacks = new Map<string, ProjectSetting>();

function fallback(key: string): ProjectSetting {
  let held = fallbacks.get(key);
  if (!held) {
    held = { label: key, start: null, end: null };
    fallbacks.set(key, held);
  }
  return held;
}

/** Every project that has settings, by key. */
export function useProjectSettings(): Saved {
  return store.useValue();
}

/** One project's settings, saved or as they started. */
export function useProjectSetting(key: string): ProjectSetting {
  return store.useValue()[key] ?? fallback(key);
}

/** Replace one project's settings. The others are left where they are. */
export function setProjectSetting(key: string, setting: ProjectSetting): void {
  store.put({ ...store.read(), [key]: setting });
  void send(store, URL, "PUT", { id: key, setting });
}
