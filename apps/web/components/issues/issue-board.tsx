"use client";

// A list of issues, and everything that can be done to them.
//
// It holds what the session has changed: the rows drafted, the fields edited,
// and the rows taken out. All three sit above the caller's own selection, so
// a row edited out of that selection leaves the screen at once and the count
// in the title leaves with it.
//
// Two pages use it: a sprint and a project. Their only difference is which
// rows they hand in and what they put in the toolbar.

import { useState } from "react";

import { IssueList } from "@/components/issues/issue-list";
import { IssueDetail } from "@/components/issues/issue-detail";
import { IssueDialog } from "@/components/issues/issue-dialog";
import type { IssueFieldOptions } from "@/components/issues/issue-fields";
import { withoutIssues } from "@/lib/issue-view";
import type { Issue } from "@/lib/types";

export interface Board {
  /** Every row the session knows, edits and removals already applied. */
  known: Issue[];
  /** Open the form on a blank row. The page's plus calls this. */
  add: () => void;
  /** What the page renders inside its frame. */
  view: React.ReactNode;
}

/**
 * Hold the session's changes and render the list over them.
 *
 * The caller narrows `known` to the rows its page shows and hands them back
 * as `issues`. Doing it that way, rather than narrowing in here, keeps the
 * page in charge of what belongs to it.
 */
export function useBoard({
  base,
  issues,
  today,
  options,
  currentSprintId,
  sprintNames,
  leading,
}: {
  /** The rows before this session touched anything. */
  base: Issue[];
  /** Those of `known` that belong on this page. */
  issues: (known: Issue[]) => Issue[];
  today: string;
  options: IssueFieldOptions;
  /** Where a new row goes. */
  currentSprintId: string | null;
  sprintNames?: Record<string, string>;
  leading?: React.ReactNode;
}): Board {
  // ponytail: all three hold for the session. Post them to Jira once that
  // call exists, and the key it hands back replaces the NEW- one.
  const [drafted, setDrafted] = useState<Issue[]>([]);
  const [edits, setEdits] = useState<Record<string, Partial<Issue>>>({});
  const [gone, setGone] = useState<string[]>([]);
  // A key, not a copy. The detail view writes as it goes, and a snapshot
  // would go on showing what the row said when it opened.
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  // Edits first, then the removals, because a removal takes the links to the
  // row with it and an edit could otherwise put one back.
  const known = withoutIssues(
    [...base, ...drafted].map((issue) =>
      edits[issue.key] ? { ...issue, ...edits[issue.key] } : issue
    ),
    gone
  );

  const shown = issues(known);
  const editingRow = editingKey
    ? known.find((issue) => issue.key === editingKey)
    : undefined;

  function record(changes: Record<string, Partial<Issue>>) {
    setEdits((current) => {
      const next = { ...current };
      for (const [key, change] of Object.entries(changes)) {
        next[key] = { ...next[key], ...change };
      }
      return next;
    });
  }

  function remove(keys: string[]) {
    setGone((current) => [...new Set([...current, ...keys])]);
    // The form cannot stay open on a row that has gone.
    if (editingKey && keys.includes(editingKey)) setEditingKey(null);
  }

  /**
   * The form hands back a whole row, new or changed.
   *
   * A new one arrives with no key, because the form may stay open and write
   * another. The key is settled here, against the rows that exist by then.
   */
  function save(issue: Issue) {
    if (issue.key && known.some((one) => one.key === issue.key)) {
      record({ [issue.key]: issue });
      return;
    }
    setDrafted((current) => {
      const taken = new Set([
        ...base.map((one) => one.key),
        ...current.map((one) => one.key),
      ]);
      let n = 1;
      while (taken.has(`NEW-${n}`)) n += 1;
      return [...current, { ...issue, key: `NEW-${n}` }];
    });
  }

  return {
    known,
    add: () => setAdding(true),
    view: (
      <>
        <IssueList
          issues={shown}
          today={today}
          sprintNames={sprintNames}
          allSprints={options.sprints}
          leading={leading}
          onEdit={record}
          onOpen={(issue) => setEditingKey(issue.key)}
          onDelete={remove}
        />

        {editingRow && (
          <IssueDetail
            issue={editingRow}
            issues={known}
            options={options}
            open
            onOpenChange={(open) => !open && setEditingKey(null)}
            onChange={(change) => record({ [editingRow.key]: change })}
            onOpen={(next) => setEditingKey(next.key)}
            onDelete={() => remove([editingRow.key])}
          />
        )}

        {adding && (
          <IssueDialog
            currentSprintId={currentSprintId}
            options={options}
            issues={known}
            open
            onOpenChange={setAdding}
            onSubmit={save}
          />
        )}
      </>
    ),
  };
}
