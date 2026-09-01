"use client";

// The menu a right-click opens on a row.
//
// Every field on the row already has a control of its own, and they are the
// fastest way to change one thing. This is for the other case: the reader who
// knows what they want to change but not where the control for it sits, and
// the two fields that have no control on the row at all.
//
// A field with a short list of answers is a submenu, because the answer is one
// click away and the menu can show which one is set now. The title and the
// dates take typing, so they open a small box instead. Everything else on the
// issue lives in the form, which the first item opens.

import { useState } from "react";
import { ContextMenu } from "@base-ui/react/context-menu";
import {
  CalendarIcon,
  PencilLineIcon,
  SquareArrowOutUpRightIcon,
  Trash2Icon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { realToday } from "@/lib/format";
import { PRIORITY_ORDER, STATUS_LABELS, STATUS_ORDER } from "@/lib/issue-view";
import { parseDate } from "@/lib/parse-date";
import {
  ISSUE_KIND_LABELS,
  ISSUE_PRIORITY_LABELS,
  type Issue,
  type IssueKind,
  type IssuePriority,
  type IssueStatus,
} from "@/lib/types";
import { dotFor, KindGlyph, PriorityGlyph, StatusGlyph } from "./glyphs";
import { DateBox, DeleteIssues, NO_SPRINT } from "./issue-fields";
import { ISSUE_OPTIONS } from "./issue-options";
import { WORKSPACE_ROWS } from "@/components/blocks/app-shell-1/components/data";
import { useProjectSettings } from "@/lib/project-settings";

const KIND_ORDER: IssueKind[] = ["epic", "story", "subtask"];

/** A menu carries no null, so "in no project" travels as a word. */
const NO_PROJECT = "__none__";

/**
 * Where a row can be moved, and what moving it there writes.
 *
 * "Project" means two things in this application, so the menu offers both.
 * A workspace is a Jira project, and an issue names it in its project field.
 * An engagement inside a workspace is not: Collibra runs every one of them
 * through PSAPAC, and a label is what tells one from another. So moving
 * between workspaces writes the project field, and moving between projects
 * writes a label.
 *
 * Worked out once, because the rows do not change while the page is open.
 */
const WORKSPACES = WORKSPACE_ROWS.map((row) => ({
  ...row,
  /** The workspace's name is what an issue carries in its project field. */
  space: ISSUE_OPTIONS.spaceOf(row.label),
}));

/** Every label that says which project a row belongs to. */
const PROJECT_KEYS = WORKSPACE_ROWS.flatMap((row) =>
  row.projects.map((project) => project.id)
);

/** What the row can be given, and what it holds now. */
export interface RowEdits {
  onOpen: () => void;
  onTitle: (title: string) => void;
  onStatus: (status: IssueStatus) => void;
  onPriority: (priority: IssuePriority) => void;
  onKind: (kind: IssueKind) => void;
  onAssignee: (assignee: string) => void;
  onSprint: (sprintId: string | null) => void;
  onLabels: (labels: string[]) => void;
  onDates: (dates: { start?: string | null; due?: string | null }) => void;
  /** A move writes more than one field, and the menu works out which. */
  onMove: (patch: Partial<Issue>) => void;
  onDelete: () => void;
}

/** One field, one submenu, one answer ticked. */
function FieldSub<T extends string>({
  name,
  options,
  labels,
  glyphs,
  value,
  onChange,
}: {
  name: string;
  options: readonly T[];
  labels: Record<string, string>;
  glyphs?: (option: T) => React.ReactNode;
  /** What the row holds now, so the menu opens with it ticked. */
  value: string;
  onChange: (value: T) => void;
}) {
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>{name}</DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="max-h-72 overflow-y-auto">
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(next) => onChange(next as T)}
        >
          {options.map((option) => (
            <DropdownMenuRadioItem key={option} value={option}>
              {glyphs?.(option)}
              {labels[option] ?? option}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

/**
 * The title and the dates, which take typing rather than picking.
 *
 * The dates read words, the same as the badge on the row does, because "next
 * friday" is how the date arrives in somebody's head. Nothing is written until
 * Save, so a box opened by accident costs nothing.
 */
function RowEditBox({
  issue,
  field,
  onClose,
  onTitle,
  onDates,
}: {
  issue: Issue;
  /** Which box the pointer asked for. Null means the dialog is shut. */
  field: "title" | "dates" | null;
  onClose: () => void;
  onTitle: (title: string) => void;
  onDates: (dates: { start?: string | null; due?: string | null }) => void;
}) {
  // Read once, when the box opens. A page left open over midnight should not
  // change what "tomorrow" means halfway through typing it.
  const [today] = useState(realToday);
  const [title, setTitle] = useState(issue.title);
  const [dates, setDates] = useState({ start: issue.start, due: issue.due });
  const [startWords, setStartWords] = useState("");
  const [dueWords, setDueWords] = useState("");

  function save() {
    if (title.trim() && title !== issue.title) onTitle(title.trim());
    if (dates.start !== issue.start || dates.due !== issue.due) onDates(dates);
    onClose();
  }

  return (
    <Dialog
      open={field !== null}
      onOpenChange={(next) => {
        if (next) return;
        // Whatever was typed goes with the box. Save is the only way out
        // that writes anything.
        setTitle(issue.title);
        setDates({ start: issue.start, due: issue.due });
        setStartWords("");
        setDueWords("");
        onClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{issue.key || "This issue"}</DialogTitle>
          <DialogDescription>
            The title and the dates. Every other field sits in the menu, and
            the rest of them in the form.
          </DialogDescription>
        </DialogHeader>

        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="row-title">Title</Label>
            <Input
              id="row-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              autoComplete="off"
              autoFocus={field === "title"}
            />
          </div>

          <div className="flex items-start gap-2">
            <DateBox
              name="Start"
              value={dates.start}
              from={today}
              text={startWords}
              onText={(words) => {
                setStartWords(words);
                const said = parseDate(words, today);
                if (said) setDates((current) => ({ ...current, start: said }));
              }}
              onClear={() => {
                setStartWords("");
                setDates((current) => ({ ...current, start: null }));
              }}
            />
            <DateBox
              name="Due"
              value={dates.due}
              // A range is read from its near end. "Friday" on a job starting
              // Tuesday is the Friday of that week, not the one after today.
              from={dates.start ?? today}
              text={dueWords}
              onText={(words) => {
                setDueWords(words);
                const said = parseDate(words, dates.start ?? today);
                if (said) setDates((current) => ({ ...current, due: said }));
              }}
              onClear={() => {
                setDueWords("");
                setDates((current) => ({ ...current, due: null }));
              }}
            />
          </div>

          <DialogFooter>
            <DialogClose render={<Button variant="outline" type="button" />}>
              Cancel
            </DialogClose>
            <Button type="submit">Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function RowMenu({
  issue,
  row,
  byKey,
  assignees,
  sprints,
  allLabels,
  onOpen,
  onTitle,
  onStatus,
  onPriority,
  onKind,
  onAssignee,
  onSprint,
  onLabels,
  onDates,
  onMove,
  onDelete,
}: RowEdits & {
  issue: Issue;
  /** The row itself. The right-click area is the whole of it. */
  row: React.ReactElement;
  assignees: string[];
  sprints: { id: string; name: string }[];
  allLabels: string[];
  /** Every row on the board, so the confirm box can say what else a
   *  deletion takes with it. */
  byKey: Map<string, Issue>;
}) {
  const [editing, setEditing] = useState<"title" | "dates" | null>(null);
  const [deleting, setDeleting] = useState(false);
  // A project's label starts as its key and can be written over in its
  // settings, so the saved one is what a row has to carry.
  const saved = useProjectSettings();
  const labelOf = (key: string) => saved[key]?.label ?? key;

  /** The project this row sits in, by the label it carries. */
  const inProject = PROJECT_KEYS.find((key) =>
    issue.labels.includes(labelOf(key)),
  );

  /**
   * Moving to a project swaps one label for another, because a row belongs
   * to one engagement at a time. Every other label it carries stays.
   */
  function moveTo(key: string): Partial<Issue> {
    const others = issue.labels.filter(
      (label) => !PROJECT_KEYS.some((one) => labelOf(one) === label),
    );
    if (key === NO_PROJECT) return { labels: others };

    const workspace = WORKSPACES.find((one) =>
      one.projects.some((project) => project.id === key),
    );
    return {
      labels: [...others, labelOf(key)],
      ...(workspace && {
        project: workspace.label,
        space: workspace.space,
      }),
    };
  }

  return (
    <>
      <ContextMenu.Root>
        <ContextMenu.Trigger render={row} />

        <DropdownMenuContent className="w-auto min-w-48">
          {/* A label is a group's label. Base UI throws without the group
              around it, which is the shape a menu heading takes. */}
          <DropdownMenuGroup>
            <DropdownMenuLabel className="truncate">
              {issue.key ? `${issue.key} · ${issue.title}` : issue.title}
            </DropdownMenuLabel>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />

          <DropdownMenuItem onClick={onOpen}>
            <SquareArrowOutUpRightIcon aria-hidden="true" />
            Open
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setEditing("title")}>
            <PencilLineIcon aria-hidden="true" />
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setEditing("dates")}>
            <CalendarIcon aria-hidden="true" />
            Dates
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          <FieldSub
            name="Status"
            options={STATUS_ORDER}
            labels={STATUS_LABELS}
            glyphs={(status: IssueStatus) => <StatusGlyph status={status} />}
            value={issue.status}
            onChange={onStatus}
          />
          <FieldSub
            name="Priority"
            options={PRIORITY_ORDER}
            labels={ISSUE_PRIORITY_LABELS}
            glyphs={(priority: IssuePriority) => (
              <PriorityGlyph priority={priority} silent />
            )}
            value={issue.priority}
            onChange={onPriority}
          />
          <FieldSub
            name="Kind"
            options={KIND_ORDER}
            labels={ISSUE_KIND_LABELS}
            glyphs={(kind: IssueKind) => <KindGlyph kind={kind} silent />}
            value={issue.kind}
            onChange={onKind}
          />
          <FieldSub
            name="Assignee"
            options={assignees}
            labels={Object.fromEntries(assignees.map((one) => [one, one]))}
            value={issue.assignee}
            onChange={onAssignee}
          />
          <FieldSub
            name="Sprint"
            options={[...sprints.map((one) => one.id), NO_SPRINT]}
            labels={{
              ...Object.fromEntries(sprints.map((one) => [one.id, one.name])),
              [NO_SPRINT]: "No sprint",
            }}
            value={issue.sprintId ?? NO_SPRINT}
            onChange={(id) => onSprint(id === NO_SPRINT ? null : id)}
          />

          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Workspace</DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="max-h-72 overflow-y-auto">
              <DropdownMenuRadioGroup
                value={issue.project}
                onValueChange={(name) =>
                  onMove({
                    project: name,
                    space: ISSUE_OPTIONS.spaceOf(name),
                  })
                }
              >
                {WORKSPACES.map((workspace) => (
                  <DropdownMenuRadioItem
                    key={workspace.id}
                    value={workspace.label}
                  >
                    {workspace.label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          {/* A project takes its workspace with it, because an engagement
              belongs to the workspace that runs it. */}
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Project</DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="max-h-72 overflow-y-auto">
              <DropdownMenuRadioGroup
                value={inProject ?? NO_PROJECT}
                onValueChange={(key) => onMove(moveTo(key))}
              >
                {WORKSPACES.filter(
                  (workspace) => workspace.projects.length > 0,
                ).map((workspace) => (
                  <DropdownMenuGroup key={workspace.id}>
                    <DropdownMenuLabel>{workspace.label}</DropdownMenuLabel>
                    {workspace.projects.map((project) => (
                      <DropdownMenuRadioItem
                        key={project.id}
                        value={project.id}
                      >
                        {project.label}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuGroup>
                ))}
                <DropdownMenuGroup>
                  <DropdownMenuLabel>Neither</DropdownMenuLabel>
                  <DropdownMenuRadioItem value={NO_PROJECT}>
                    No project
                  </DropdownMenuRadioItem>
                </DropdownMenuGroup>
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          {/* Labels add and take away rather than replace, so the list stays
              open and a row can be given three of them in three clicks. */}
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Labels</DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="max-h-72 overflow-y-auto">
              {allLabels.length === 0 && (
                <DropdownMenuItem disabled>No labels yet</DropdownMenuItem>
              )}
              {allLabels.map((label) => {
                const on = issue.labels.includes(label);
                return (
                  <DropdownMenuCheckboxItem
                    key={label}
                    checked={on}
                    closeOnClick={false}
                    onCheckedChange={() =>
                      onLabels(
                        on
                          ? issue.labels.filter((one) => one !== label)
                          : [...issue.labels, label],
                      )
                    }
                  >
                    <span
                      className={`size-1.5 shrink-0 rounded-full ${dotFor(label)}`}
                      aria-hidden="true"
                    />
                    {label}
                  </DropdownMenuCheckboxItem>
                );
              })}
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          <DropdownMenuSeparator />

          <DropdownMenuItem
            variant="destructive"
            onClick={() => setDeleting(true)}
          >
            <Trash2Icon aria-hidden="true" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </ContextMenu.Root>

      <RowEditBox
        // A fresh box each time, so it opens on what the row holds now
        // rather than on what was typed into it and abandoned.
        key={editing ?? "shut"}
        issue={issue}
        field={editing}
        onClose={() => setEditing(null)}
        onTitle={onTitle}
        onDates={onDates}
      />

      {/* Mounted only while it is asked for, so the list of every row is
          built when somebody deletes rather than on every render. */}
      {deleting && (
        <DeleteIssues
          open
          onOpenChange={(next) => {
            if (!next) setDeleting(false);
          }}
          keys={[issue.key]}
          issues={[...byKey.values()]}
          onConfirm={() => {
            onDelete();
            setDeleting(false);
          }}
        />
      )}
    </>
  );
}
