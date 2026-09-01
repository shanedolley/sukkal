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
  ArrowLeftIcon,
  CalendarArrowDownIcon,
  CalendarArrowUpIcon,
  FolderKanbanIcon,
  PencilLineIcon,
  RocketIcon,
  SparklesIcon,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { STATUS_LABELS, STATUS_ORDER } from "@/lib/issue-view";
import {
  ISSUE_KIND_LABELS,
  ISSUE_PRIORITY_LABELS,
  PARENT_KIND,
  type Issue,
  type IssueKind,
  type IssuePriority,
  type IssueStatus,
} from "@/lib/types";
import { missingFields, useProjectFields } from "@/lib/project-fields";
import { PriorityGlyph, StatusGlyph } from "./glyphs";
import {
  blank,
  CustomFieldInputs,
  dateLabel,
  DescriptionField,
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
        className,
      )}
      {...rest}
    >
      {icon}
      <span className="min-w-0 truncate">{children}</span>
    </button>
  );
}

/** One way in, as a card. */
function HowCard({
  icon,
  title,
  lede,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  lede: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="border-border/70 hover:border-primary/60 hover:bg-sidebar-accent focus-visible:ring-ring flex cursor-pointer flex-col items-start gap-2 rounded-lg border p-4 text-left transition-colors focus-visible:ring-2 focus-visible:outline-none"
    >
      <span className="text-primary" aria-hidden="true">
        {icon}
      </span>
      <span className="text-sm font-medium">{title}</span>
      <span className="text-muted-foreground text-xs">{lede}</span>
    </button>
  );
}

const KIND_ORDER: IssueKind[] = ["epic", "story", "subtask"];

/**
 * What the new issue hangs off.
 *
 * The border says what is being picked without a second label: violet for an
 * epic, yellow for a story, the same two colours the rest of the app gives
 * them. An epic hangs off nothing, so it has no field at all.
 */
function ParentField({
  kind,
  project,
  issues,
  value,
  onChange,
}: {
  kind: IssueKind;
  project: string;
  issues: Issue[];
  value: string | undefined;
  onChange: (parent: string | undefined) => void;
}) {
  const wanted = PARENT_KIND[kind];
  if (!wanted) return null;

  const choices = issues.filter(
    (issue) => issue.kind === wanted && issue.project === project,
  );
  const noun = ISSUE_KIND_LABELS[wanted].toLowerCase();
  const label = (key: string) => {
    const found = choices.find((issue) => issue.key === key);
    return found ? `${found.key} · ${found.title}` : key;
  };

  if (choices.length === 0) {
    return (
      <span className="text-muted-foreground text-xs">
        No {noun} on {project} yet.
      </span>
    );
  }

  return (
    <Select
      value={value ?? ""}
      onValueChange={(next) => onChange((next as string) || undefined)}
    >
      <SelectTrigger
        aria-label={`Parent ${noun}`}
        className={cn(
          "max-w-72 min-w-48",
          wanted === "epic" ? "border-info" : "border-warning",
        )}
      >
        <SelectValue placeholder={`Choose a parent ${noun}`}>
          {(chosen: string | null) =>
            chosen ? label(chosen) : `Choose a parent ${noun}`
          }
        </SelectValue>
      </SelectTrigger>
      <SelectContent
        alignItemWithTrigger={false}
        className="max-w-96 min-w-(--anchor-width)"
      >
        {choices.map((issue) => (
          <SelectItem key={issue.key} value={issue.key}>
            <span className="truncate">
              {issue.key} · {issue.title}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
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
          on ? "bg-primary" : "bg-muted",
        )}
      >
        <span
          className={cn(
            "bg-background size-3 rounded-full transition-transform",
            on && "translate-x-3",
          )}
        />
      </span>
      Create more
    </button>
  );
}

type Step = "how" | "manual" | "ai";

export function IssueDialog({
  currentSprintId,
  options,
  issues,
  open,
  onOpenChange,
  onSubmit,
}: {
  /** Where a new row goes, whatever sprint the page happens to show. */
  currentSprintId: string | null;
  options: IssueFieldOptions;
  /** Everything already filed, so a new row can be hung off one of them. */
  issues: Issue[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The row arrives with an empty key. The page assigns it. */
  onSubmit: (issue: Issue) => void;
}) {
  const [draft, setDraft] = useState<Issue>(blank(currentSprintId, options));
  const [step, setStep] = useState<Step>("how");
  const [more, setMore] = useState(false);
  // Set once the reader has tried to file, so an empty form is not scolded
  // before it has been filled in.
  const [tried, setTried] = useState(false);
  const set = (change: Partial<Issue>) =>
    setDraft((current) => ({ ...current, ...change }));

  // The project's own fields, which change the moment the project does.
  const custom = useProjectFields(draft.project);
  const missing = missingFields(custom, draft.fields);

  const sprint = sprintChoices(options);
  const sprintName = draft.sprintId ? sprint.labels[draft.sprintId] : null;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const title = draft.title.trim();
    setTried(true);
    // A required field is the project's rule, not this form's. Filing without
    // one produces an issue nobody downstream can act on.
    if (!title || missing.length > 0) return;
    onSubmit({ ...draft, title });

    if (more) {
      // The placement holds, because somebody filing several issues is
      // filing them into the same place.
      setTried(false);
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
        {step === "how" && (
          <div className="flex flex-col gap-4 p-6">
            <div className="flex flex-col gap-1">
              <DialogTitle className="text-base">New issue</DialogTitle>
              <DialogDescription className="text-muted-foreground text-sm">
                How do you want to write it?
              </DialogDescription>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <HowCard
                icon={<PencilLineIcon className="size-5" />}
                title="Write it yourself"
                lede="Fill in the title, the description and the rest by hand."
                onClick={() => setStep("manual")}
              />
              <HowCard
                icon={<SparklesIcon className="size-5" />}
                title="Write it with AI"
                lede="Say what you want and let the assistant draft the issue."
                onClick={() => setStep("ai")}
              />
            </div>
          </div>
        )}

        {step === "ai" && (
          <div className="flex flex-col gap-4 p-6">
            <div className="flex flex-col gap-1">
              <DialogTitle className="text-base">Write it with AI</DialogTitle>
              <DialogDescription className="text-muted-foreground text-sm">
                This is a placeholder. Nothing reaches a model yet, so there is
                nothing here to type into.
              </DialogDescription>
            </div>
            <div>
              <Button
                type="button"
                variant="outline"
                onClick={() => setStep("how")}
              >
                <ArrowLeftIcon aria-hidden="true" />
                Back
              </Button>
            </div>
          </div>
        )}

        {step === "manual" && (
          <>
            <DialogTitle className="sr-only">New issue</DialogTitle>
            <DialogDescription className="sr-only">
              It joins the current sprint. Nothing reaches Jira yet.
            </DialogDescription>

            <form onSubmit={submit} className="flex flex-col">
              <div className="flex items-center gap-1.5 px-3 pt-3 pr-12 pb-1">
                <button
                  type="button"
                  onClick={() => setStep("how")}
                  aria-label="Back"
                  title="Back"
                  className="hover:bg-sidebar-accent focus-visible:ring-ring text-muted-foreground -ml-1 flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md focus-visible:ring-2 focus-visible:outline-none"
                >
                  <ArrowLeftIcon className="size-3.5" aria-hidden="true" />
                </button>
                <FieldMenu
                  name="Project"
                  options={options.projects}
                  labels={Object.fromEntries(
                    options.projects.map((name) => [name, name]),
                  )}
                  onChange={(project) =>
                    set({ project, space: options.spaceOf(project) })
                  }
                  trigger={
                    <Chip
                      icon={
                        <FolderKanbanIcon
                          className="size-3.5"
                          aria-hidden="true"
                        />
                      }
                      set
                    >
                      {draft.project}
                    </Chip>
                  }
                />
                <span
                  className="text-muted-foreground text-xs"
                  aria-hidden="true"
                >
                  &rsaquo;
                </span>
                <FieldMenu
                  name="Sprint"
                  options={sprint.options}
                  labels={sprint.labels}
                  onChange={(id) =>
                    set({ sprintId: id === NO_SPRINT ? null : id })
                  }
                  trigger={
                    <Chip
                      icon={
                        <RocketIcon className="size-3.5" aria-hidden="true" />
                      }
                      set={Boolean(sprintName)}
                    >
                      {sprintName ?? "No sprint"}
                    </Chip>
                  }
                />
              </div>

              {/* What is being filed, and what it hangs off. Both sit above the
              title, because they decide what the title has to say. */}
              <div className="flex flex-wrap items-center gap-2 px-3 pt-2">
                <Tabs
                  value={draft.kind}
                  onValueChange={(next) =>
                    // A story's epic is no parent for a sub-task, so the choice
                    // goes with the kind it was made under.
                    set({ kind: next as IssueKind, parent: undefined })
                  }
                >
                  <TabsList aria-label="Issue kind">
                    {KIND_ORDER.map((kind) => (
                      <TabsTrigger key={kind} value={kind}>
                        {ISSUE_KIND_LABELS[kind]}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </Tabs>

                <ParentField
                  kind={draft.kind}
                  project={draft.project}
                  issues={issues}
                  value={draft.parent}
                  onChange={(parent) => set({ parent })}
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
                <DescriptionField
                  value={draft.description}
                  onChange={(description) => set({ description })}
                  rows={3}
                  className="max-h-64 min-h-16"
                />
              </div>

              {custom.length > 0 && (
                <div className="border-border/70 flex flex-col gap-3 border-t px-4 py-3">
                  <CustomFieldInputs
                    fields={custom}
                    values={draft.fields}
                    onChange={(fields) => set({ fields })}
                    showMissing={tried}
                  />
                  {tried && missing.length > 0 && (
                    <p className="text-destructive text-xs" role="alert">
                      {missing.map((field) => field.name).join(" and ")}{" "}
                      {missing.length === 1 ? "is" : "are"} required on a{" "}
                      {draft.project} issue.
                    </p>
                  )}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-1.5 px-3 pt-3 pb-3">
                <FieldMenu
                  name="Status"
                  options={STATUS_ORDER}
                  labels={STATUS_LABELS}
                  glyphs={(status: IssueStatus) => (
                    <StatusGlyph status={status} />
                  )}
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
                    options.assignees.map((name) => [name, name]),
                  )}
                  onChange={(assignee) => set({ assignee })}
                  trigger={
                    <Chip
                      icon={
                        <UserRoundIcon
                          className="size-3.5"
                          aria-hidden="true"
                        />
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
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
