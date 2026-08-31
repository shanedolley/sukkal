"use client";

// The parts a create form and a detail view both need.
//
// The two screens look nothing alike: one is a box that asks for a title, the
// other is a page that shows everything. What they share is the set of
// choices behind each field, and those belong in one place or they drift.

import { useState } from "react";

import { formatShortDay } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { Issue, IssuePriority, Space } from "@/lib/types";
import { dotFor } from "./glyphs";

export const PRIORITY_ORDER: IssuePriority[] = [
  "urgent",
  "high",
  "medium",
  "low",
  "none",
];

/** A menu carries no null, so the empty sprint travels as a word. */
export const NO_SPRINT = "__none__";

export interface IssueFieldOptions {
  projects: string[];
  assignees: string[];
  labels: string[];
  sprints: { id: string; name: string }[];
  /** Who a new row goes to. Alphabetical order would pick a colleague. */
  defaultAssignee: string;
  /** Which space each project belongs to, so a row inherits one. */
  spaceOf: (project: string) => Space;
}

/**
 * Everything a new row starts with.
 *
 * The key is left empty. Jira hands out the real one, and until then the page
 * assigns a draft key at the moment of saving, which is what lets the create
 * form stay open and write a second row.
 */
export function blank(sprintId: string | null, o: IssueFieldOptions): Issue {
  const project = o.projects[0] ?? "Personal";
  return {
    key: "",
    title: "",
    description: "",
    status: "backlog",
    priority: "none",
    project,
    space: o.spaceOf(project),
    labels: [],
    assignee: o.defaultAssignee,
    start: null,
    due: null,
    updated: new Date().toISOString().slice(0, 10),
    sprintId,
    blocks: [],
  };
}

/** The sprint menu's options and labels, with the empty one on the end. */
export function sprintChoices(o: IssueFieldOptions) {
  return {
    options: [...o.sprints.map((sprint) => sprint.id), NO_SPRINT],
    labels: {
      ...Object.fromEntries(o.sprints.map((s) => [s.id, s.name])),
      [NO_SPRINT]: "No sprint",
    } as Record<string, string>,
  };
}

type Trigger = React.ReactElement<Record<string, unknown>>;

/** A menu of one choice, behind whatever trigger the screen supplies. */
export function FieldMenu<T extends string>({
  name,
  trigger,
  options,
  labels,
  glyphs,
  onChange,
}: {
  name: string;
  trigger: Trigger;
  options: readonly T[];
  labels: Record<T, string>;
  /** A mark drawn beside each option, such as the status circle. */
  glyphs?: (option: T) => React.ReactNode;
  onChange: (value: T) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={trigger} aria-label={name} />
      <DropdownMenuContent align="start" className="min-w-44">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{name}</DropdownMenuLabel>
          {options.map((option) => (
            <DropdownMenuItem key={option} onClick={() => onChange(option)}>
              {glyphs?.(option)}
              {labels[option]}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The browser's own date field, behind whatever trigger the screen gives. */
export function FieldDate({
  name,
  trigger,
  value,
  onChange,
}: {
  name: string;
  trigger: Trigger;
  value: string | null;
  onChange: (date: string | null) => void;
}) {
  return (
    <Popover>
      <PopoverTrigger render={trigger} aria-label={name} />
      <PopoverContent align="start" className="w-56 gap-2 p-2.5">
        <p className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
          {name}
        </p>
        <Input
          type="date"
          aria-label={name}
          value={value ?? ""}
          onChange={(event) => onChange(event.target.value || null)}
        />
        <Button variant="outline" size="sm" onClick={() => onChange(null)}>
          Clear the date
        </Button>
      </PopoverContent>
    </Popover>
  );
}

/** Labels add and take away rather than replace, so the menu stays open. */
export function FieldLabels({
  trigger,
  all,
  chosen,
  onChange,
}: {
  trigger: Trigger;
  all: string[];
  chosen: string[];
  onChange: (labels: string[]) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={trigger} aria-label="Labels" />
      <DropdownMenuContent align="start" className="min-w-44">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Labels</DropdownMenuLabel>
          {all.map((label) => {
            const on = chosen.includes(label);
            return (
              <DropdownMenuCheckboxItem
                key={label}
                checked={on}
                closeOnClick={false}
                onCheckedChange={() =>
                  onChange(
                    on
                      ? chosen.filter((one) => one !== label)
                      : [...chosen, label]
                  )
                }
              >
                <span
                  className={cn("size-1.5 shrink-0 rounded-full", dotFor(label))}
                  aria-hidden="true"
                />
                {label}
              </DropdownMenuCheckboxItem>
            );
          })}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** How a date reads on a control: the date itself, or the field's name. */
export const dateLabel = (value: string | null, name: string) =>
  value ? formatShortDay(value) : name;

/**
 * Removal, behind a question that names what goes with it.
 *
 * The consequences come first, because they are the part nobody has in mind:
 * a parent takes its children's parent with it, and a blocker takes the link
 * that says so. Then the control.
 */
export function DeleteIssues({
  trigger,
  keys,
  issues,
  onConfirm,
}: {
  trigger: Trigger;
  /** The rows to go. */
  keys: string[];
  /** Every row the page knows, for working out what else is touched. */
  issues: Issue[];
  onConfirm: () => void;
}) {
  const [open, setOpen] = useState(false);
  const going = new Set(keys);
  const listed = keys.slice(0, 8);
  const rest = keys.length - listed.length;

  const orphans = issues.filter(
    (one) => one.parent && going.has(one.parent) && !going.has(one.key)
  ).length;
  const links = issues.filter(
    (one) => !going.has(one.key) && one.blocks.some((key) => going.has(key))
  ).length;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {keys.length === 1
              ? `Delete ${keys[0]}?`
              : `Delete ${keys.length} issues?`}
          </DialogTitle>
          <DialogDescription>
            A deletion in Jira cannot be undone. Nothing reaches Jira yet, so
            these rows come back on a reload.
          </DialogDescription>
        </DialogHeader>

        {keys.length > 1 && (
          <p className="text-muted-foreground font-mono text-xs">
            {listed.join(", ")}
            {rest > 0 ? `, and ${rest} more` : ""}
          </p>
        )}

        {(orphans > 0 || links > 0) && (
          <ul className="text-muted-foreground flex flex-col gap-1 text-xs">
            {orphans > 0 && (
              <li>
                {orphans === 1
                  ? "One sub-task stays and loses its parent."
                  : `${orphans} sub-tasks stay and lose their parent.`}
              </li>
            )}
            {links > 0 && (
              <li>
                {links === 1
                  ? "One issue links to these. That link goes too."
                  : `${links} issues link to these. Those links go too.`}
              </li>
            )}
          </ul>
        )}

        <DialogFooter>
          <DialogClose render={<Button variant="outline" type="button" />}>
            Keep them
          </DialogClose>
          <Button
            variant="destructive"
            onClick={() => {
              onConfirm();
              setOpen(false);
            }}
          >
            {keys.length === 1 ? "Yes, delete it" : `Yes, delete ${keys.length}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
