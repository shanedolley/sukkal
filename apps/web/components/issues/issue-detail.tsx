"use client";

// One issue, at length.
//
// The shape follows Linear's issue page: a breadcrumb across the top, the
// title and the description taking the width, and every property stacked in
// a rail on the right. Nothing here has a Save button, because every change
// lands as it is made. A form that holds a change until you press a button
// is a form that loses it when you close the window.
//
// Two things the reference shows and this cannot. There is no activity feed,
// because no event log exists to read one from, and no comments, because
// nothing stores them. Inventing either would fill the screen with things
// that never happened.

import {
  CalendarArrowDownIcon,
  CalendarArrowUpIcon,
  FolderKanbanIcon,
  PlusIcon,
  RocketIcon,
  TagIcon,
  Trash2Icon,
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
import { dotFor, PriorityGlyph, StatusGlyph } from "./glyphs";
import {
  dateLabel,
  DeleteIssues,
  FieldDate,
  FieldLabels,
  FieldMenu,
  NO_SPRINT,
  PRIORITY_ORDER,
  sprintChoices,
  type IssueFieldOptions,
} from "./issue-fields";

/** A row in the rail. It reads as a value, and opens a menu when pressed. */
function RailButton({
  icon,
  children,
  set = true,
  className,
  ...rest
}: {
  icon?: React.ReactNode;
  children?: React.ReactNode;
  /** An empty field reads quieter, and wears its own name instead. */
  set?: boolean;
  className?: string;
} & React.ComponentProps<"button">) {
  return (
    <button
      type="button"
      className={cn(
        "hover:bg-sidebar-accent focus-visible:ring-ring -mx-2 flex w-[calc(100%+1rem)] cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm focus-visible:ring-2 focus-visible:outline-none",
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

function RailHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-muted-foreground text-xs font-medium">{children}</h3>
  );
}

/** One issue named on another: the parent, a sub-task, or a dependency. */
function IssueLink({
  issue,
  onOpen,
  className,
}: {
  issue: Issue;
  onOpen: (issue: Issue) => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(issue)}
      className={cn(
        "hover:bg-sidebar-accent focus-visible:ring-ring -mx-2 flex w-[calc(100%+1rem)] cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm focus-visible:ring-2 focus-visible:outline-none",
        className
      )}
    >
      <StatusGlyph status={issue.status} />
      <span className="text-muted-foreground shrink-0 font-mono text-xs">
        {issue.key}
      </span>
      <span className="min-w-0 truncate">{issue.title}</span>
    </button>
  );
}

export function IssueDetail({
  issue,
  issues,
  options,
  open,
  onOpenChange,
  onChange,
  onOpen,
  onDelete,
}: {
  issue: Issue;
  /** Every row the page knows, for the parent, the sub-tasks and the links. */
  issues: Issue[];
  options: IssueFieldOptions;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Applied at once. Nothing here waits for a button. */
  onChange: (change: Partial<Issue>) => void;
  /** Follow a link to another issue, which reopens this view on that row. */
  onOpen: (issue: Issue) => void;
  /** Take this row out for good. The page closes the view after it. */
  onDelete: () => void;
}) {
  const byKey = new Map(issues.map((one) => [one.key, one]));
  const parent = issue.parent ? byKey.get(issue.parent) : undefined;
  const children = issues.filter((one) => one.parent === issue.key);
  const done = children.filter((one) => one.status === "done").length;

  const blocking = issue.blocks
    .map((key) => byKey.get(key))
    .filter((one): one is Issue => Boolean(one));
  const blockedBy = issues.filter((one) => one.blocks.includes(issue.key));

  const sprint = sprintChoices(options);
  const sprintName = issue.sprintId
    ? (sprint.labels[issue.sprintId] ?? issue.sprintId)
    : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] gap-0 overflow-hidden p-0 sm:max-w-4xl">
        <DialogTitle className="sr-only">{issue.title}</DialogTitle>
        <DialogDescription className="sr-only">
          Every change holds for this session. Nothing reaches Jira yet.
        </DialogDescription>

        {/* Where the issue sits, before what it is. */}
        <div className="border-border/70 text-muted-foreground flex items-center gap-1.5 border-b px-4 py-2.5 pr-12 text-xs">
          <FolderKanbanIcon className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">{issue.project}</span>
          <span aria-hidden="true">›</span>
          <span className="truncate">{sprintName ?? "No sprint"}</span>
          <span aria-hidden="true">›</span>
          <span className="text-foreground shrink-0 font-mono">
            {issue.key}
          </span>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto md:grid-cols-[minmax(0,1fr)_18rem]">
          {/* ── What the issue is ── */}
          <div className="flex min-w-0 flex-col gap-4 px-5 py-5">
            <textarea
              value={issue.title}
              onChange={(event) => onChange({ title: event.target.value })}
              aria-label="Issue title"
              rows={1}
              className="placeholder:text-muted-foreground/70 field-sizing-content w-full resize-none bg-transparent text-2xl leading-tight font-semibold tracking-tight outline-none"
              placeholder="Issue title"
            />

            {parent && (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-muted-foreground">Sub-task of</span>
                <IssueLink
                  issue={parent}
                  onOpen={onOpen}
                  className="mx-0 w-auto"
                />
              </div>
            )}

            <textarea
              value={issue.description}
              onChange={(event) =>
                onChange({ description: event.target.value })
              }
              placeholder="Add description..."
              aria-label="Description"
              rows={4}
              className="placeholder:text-muted-foreground/70 field-sizing-content min-h-24 w-full resize-none bg-transparent text-sm leading-relaxed outline-none"
            />

            {children.length > 0 && (
              <section className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <RailHeading>Sub-tasks</RailHeading>
                  <span className="text-muted-foreground text-xs tabular-nums">
                    {done}/{children.length}
                  </span>
                </div>
                {children.map((child) => (
                  <IssueLink key={child.key} issue={child} onOpen={onOpen} />
                ))}
              </section>
            )}
          </div>

          {/* ── Everything about it ── */}
          <aside className="border-border/70 flex flex-col gap-5 px-5 py-5 md:border-l">
            <section className="flex flex-col gap-1">
              {/* The one control here that takes something away sits apart
                  from the ones that change it. */}
              <div className="flex items-center justify-between gap-2">
                <RailHeading>Properties</RailHeading>
                <DeleteIssues
                  keys={[issue.key]}
                  issues={issues}
                  onConfirm={onDelete}
                  trigger={
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Delete ${issue.key}`}
                      title="Delete this issue"
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <Trash2Icon aria-hidden="true" />
                    </Button>
                  }
                />
              </div>

              <FieldMenu
                name="Status"
                options={STATUS_ORDER}
                labels={STATUS_LABELS}
                glyphs={(status: IssueStatus) => (
                  <StatusGlyph status={status} />
                )}
                onChange={(status: IssueStatus) => onChange({ status })}
                trigger={
                  <RailButton icon={<StatusGlyph status={issue.status} />}>
                    {STATUS_LABELS[issue.status]}
                  </RailButton>
                }
              />

              <FieldMenu
                name="Priority"
                options={PRIORITY_ORDER}
                labels={ISSUE_PRIORITY_LABELS}
                glyphs={(priority: IssuePriority) => (
                  <PriorityGlyph priority={priority} silent />
                )}
                onChange={(priority: IssuePriority) => onChange({ priority })}
                trigger={
                  <RailButton
                    icon={<PriorityGlyph priority={issue.priority} silent />}
                    set={issue.priority !== "none"}
                  >
                    {issue.priority === "none"
                      ? "Set priority"
                      : ISSUE_PRIORITY_LABELS[issue.priority]}
                  </RailButton>
                }
              />

              <FieldMenu
                name="Assignee"
                options={options.assignees}
                labels={Object.fromEntries(
                  options.assignees.map((name) => [name, name])
                )}
                onChange={(assignee) => onChange({ assignee })}
                trigger={
                  <RailButton
                    icon={
                      <UserRoundIcon
                        className="size-3.5 shrink-0"
                        aria-hidden="true"
                      />
                    }
                  >
                    {issue.assignee}
                  </RailButton>
                }
              />

              <FieldDate
                name="Start date"
                value={issue.start}
                onChange={(start) => onChange({ start })}
                trigger={
                  <RailButton
                    icon={
                      <CalendarArrowUpIcon
                        className="size-3.5 shrink-0"
                        aria-hidden="true"
                      />
                    }
                    set={Boolean(issue.start)}
                  >
                    {dateLabel(issue.start, "Set a start date")}
                  </RailButton>
                }
              />

              <FieldDate
                name="Due date"
                value={issue.due}
                onChange={(due) => onChange({ due })}
                trigger={
                  <RailButton
                    icon={
                      <CalendarArrowDownIcon
                        className="size-3.5 shrink-0"
                        aria-hidden="true"
                      />
                    }
                    set={Boolean(issue.due)}
                  >
                    {dateLabel(issue.due, "Set a due date")}
                  </RailButton>
                }
              />
            </section>

            <section className="flex flex-col gap-2">
              <RailHeading>Labels</RailHeading>
              <div className="flex flex-wrap items-center gap-1.5">
                {issue.labels.map((label) => (
                  <span
                    key={label}
                    className="border-border/70 text-foreground inline-flex h-6 items-center gap-1.5 rounded-full border px-2 text-xs"
                  >
                    <span
                      className={cn("size-1.5 rounded-full", dotFor(label))}
                      aria-hidden="true"
                    />
                    {label}
                  </span>
                ))}
                <FieldLabels
                  all={options.labels}
                  chosen={issue.labels}
                  onChange={(labels) => onChange({ labels })}
                  trigger={
                    <button
                      type="button"
                      className="border-border/70 text-muted-foreground hover:bg-sidebar-accent focus-visible:ring-ring inline-flex h-6 cursor-pointer items-center gap-1 rounded-full border px-2 text-xs focus-visible:ring-2 focus-visible:outline-none"
                    >
                      {issue.labels.length === 0 ? (
                        <>
                          <TagIcon className="size-3" aria-hidden="true" />
                          Add a label
                        </>
                      ) : (
                        <PlusIcon className="size-3" aria-hidden="true" />
                      )}
                    </button>
                  }
                />
              </div>
            </section>

            <section className="flex flex-col gap-1">
              <RailHeading>Placement</RailHeading>
              <FieldMenu
                name="Project"
                options={options.projects}
                labels={Object.fromEntries(
                  options.projects.map((name) => [name, name])
                )}
                onChange={(project) =>
                  onChange({ project, space: options.spaceOf(project) })
                }
                trigger={
                  <RailButton
                    icon={
                      <FolderKanbanIcon
                        className="size-3.5 shrink-0"
                        aria-hidden="true"
                      />
                    }
                  >
                    {issue.project}
                  </RailButton>
                }
              />
              <FieldMenu
                name="Sprint"
                options={sprint.options}
                labels={sprint.labels}
                onChange={(id) =>
                  onChange({ sprintId: id === NO_SPRINT ? null : id })
                }
                trigger={
                  <RailButton
                    icon={
                      <RocketIcon
                        className="size-3.5 shrink-0"
                        aria-hidden="true"
                      />
                    }
                    set={Boolean(sprintName)}
                  >
                    {sprintName ?? "No sprint"}
                  </RailButton>
                }
              />
            </section>

            {(blockedBy.length > 0 || blocking.length > 0) && (
              <section className="flex flex-col gap-1">
                <RailHeading>Related</RailHeading>
                {blockedBy.length > 0 && (
                  <p className="text-destructive text-xs">
                    Blocked by {blockedBy.length}
                  </p>
                )}
                {blockedBy.map((one) => (
                  <IssueLink key={one.key} issue={one} onOpen={onOpen} />
                ))}
                {blocking.length > 0 && (
                  <p className="text-muted-foreground mt-1 text-xs">
                    Blocking {blocking.length}
                  </p>
                )}
                {blocking.map((one) => (
                  <IssueLink key={one.key} issue={one} onOpen={onOpen} />
                ))}
              </section>
            )}
          </aside>
        </div>
      </DialogContent>
    </Dialog>
  );
}
