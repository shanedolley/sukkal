"use client";

// The box that files a new issue.
//
// The placement sits above as a breadcrumb, the title and the description
// take the room, and every other field is a chip underneath. A form of
// stacked labelled boxes asks the reader to fill in eleven fields. This one
// asks for a title and offers the rest.
//
// An existing row opens components/issues/issue-detail.tsx instead. Creating
// is one question; reading an issue is a page.

import { useState } from "react";
import {
  CalendarArrowDownIcon,
  CalendarArrowUpIcon,
  FolderKanbanIcon,
  RocketIcon,
  TagIcon,
  UserRoundIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { STATUS_LABELS, STATUS_ORDER } from "@/lib/issue-view";
import {
  ISSUE_PRIORITY_LABELS,
  type Issue,
  type IssuePriority,
  type IssueStatus,
} from "@/lib/types";
import { PriorityGlyph, StatusGlyph } from "./glyphs";
import {
  blank,
  dateLabel,
  FieldDate,
  FieldLabels,
  FieldMenu,
  NO_SPRINT,
  PRIORITY_ORDER,
  sprintChoices,
  type IssueFieldOptions,
} from "./issue-fields";

export type { IssueFieldOptions };

/**
 * One property, as a chip.
 *
 * An unset field wears its own name, so the row reads as a list of what can
 * be set. A set field wears the value instead, and nothing is labelled twice.
 */
function Chip({
  icon,
  children,
  set,
  className,
  ...rest
}: {
  icon?: React.ReactNode;
  /** Base UI hands these in when the chip is a menu trigger. */
  children?: React.ReactNode;
  /** Whether the field holds a value. An empty one reads quieter. */
  set?: boolean;
  className?: string;
} & React.ComponentProps<"button">) {
  return (
    <button
      type="button"
      className={cn(
        "border-border/70 hover:bg-sidebar-accent focus-visible:ring-ring inline-flex h-7 max-w-52 shrink-0 cursor-pointer items-center gap-1.5 rounded-full border px-2.5 text-xs whitespace-nowrap focus-visible:ring-2 focus-visible:outline-none",
        set ? "text-foreground" : "text-muted-foreground",
        className
      )}
      {...rest}
    >
      {icon}
      <span className="min-w-0 truncate">{children}</span>
    </button>
  );
}

/** On, the form stays open and takes the next issue. */
function CreateMore({
  on,
  onChange,
}: {
  on: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className="focus-visible:ring-ring text-muted-foreground flex cursor-pointer items-center gap-2 rounded-sm text-xs focus-visible:ring-2 focus-visible:outline-none"
    >
      <span
        aria-hidden="true"
        className={cn(
          "flex h-4 w-7 shrink-0 items-center rounded-full p-0.5 transition-colors",
          on ? "bg-primary" : "bg-muted"
        )}
      >
        <span
          className={cn(
            "bg-background size-3 rounded-full transition-transform",
            on && "translate-x-3"
          )}
        />
      </span>
      Create more
    </button>
  );
}

export function IssueDialog({
  currentSprintId,
  options,
  open,
  onOpenChange,
  onSubmit,
}: {
  /** Where a new row goes, whatever sprint the page happens to show. */
  currentSprintId: string | null;
  options: IssueFieldOptions;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The row arrives with an empty key. The page assigns it. */
  onSubmit: (issue: Issue) => void;
}) {
  const [draft, setDraft] = useState<Issue>(blank(currentSprintId, options));
  const [more, setMore] = useState(false);
  const set = (change: Partial<Issue>) =>
    setDraft((current) => ({ ...current, ...change }));

  const sprint = sprintChoices(options);
  const sprintName = draft.sprintId ? sprint.labels[draft.sprintId] : null;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const title = draft.title.trim();
    if (!title) return;
    onSubmit({ ...draft, title });

    if (more) {
      // The placement holds, because somebody filing several issues is
      // filing them into the same place.
      setDraft({
        ...blank(currentSprintId, options),
        project: draft.project,
        space: draft.space,
        sprintId: draft.sprintId,
        assignee: draft.assignee,
      });
      return;
    }
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 p-0 sm:max-w-2xl">
        <DialogTitle className="sr-only">New issue</DialogTitle>
        <DialogDescription className="sr-only">
          It joins the current sprint. Nothing reaches Jira yet.
        </DialogDescription>

        <form onSubmit={submit} className="flex flex-col">
          <div className="flex items-center gap-1.5 px-3 pt-3 pr-12 pb-1">
            <FieldMenu
              name="Project"
              options={options.projects}
              labels={Object.fromEntries(
                options.projects.map((name) => [name, name])
              )}
              onChange={(project) =>
                set({ project, space: options.spaceOf(project) })
              }
              trigger={
                <Chip
                  icon={
                    <FolderKanbanIcon className="size-3.5" aria-hidden="true" />
                  }
                  set
                >
                  {draft.project}
                </Chip>
              }
            />
            <span className="text-muted-foreground text-xs" aria-hidden="true">
              &rsaquo;
            </span>
            <FieldMenu
              name="Sprint"
              options={sprint.options}
              labels={sprint.labels}
              onChange={(id) => set({ sprintId: id === NO_SPRINT ? null : id })}
              trigger={
                <Chip
                  icon={<RocketIcon className="size-3.5" aria-hidden="true" />}
                  set={Boolean(sprintName)}
                >
                  {sprintName ?? "No sprint"}
                </Chip>
              }
            />
          </div>

          {/* The title and the description carry no borders. The room they
              sit in is the field, which is what makes them the subject. */}
          <div className="flex flex-col gap-1 px-4 pt-2 pb-4">
            <input
              value={draft.title}
              onChange={(event) => set({ title: event.target.value })}
              placeholder="Issue title"
              aria-label="Issue title"
              autoComplete="off"
              autoFocus
              className="placeholder:text-muted-foreground/70 w-full bg-transparent text-lg font-medium outline-none"
            />
            <textarea
              value={draft.description}
              onChange={(event) => set({ description: event.target.value })}
              placeholder="Add description..."
              aria-label="Description"
              rows={3}
              className="placeholder:text-muted-foreground/70 field-sizing-content max-h-64 min-h-16 w-full resize-none bg-transparent text-sm outline-none"
            />
          </div>

          <div className="flex flex-wrap items-center gap-1.5 px-3 pb-3">
            <FieldMenu
              name="Status"
              options={STATUS_ORDER}
              labels={STATUS_LABELS}
              glyphs={(status: IssueStatus) => <StatusGlyph status={status} />}
              onChange={(status: IssueStatus) => set({ status })}
              trigger={
                <Chip icon={<StatusGlyph status={draft.status} />} set>
                  {STATUS_LABELS[draft.status]}
                </Chip>
              }
            />
            <FieldMenu
              name="Priority"
              options={PRIORITY_ORDER}
              labels={ISSUE_PRIORITY_LABELS}
              glyphs={(priority: IssuePriority) => (
                <PriorityGlyph priority={priority} silent />
              )}
              onChange={(priority: IssuePriority) => set({ priority })}
              trigger={
                <Chip
                  icon={<PriorityGlyph priority={draft.priority} silent />}
                  set={draft.priority !== "none"}
                >
                  {draft.priority === "none"
                    ? "Priority"
                    : ISSUE_PRIORITY_LABELS[draft.priority]}
                </Chip>
              }
            />
            <FieldMenu
              name="Assignee"
              options={options.assignees}
              labels={Object.fromEntries(
                options.assignees.map((name) => [name, name])
              )}
              onChange={(assignee) => set({ assignee })}
              trigger={
                <Chip
                  icon={
                    <UserRoundIcon className="size-3.5" aria-hidden="true" />
                  }
                  set
                >
                  {draft.assignee}
                </Chip>
              }
            />

            <FieldDate
              name="Start"
              value={draft.start}
              onChange={(start) => set({ start })}
              trigger={
                <Chip
                  icon={
                    <CalendarArrowUpIcon
                      className="size-3.5"
                      aria-hidden="true"
                    />
                  }
                  set={Boolean(draft.start)}
                >
                  {dateLabel(draft.start, "Start")}
                </Chip>
              }
            />
            <FieldDate
              name="Due"
              value={draft.due}
              onChange={(due) => set({ due })}
              trigger={
                <Chip
                  icon={
                    <CalendarArrowDownIcon
                      className="size-3.5"
                      aria-hidden="true"
                    />
                  }
                  set={Boolean(draft.due)}
                >
                  {dateLabel(draft.due, "Due")}
                </Chip>
              }
            />

            <FieldLabels
              all={options.labels}
              chosen={draft.labels}
              onChange={(labels) => set({ labels })}
              trigger={
                <Chip
                  icon={<TagIcon className="size-3.5" aria-hidden="true" />}
                  set={draft.labels.length > 0}
                >
                  {draft.labels.length === 0
                    ? "Labels"
                    : draft.labels.length === 1
                      ? draft.labels[0]
                      : `${draft.labels.length} labels`}
                </Chip>
              }
            />
          </div>

          <footer className="border-border/70 flex items-center justify-end gap-3 border-t px-3 py-2.5">
            <CreateMore on={more} onChange={setMore} />
            <Button type="submit" disabled={!draft.title.trim()}>
              Create issue
            </Button>
          </footer>
        </form>
      </DialogContent>
    </Dialog>
  );
}
