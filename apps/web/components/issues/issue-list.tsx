"use client";

// The sprint list, in the shape Linear uses: one row per issue, grouped by a
// field the reader picks, with the priority on the left and the metadata
// pushed to the right.
//
// The row reads left to right in the order a person scans it. Priority and
// key first, because those pick the row out. Title next, because that is what
// the row is. Everything else is context, so it sits on the right edge where
// it can be ignored.

import { Fragment, useEffect, useRef, useState } from "react";
import {
  ArrowRightToLineIcon,
  CalendarIcon,
  CheckIcon,
  ChevronRightIcon,
  BanIcon,
  CalendarArrowDownIcon,
  CalendarArrowUpIcon,
  CircleDotIcon,
  EyeIcon,
  ArrowUpDownIcon,
  GripVerticalIcon,
  ListFilterIcon,
  MoveRightIcon,
  OctagonXIcon,
  RocketIcon,
  SignalHighIcon,
  TagIcon,
  Trash2Icon,
  UserRoundIcon,
  XIcon,
} from "lucide-react";

import {
  closestCenter,
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { dotFor, KindGlyph, PriorityGlyph, StatusGlyph } from "./glyphs";
import {
  DeleteIssues,
  FieldDates,
  FieldLabels,
  FieldMenu,
  NO_SPRINT,
} from "./issue-fields";
import { RowMenu } from "./row-menu";
import { formatShortDay } from "@/lib/format";
import { createLocalStore } from "@/lib/local-store";
import {
  activeCount,
  applyFilters,
  FILTER_FIELDS,
  flat,
  GROUP_FIELDS,
  GROUP_FIELD_LABELS,
  groupIssues,
  isRowSort,
  ROW_SORT_LABELS,
  rowValues,
  ROW_SORTS,
  sortNodes,
  type RowSort,
  isGroupField,
  nest,
  NOTHING_SELECTED,
  optionsFor,
  select,
  STATUS_LABELS,
  STATUS_ORDER,
  toggleValue,
  type Filters,
  type GroupField,
  type Selection,
  type IssueGroup,
  type IssueNode,
} from "@/lib/issue-view";
import { Badge } from "@/components/reui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ISSUE_PRIORITY_LABELS,
  type Issue,
  type IssueKind,
  type IssuePriority,
  type IssueStatus,
} from "@/lib/types";

/** Urgent first, because a bulk change is usually an escalation. */
const PRIORITY_ORDER: IssuePriority[] = [
  "urgent",
  "high",
  "medium",
  "low",
  "none",
];

/**
 * The box on the left of a row.
 *
 * Hidden until the pointer enters the list, so a list nobody is acting on
 * stays quiet. It keeps its space either way, because a row that widens
 * under the cursor is a row that is hard to click.
 */
function RowCheckbox({
  checked,
  label,
  onPick,
}: {
  checked: boolean;
  label: string;
  onPick: (event: React.MouseEvent) => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={onPick}
      className={cn(
        "focus-visible:ring-ring flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-[3px] border transition-opacity focus-visible:ring-2 focus-visible:outline-none",
        checked
          ? "border-primary bg-primary text-primary-foreground opacity-100"
          : "border-border opacity-0 group-hover/list:opacity-100 focus-visible:opacity-100",
      )}
    >
      {checked && <CheckIcon className="size-3" aria-hidden="true" />}
    </button>
  );
}

/**
 * Left padding per level. A group header sits at level 0, its rows at level 1,
 * and a subgroup takes its rows to level 2. Keeping the three in one place
 * stops a row from drifting out of step with the header above it.
 */
const INDENT = ["", "pl-9", "pl-15"];

function Pill({ children, className, ...rest }: React.ComponentProps<"span">) {
  return (
    <span
      className={cn(
        "border-border/70 text-muted-foreground inline-flex h-5 min-w-0 items-center gap-1 truncate rounded-full border px-1.5 text-[11px] leading-none whitespace-nowrap",
        className,
      )}
      {...rest}
    >
      {children}
    </span>
  );
}

/**
 * A mark on a row that opens a menu.
 *
 * The row selects on a modifier click. Without the guard the same click would
 * both select the row and open the menu, so nothing here lets a click through.
 */
function RowTrigger({
  label,
  className,
  children,
  ...rest
}: {
  label: string;
  className?: string;
  children?: React.ReactNode;
} & React.ComponentProps<"button">) {
  return (
    <button
      type="button"
      onClick={(event) => event.stopPropagation()}
      title={label}
      aria-label={label}
      className={cn(
        "neon-edge hover:bg-sidebar-accent focus-visible:ring-ring -m-1 flex shrink-0 cursor-pointer items-center rounded-sm p-1 focus-visible:ring-2 focus-visible:outline-none",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

/**
 * The sprint, as a mark rather than a sentence.
 *
 * A pill reading "Sprint 41" on every row is the same eleven characters
 * repeated down the page. The number alone carries it, and the square beside
 * the assignee says the row belongs to a sprint at all, which is the thing
 * worth seeing at a glance.
 */
function SprintBadge({ name }: { name?: string }) {
  // Jira names a sprint for its number. Anything else falls back to its first
  // letters, so a sprint called "Hardening" still gets a mark.
  const mark = name
    ? (name.match(/\d+/)?.[0] ?? name.slice(0, 2).toUpperCase())
    : "";

  return (
    <span
      className={cn(
        "flex size-5 shrink-0 items-center justify-center rounded-[5px] border text-[10px] font-medium tabular-nums",
        name
          ? "border-border/70 text-muted-foreground"
          : // No sprint means no mark at rest. The empty slot appears with
            // the boxes, so a row can still be given one from here.
            "border-border/60 border-dashed opacity-0 group-hover/list:opacity-100",
      )}
      aria-hidden="true"
    >
      {mark}
    </span>
  );
}

/** Two initials, because the fixtures carry names and not photographs. */
function Assignee({ name }: { name: string }) {
  const initials = name
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("");

  return (
    <span
      title={name}
      className="bg-muted text-muted-foreground flex size-5 shrink-0 items-center justify-center rounded-full text-[9px] font-medium"
    >
      <span aria-hidden="true">{initials}</span>
      <span className="sr-only">{name}</span>
    </span>
  );
}

/**
 * The two dates as one range: 19 Aug -> 28 Aug.
 *
 * A missing date leaves its side of the arrow empty rather than dropping the
 * arrow, so the range reads as open at that end instead of absent.
 *
 * The badge is also how the dates are set. Which half was clicked decides
 * which box the popover opens on, because a person reaching for the due date
 * is not asking to be put in front of the start date first.
 */
function DateRange({
  start,
  due,
  today,
  onChange,
}: {
  start: string | null;
  due: string | null;
  today: string;
  onChange: (dates: { start?: string | null; due?: string | null }) => void;
}) {
  const [field, setField] = useState<"start" | "due">("due");

  // Three days is the point at which a date stops being background and starts
  // being a thing to do. Past that, red.
  const pressing =
    due !== null &&
    (new Date(due).getTime() - new Date(today).getTime()) / 86_400_000 <= 3;

  const said = start
    ? due
      ? `Runs ${formatShortDay(start)} to ${formatShortDay(due)}`
      : `Starts ${formatShortDay(start)}, no due date`
    : due
      ? `Due ${formatShortDay(due)}, no start date`
      : "No dates";

  return (
    <FieldDates
      start={start}
      due={due}
      field={field}
      onChange={onChange}
      trigger={
        <RowTrigger
          label={`${said}. Click to change.`}
          onClick={(event) => {
            event.stopPropagation();
            // The halves are plain spans, so the badge stays one button and
            // the keyboard reaches it once. The mark under the pointer says
            // which end was meant; anything else means the due date.
            const half = (event.target as HTMLElement).closest("[data-half]");
            setField(
              half?.getAttribute("data-half") === "start" ? "start" : "due",
            );
          }}
        >
          {start || due ? (
            <Pill
              className={cn(
                pressing &&
                  "border-destructive/40 bg-destructive/10 text-destructive",
              )}
            >
              <CalendarIcon className="size-3 shrink-0" aria-hidden="true" />
              {start && (
                <span data-half="start" className="shrink-0">
                  {formatShortDay(start)}
                </span>
              )}
              <MoveRightIcon className="size-4 shrink-0" aria-hidden="true" />
              {due && (
                <span data-half="due" className="shrink-0">
                  {formatShortDay(due)}
                </span>
              )}
            </Pill>
          ) : (
            // No date means no pill at rest. The empty slot appears with the
            // boxes, so a row can still be given one from here.
            <CalendarIcon
              className="text-muted-foreground size-3.5 opacity-0 group-hover/list:opacity-100"
              aria-hidden="true"
            />
          )}
        </RowTrigger>
      }
    />
  );
}

/** "1 issue", "3 issues". A count beside a bare noun reads as a typo. */
function count(many: number): string {
  return `${many} ${many === 1 ? "issue" : "issues"}`;
}

/**
 * The keys behind the count.
 *
 * The pill says how many, which is the number a reader scans for. Hovering
 * spells that out, because a bare numeral beside an arrow is a guess. Opening
 * the list takes a click, because the list is a set of things to go to and
 * nobody wants one thrown at them for passing the pointer over a row.
 */
function LinkedIssues({
  said,
  keys,
  byKey,
  onOpenKey,
  pill,
}: {
  /** What the mark means, in words. Both the tooltip and the label use it. */
  said: string;
  keys: string[];
  /** Every issue on the board, for the titles and for what a click opens. */
  byKey: Map<string, Issue>;
  onOpenKey: (key: string) => void;
  pill: React.ReactElement;
}) {
  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={pill}
              aria-label={`${said}. Open the list.`}
              // The row selects on a modifier click. Without this the same
              // click would both select the row and open the list.
              onClick={(event: React.MouseEvent) => event.stopPropagation()}
            />
          }
        />
        <TooltipContent>{said}</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="w-72 gap-0.5 p-1.5">
        <p className="text-muted-foreground px-1.5 py-1 text-[11px] font-medium tracking-wide uppercase">
          {said}
        </p>
        {keys.map((key) => {
          const linked = byKey.get(key);
          // A link can point at an issue no filter on this page would ever
          // show, or at another board entirely. The key is still worth
          // printing; it is just not worth a click that goes nowhere.
          if (!linked) {
            return (
              <p
                key={key}
                className="text-muted-foreground px-1.5 py-1 font-mono"
              >
                {key}
              </p>
            );
          }
          return (
            <button
              key={key}
              type="button"
              onClick={() => onOpenKey(key)}
              className="hover:bg-sidebar-accent focus-visible:ring-ring flex w-full cursor-pointer items-baseline gap-2 rounded-sm px-1.5 py-1 text-left focus-visible:ring-2 focus-visible:outline-none"
            >
              <span className="text-muted-foreground shrink-0 font-mono">
                {key}
              </span>
              <span className="truncate">{linked.title}</span>
            </button>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}

/**
 * What is holding this row up, or what it is holding up.
 *
 * Only one shows. Blocked by is the one that stops work, so it wins the slot
 * and takes the red. Blocking takes the yellow: it is not stopping this row,
 * but it is stopping somebody, which is more than context.
 *
 * The mark carries the direction and the colour carries the severity, so the
 * pill spends no width on words. The tooltip says them instead, which serves
 * the reader who cannot see a colour or an arrow as well as the one who can.
 */
function Dependency({
  blockedBy,
  blocks,
  byKey,
  onOpenKey,
}: {
  blockedBy: string[];
  blocks: string[];
  byKey: Map<string, Issue>;
  onOpenKey: (key: string) => void;
}) {
  if (blockedBy.length > 0) {
    return (
      <LinkedIssues
        said={`Blocked by ${count(blockedBy.length)}`}
        keys={blockedBy}
        byKey={byKey}
        onOpenKey={onOpenKey}
        pill={
          <Pill className="neon-edge border-destructive/40 bg-destructive/10 text-destructive cursor-pointer">
            <BanIcon className="size-3 shrink-0" aria-hidden="true" />
            <span className="shrink-0 tabular-nums">{blockedBy.length}</span>
          </Pill>
        }
      />
    );
  }
  if (blocks.length > 0) {
    return (
      <LinkedIssues
        said={`Blocking ${count(blocks.length)}`}
        keys={blocks}
        byKey={byKey}
        onOpenKey={onOpenKey}
        pill={
          <Pill className="neon-edge border-warning/40 bg-warning/10 text-warning cursor-pointer">
            <ArrowRightToLineIcon
              className="size-3 shrink-0"
              aria-hidden="true"
            />
            <span className="shrink-0 tabular-nums">{blocks.length}</span>
          </Pill>
        }
      />
    );
  }
  return null;
}

function IssueRow({
  issue,
  today,
  sprintName,
  parentTitle,
  underParent,
  indent,
  selected,
  blockedBy,
  assignees,
  sprints,
  allLabels,
  onPick,
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
  byKey,
  onOpenKey,
  show,
}: {
  issue: Issue;
  today: string;
  /** The sprint this row sits in, when it sits in one. */
  sprintName?: string;
  /** The parent's title, for the tooltip. Absent when a filter hid it. */
  parentTitle?: string;
  /** True when the parent row sits directly above, which says it already. */
  underParent?: boolean;
  /** Left padding, so a row lines up under the header above it. */
  indent?: string;
  selected: boolean;
  /** The keys holding this row up, read from the other end of the link. */
  blockedBy: string[];
  /** Everyone a row can go to, and every sprint it can join. */
  assignees: string[];
  sprints: { id: string; name: string }[];
  onPick: (event: React.MouseEvent) => void;
  onOpen: () => void;
  /** Every label the list knows, for the menu on a row. */
  allLabels: string[];
  onTitle: (title: string) => void;
  onStatus: (status: IssueStatus) => void;
  onPriority: (priority: IssuePriority) => void;
  onKind: (kind: IssueKind) => void;
  onAssignee: (assignee: string) => void;
  onSprint: (sprintId: string | null) => void;
  onLabels: (labels: string[]) => void;
  onDates: (dates: { start?: string | null; due?: string | null }) => void;
  onMove: (patch: Partial<Issue>) => void;
  onDelete: () => void;
  /** Every issue on the board, so a link can print a title and be opened. */
  byKey: Map<string, Issue>;
  onOpenKey: (key: string) => void;
  /** Whether a mark is one the reader has left switched on. */
  show: (field: RowField) => boolean;
}) {
  // A modifier means the reader is choosing rows, so it wins over opening
  // one. Without this, ctrl-clicking a title would open a form nobody asked
  // for and lose the selection behind it.
  const openOrPick = (event: React.MouseEvent) => {
    if (event.shiftKey || event.ctrlKey || event.metaKey) {
      onPick(event);
      return;
    }
    onOpen();
  };
  return (
    <RowMenu
      issue={issue}
      assignees={assignees}
      sprints={sprints}
      allLabels={allLabels}
      onOpen={onOpen}
      onTitle={onTitle}
      onStatus={onStatus}
      onPriority={onPriority}
      onKind={onKind}
      onAssignee={onAssignee}
      onSprint={onSprint}
      onLabels={onLabels}
      onDates={onDates}
      onMove={onMove}
      onDelete={onDelete}
      byKey={byKey}
      row={
        <li
          // Ctrl and shift reach the whole row, so a wide row is a wide target.
          // A plain click on the row does nothing, because that gesture belongs
          // to opening the issue. The box on the left needs no modifier.
          onClick={(event) => {
            if (event.shiftKey || event.ctrlKey || event.metaKey) onPick(event);
          }}
          // aria-selected is invalid on a listitem, so the checkbox announces the
          // state through aria-checked and this only tints the row.
          data-selected={selected || undefined}
          className={cn(
            "flex h-11 min-w-0 items-center gap-3 overflow-hidden px-3 transition-colors",
            selected ? "bg-primary/8" : "hover:bg-sidebar-accent",
            indent,
            // Done is finished business. Half the opacity takes the whole row
            // back, marks and text together, without hiding it.
            issue.status === "done" && "opacity-50",
            // A sub-task hangs off its parent, so the rule says where it belongs.
            issue.parent && "border-border/60 ml-6 border-l",
          )}
        >
          <RowCheckbox
            checked={selected}
            label={`Select ${issue.key}`}
            onPick={onPick}
          />

          {show("kind") && <KindGlyph kind={issue.kind} />}

          {show("priority") && (
            <FieldMenu
              name="Priority"
              options={PRIORITY_ORDER}
              labels={ISSUE_PRIORITY_LABELS}
              glyphs={(priority: IssuePriority) => (
                <PriorityGlyph priority={priority} silent />
              )}
              onChange={onPriority}
              trigger={
                <RowTrigger
                  label={`Priority of ${issue.key}: ${ISSUE_PRIORITY_LABELS[issue.priority]}`}
                >
                  <PriorityGlyph priority={issue.priority} silent />
                </RowTrigger>
              }
            />
          )}

          {show("key") && (
            <button
              type="button"
              onClick={openOrPick}
              className="text-muted-foreground hover:text-foreground focus-visible:ring-ring w-24 shrink-0 cursor-pointer truncate rounded-sm text-left font-mono text-xs focus-visible:ring-2 focus-visible:outline-none"
            >
              {issue.key}
            </button>
          )}

          {/* The glyph is the control. Changing a status is the commonest edit
              on this screen, and sending it through the form to do it would cost
              three clicks and a dialog. */}
          {show("status") && (
            <FieldMenu
              name="Status"
              options={STATUS_ORDER}
              labels={STATUS_LABELS}
              glyphs={(status: IssueStatus) => <StatusGlyph status={status} />}
              onChange={onStatus}
              trigger={
                <RowTrigger
                  label={`Status of ${issue.key}: ${STATUS_LABELS[issue.status]}`}
                >
                  <StatusGlyph status={issue.status} />
                </RowTrigger>
              }
            />
          )}

          {/* The rule on the left says a row hangs off something. This says off
              what, which the rule cannot, because grouping puts a sub-task in one
              group and its parent in another. */}
          {issue.parent && !underParent && (
            <span
              className="text-muted-foreground/80 flex shrink-0 items-center gap-0.5 font-mono text-xs"
              title={
                parentTitle
                  ? `Sub-task of ${issue.parent}: ${parentTitle}`
                  : `Sub-task of ${issue.parent}`
              }
            >
              <span className="sr-only">Sub-task of</span>
              {issue.parent}
              <ChevronRightIcon className="size-3 shrink-0" aria-hidden="true" />
            </span>
          )}

          <button
            type="button"
            onClick={openOrPick}
            className={cn(
              "focus-visible:ring-ring min-w-0 flex-1 cursor-pointer truncate rounded-sm text-left text-sm hover:underline focus-visible:ring-2 focus-visible:outline-none",
              issue.status === "cancelled" && "text-muted-foreground line-through",
            )}
          >
            {issue.title}
          </button>

          {/* Context, in the order it is asked for: what kind, whose, when. */}
          <span className="hidden min-w-0 items-center gap-1.5 lg:flex">
            {show("labels") && (
              <FieldLabels
                all={allLabels}
                chosen={issue.labels}
                onChange={onLabels}
                trigger={
                  <RowTrigger
                    label={`Labels on ${issue.key}: ${
                      issue.labels.join(", ") || "none"
                    }`}
                    className="gap-1.5"
                  >
                    {issue.labels.length > 0 ? (
                      issue.labels.map((label) => (
                        <Pill key={label}>
                          <span
                            className={cn("size-1.5 rounded-full", dotFor(label))}
                            aria-hidden="true"
                          />
                          {label}
                        </Pill>
                      ))
                    ) : (
                      // No label means no pill at rest. The empty slot appears with
                      // the boxes, so a row can still be given one from here.
                      <TagIcon
                        className="text-muted-foreground size-3.5 opacity-0 group-hover/list:opacity-100"
                        aria-hidden="true"
                      />
                    )}
                  </RowTrigger>
                }
              />
            )}
            {show("project") && (
              <Pill className="hidden xl:inline-flex">{issue.project}</Pill>
            )}
            {show("links") && (
              <Dependency
                blockedBy={blockedBy}
                blocks={issue.blocks}
                byKey={byKey}
                onOpenKey={onOpenKey}
              />
            )}
            {show("dates") && (
              <DateRange
                start={issue.start}
                due={issue.due}
                today={today}
                onChange={onDates}
              />
            )}
          </span>

          {show("assignee") && (
            <FieldMenu
              name="Assignee"
              options={assignees}
              labels={Object.fromEntries(assignees.map((one) => [one, one]))}
              onChange={onAssignee}
              trigger={
                <RowTrigger label={`Assignee of ${issue.key}: ${issue.assignee}`}>
                  <Assignee name={issue.assignee} />
                </RowTrigger>
              }
            />
          )}

          {show("sprint") && (
            <FieldMenu
              name="Sprint"
              options={[...sprints.map((one) => one.id), NO_SPRINT]}
              labels={{
                ...Object.fromEntries(sprints.map((one) => [one.id, one.name])),
                [NO_SPRINT]: "No sprint",
              }}
              onChange={(id) => onSprint(id === NO_SPRINT ? null : id)}
              trigger={
                <RowTrigger
                  label={`Sprint of ${issue.key}: ${sprintName ?? "none"}`}
                  // The empty slot is invisible at rest, so it must not swallow a
                  // click meant for the row behind it.
                  className={cn(!sprintName && "opacity-100")}
                >
                  <SprintBadge name={sprintName} />
                </RowTrigger>
              }
            />
          )}

          {show("updated") && (
            <span className="text-muted-foreground hidden w-14 shrink-0 text-right text-xs tabular-nums sm:block">
              {formatShortDay(issue.updated)}
            </span>
          )}
        </li>
      }
    />
  );
}

/**
 * One line of the arranging dialog, with the grip that picks it up.
 *
 * The grip reads its own arrow keys rather than leaving them to dnd-kit's
 * keyboard sensor. That sensor listens on the document, and the dialog around
 * this list stops an arrow key before it gets there, so a keyboard would
 * otherwise start a drag it could never move.
 */
function ArrangeableRow({
  id,
  label,
  onStep,
}: {
  id: string;
  label: string;
  onStep: (by: number) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "border-border/70 bg-background flex items-center gap-2 rounded-md border px-2 py-1.5 text-sm",
        isDragging && "z-10 opacity-60",
      )}
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        aria-label={`Move ${label}. Drag it, or press the up and down arrows.`}
        className="text-muted-foreground/60 hover:text-foreground focus-visible:ring-ring flex size-5 shrink-0 cursor-grab items-center justify-center rounded-sm focus-visible:ring-2 focus-visible:outline-none active:cursor-grabbing"
        {...attributes}
        {...listeners}
        onKeyDown={(event) => {
          const by =
            event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
          if (!by) return;
          event.preventDefault();
          onStep(by);
        }}
      >
        <GripVerticalIcon className="size-3.5" aria-hidden="true" />
      </button>
      <span className="min-w-0 truncate">{label}</span>
    </li>
  );
}

/**
 * Arranging, in a box of its own.
 *
 * The list being arranged is short and the page behind it is long, so the
 * dragging happens here rather than on the rows themselves. A handle on every
 * group heading would put a grip in front of a reader who only ever wanted to
 * read the list.
 */
function ArrangeDialog({
  title,
  lede,
  items,
  open,
  onOpenChange,
  onSave,
  onReset,
}: {
  title: string;
  lede: string;
  items: { id: string; label: string }[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (order: string[]) => void;
  onReset: () => void;
}) {
  const [order, setOrder] = useState(items.map((item) => item.id));
  const labels = new Map(items.map((item) => [item.id, item.label]));
  // A short distance keeps a click on the grip a click, not a drag.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  /** One step up or down, for whoever is not holding a mouse. */
  function step(id: string, by: number) {
    setOrder((current) => {
      const from = current.indexOf(id);
      const to = from + by;
      if (from < 0 || to < 0 || to >= current.length) return current;
      const next = [...current];
      [next[from], next[to]] = [next[to], next[from]];
      return next;
    });
  }

  function drop(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setOrder((current) => {
      const next = [...current];
      const from = next.indexOf(String(active.id));
      const to = next.indexOf(String(over.id));
      if (from < 0 || to < 0) return current;
      next.splice(to, 0, ...next.splice(from, 1));
      return next;
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{lede}</DialogDescription>
        </DialogHeader>

        <div>
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            modifiers={[restrictToVerticalAxis]}
            onDragEnd={drop}
          >
            <SortableContext
              items={order}
              strategy={verticalListSortingStrategy}
            >
              <ul className="flex flex-col gap-1.5">
                {order.map((id) => (
                  <ArrangeableRow
                    key={id}
                    id={id}
                    label={labels.get(id) ?? id}
                    onStep={(by) => step(id, by)}
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onReset}>
            Reset
          </Button>
          <DialogClose render={<Button variant="outline" type="button" />}>
            Cancel
          </DialogClose>
          <Button type="button" onClick={() => onSave(order)}>
            Save order
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * One group, at either level. The same component serves both, so a subgroup
 * collapses the way its parent does and needs no second implementation.
 */
function GroupSection({
  group,
  id,
  nested,
  children,
}: {
  group: IssueGroup;
  id: string;
  /** A subgroup sits under a group, so it indents and reads quieter. */
  nested?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);
  const Heading = nested ? "h3" : "h2";

  return (
    <section>
      <Heading>
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          aria-expanded={open}
          aria-controls={id}
          className={cn(
            "hover:bg-sidebar-accent focus-visible:ring-ring flex w-full cursor-pointer items-center gap-2 px-3 text-left focus-visible:ring-2 focus-visible:outline-none",
            nested
              ? cn("text-muted-foreground h-8 text-xs", INDENT[1])
              : "h-9 text-sm font-medium",
          )}
        >
          <ChevronRightIcon
            className={cn(
              "text-muted-foreground size-3.5 shrink-0 transition-transform duration-200",
              open && "rotate-90",
            )}
            aria-hidden="true"
          />
          {group.status && <StatusGlyph status={group.status} />}
          <span className="truncate">{group.label}</span>
          <span className="text-muted-foreground text-xs tabular-nums">
            {group.count}
          </span>
        </button>
      </Heading>

      {open && <div id={id}>{children}</div>}
    </section>
  );
}

// The choice holds across a reload and across the three sprint views, because
// a display preference that resets on every navigation reads as a fault.
const groupStore = createLocalStore<GroupField>(
  "kpa.issues.group",
  "status",
  isGroupField,
);
const subGroupStore = createLocalStore<GroupField>(
  "kpa.issues.subgroup",
  "none",
  isGroupField,
);

/**
 * Whether the groups sit in their own order or in one the reader arranged.
 *
 * Auto is the order the field itself implies: the status ramp, or the
 * alphabet. Manual is whatever order somebody dragged them into, kept per
 * field, because the order that suits statuses says nothing about assignees.
 */
type GroupOrder = "auto" | "manual";

const groupOrderStore = createLocalStore<GroupOrder>(
  "kpa.issues.grouporder",
  "auto",
  (value) => value === "auto" || value === "manual",
);

/**
 * What an automatic order goes on.
 *
 * A group has many issues, so it cannot be put in order by one of their
 * fields. What it does have is a name, a count, and whatever order the field
 * itself implies, which is the status ramp and nothing else.
 */
type GroupSort = "own" | "name" | "count";

const GROUP_SORT_LABELS: Record<GroupSort, string> = {
  own: "The field's own order",
  name: "Name",
  count: "How many rows",
};

const groupSortStore = createLocalStore<GroupSort>(
  "kpa.issues.groupsort",
  "own",
  (value) => value === "own" || value === "name" || value === "count",
);

/** The biggest group first, because that is where the work is. */
function orderGroups(groups: IssueGroup[], by: GroupSort): IssueGroup[] {
  if (by === "own") return groups;
  if (by === "name") {
    return [...groups].sort((a, b) => a.label.localeCompare(b.label));
  }
  return [...groups].sort((a, b) => b.count - a.count);
}

const arrangedStore = createLocalStore<string>(
  "kpa.issues.arranged",
  "{}",
  (value) => {
    try {
      const read: unknown = JSON.parse(value);
      return read !== null && typeof read === "object";
    } catch {
      return false;
    }
  },
);

const sortStore = createLocalStore<RowSort>(
  "kpa.issues.sort",
  "none",
  isRowSort,
);

/** The arranged order of every field, as one saved object. */
function readArranged(saved: string): Record<string, string[]> {
  try {
    const read: unknown = JSON.parse(saved);
    return read && typeof read === "object"
      ? (read as Record<string, string[]>)
      : {};
  } catch {
    return {};
  }
}

/** Row values are filed apart from group values, so neither reads the other. */
function rowKey(sort: RowSort): string {
  return `row:${sort}`;
}

function saveArranged(field: string, keys: string[]) {
  const saved = readArranged(
    typeof window === "undefined"
      ? "{}"
      : (window.localStorage.getItem("kpa.issues.arranged") ?? "{}"),
  );
  arrangedStore.set(JSON.stringify({ ...saved, [field]: keys }));
}

/**
 * The groups in the order the reader arranged, with the rest behind them.
 *
 * A group nobody has dragged yet, or one that appeared after the arranging,
 * goes on the end rather than vanishing. The saved list is not trimmed: a
 * group that is empty today may come back tomorrow, and its place with it.
 */
function clearArranged(field: string) {
  const saved = readArranged(
    typeof window === "undefined"
      ? "{}"
      : (window.localStorage.getItem("kpa.issues.arranged") ?? "{}"),
  );
  delete saved[field];
  arrangedStore.set(JSON.stringify(saved));
}

function arrange(groups: IssueGroup[], keys: string[]): IssueGroup[] {
  const rank = new Map(keys.map((key, index) => [key, index]));
  return [...groups].sort(
    (a, b) =>
      (rank.get(a.key) ?? Number.MAX_SAFE_INTEGER) -
      (rank.get(b.key) ?? Number.MAX_SAFE_INTEGER),
  );
}

// On by default. A sub-task read apart from its parent is a fragment of a
// task, and the pair is what the work actually is.
type Tree = "on" | "off";
const treeStore = createLocalStore<Tree>(
  "kpa.issues.tree",
  "on",
  (value) => value === "on" || value === "off",
);

/**
 * Every mark on a row a reader can do without.
 *
 * The title is not among them. A row without one names nothing, so there
 * would be no way back to the issue it stands for.
 */
const ROW_FIELDS = [
  "kind",
  "priority",
  "key",
  "status",
  "labels",
  "project",
  "links",
  "dates",
  "assignee",
  "sprint",
  "updated",
] as const;

type RowField = (typeof ROW_FIELDS)[number];

const ROW_FIELD_LABELS: Record<RowField, string> = {
  kind: "Kind",
  priority: "Priority",
  key: "Key",
  status: "Status",
  labels: "Labels",
  project: "Project",
  links: "Dependencies",
  dates: "Dates",
  assignee: "Assignee",
  sprint: "Sprint",
  updated: "Updated",
};

// What is hidden, not what is shown. A field added to a row later then
// arrives visible, rather than hidden from everybody who saved a list back
// when it did not exist.
const hiddenStore = createLocalStore<string>("kpa.issues.hidden", "", (value) =>
  value
    .split(",")
    .every((name) => name === "" || ROW_FIELDS.includes(name as RowField)),
);

const GROUP_ORDER_LABELS: Record<GroupOrder, string> = {
  auto: "Automatic",
  manual: "Arranged",
};

const TREE_LABELS: Record<Tree, string> = {
  on: "Under the parent",
  off: "On their own",
};

/** One labelled choice. Every control in the popover is one of these. */
function ChoiceSelect<T extends string>({
  label,
  value,
  options,
  labels,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly T[];
  labels: Record<T, string>;
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <Select value={value} onValueChange={(next) => onChange(next as T)}>
        <SelectTrigger size="sm" className="w-36">
          {/* The trigger prints the raw value without this. */}
          <SelectValue>{(chosen: T) => labels[chosen]}</SelectValue>
        </SelectTrigger>
        <SelectContent align="end" alignItemWithTrigger={false}>
          {options.map((option) => (
            <SelectItem key={option} value={option}>
              {labels[option]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/**
 * What a row shows, and what it does with a sub-task.
 *
 * Both are the same question asked twice: what does a reader want in front of
 * them. Grouping decides what the rows are gathered into, which is a different
 * question, so it keeps its own control.
 */
function ViewControl({ hidden, tree }: { hidden: Set<RowField>; tree: Tree }) {
  function toggle(field: RowField, shown: boolean) {
    const next = new Set(hidden);
    if (shown) {
      next.delete(field);
    } else {
      next.add(field);
    }
    // Written in the order the fields are declared, so the saved string reads
    // the same whatever order they were switched off in.
    hiddenStore.set(ROW_FIELDS.filter((one) => next.has(one)).join(","));
  }

  return (
    <Popover>
      <PopoverTrigger
        render={<Button variant="outline" size="icon-lg" aria-label="View" />}
        title="View"
      >
        <EyeIcon aria-hidden="true" />
      </PopoverTrigger>

      <PopoverContent align="end" className="w-64 gap-2.5">
        <p className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
          Shown on a row
        </p>

        <div className="grid grid-cols-2 gap-x-3 gap-y-2">
          {ROW_FIELDS.map((field) => (
            <label
              key={field}
              className="flex cursor-pointer items-center gap-2"
            >
              <Checkbox
                checked={!hidden.has(field)}
                onCheckedChange={(on) => toggle(field, on)}
              />
              {ROW_FIELD_LABELS[field]}
            </label>
          ))}
        </div>

        <p className="text-muted-foreground">
          The title always shows. A row without one names nothing.
        </p>

        <div className="border-border/70 flex flex-col gap-2 border-t pt-2.5">
          <ChoiceSelect
            label="Sub-tasks"
            value={tree}
            options={["on", "off"] as const}
            labels={TREE_LABELS}
            onChange={treeStore.set}
          />
          <p className="text-muted-foreground">
            {tree === "on"
              ? "A sub-task follows its parent, whatever group the parent lands in."
              : "A sub-task joins the group its own status or assignee puts it in."}
          </p>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** The saved list, as the thing a row asks ten times a render. */
function readHidden(saved: string): Set<RowField> {
  return new Set(saved.split(",").filter(Boolean) as RowField[]);
}

/**
 * How the list is divided, and what order the pieces sit in.
 *
 * Dividing and ordering are one thought, so they are one popover: nobody
 * picks a grouping without deciding what order it comes in, and the order
 * controls read as nonsense without the grouping above them.
 */
function SortControl({
  groupBy,
  subGroupBy,
  order,
  groupSort,
  sort,
  groups,
  rowRank,
}: {
  groupBy: GroupField;
  subGroupBy: GroupField;
  order: GroupOrder;
  groupSort: GroupSort;
  sort: RowSort;
  /** The groups as they stand, so the dialog arranges what is on the screen. */
  groups: IssueGroup[] | null;
  /** The row values as somebody arranged them, when they did. */
  rowRank: string[] | null;
}) {
  function setGroup(field: GroupField) {
    groupStore.set(field);
    // Nothing sits under nothing, and no field sits under itself.
    if (field === "none" || field === subGroupBy) subGroupStore.set("none");
  }

  const [arrangingGroups, setArrangingGroups] = useState(false);
  const [arrangingRows, setArrangingRows] = useState(false);

  const values = rowValues(sort);
  const rowItems = (rowRank ?? values ?? []).map((value) => ({
    id: value,
    label:
      sort === "priority"
        ? ISSUE_PRIORITY_LABELS[value as IssuePriority]
        : STATUS_LABELS[value as IssueStatus],
  }));

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            size="icon-lg"
            aria-label="Grouping and sort"
          />
        }
        title="Grouping and sort"
      >
        <ArrowUpDownIcon aria-hidden="true" />
      </PopoverTrigger>

      <PopoverContent align="end" className="w-64 gap-2.5">
        <p className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
          Grouping
        </p>

        <ChoiceSelect
          label="Group by"
          value={groupBy}
          options={GROUP_FIELDS}
          labels={GROUP_FIELD_LABELS}
          onChange={setGroup}
        />

        {groupBy === "none" ? (
          <p className="text-muted-foreground">
            Pick a field above to add a second level.
          </p>
        ) : (
          <ChoiceSelect
            label="Then by"
            value={subGroupBy}
            options={GROUP_FIELDS.filter((field) => field !== groupBy)}
            labels={GROUP_FIELD_LABELS}
            onChange={subGroupStore.set}
          />
        )}

        <p className="text-muted-foreground border-border/70 border-t pt-2.5 text-[11px] font-medium tracking-wide uppercase">
          Sort
        </p>

        {groupBy === "none" ? (
          <p className="text-muted-foreground">
            Group the rows to arrange the groups.
          </p>
        ) : (
          <>
            <ChoiceSelect
              label="Group order"
              value={order}
              options={["auto", "manual"] as const}
              labels={GROUP_ORDER_LABELS}
              onChange={groupOrderStore.set}
            />
            {order === "auto" ? (
              <ChoiceSelect
                label="Ordered by"
                value={groupSort}
                options={["own", "name", "count"] as const}
                labels={GROUP_SORT_LABELS}
                onChange={groupSortStore.set}
              />
            ) : (
              <>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setArrangingGroups(true)}
                  disabled={!groups || groups.length < 2}
                >
                  Arrange {GROUP_FIELD_LABELS[groupBy].toLowerCase()}&hellip;
                </Button>
                <p className="text-muted-foreground">
                  The order is kept for this field alone.
                </p>
              </>
            )}
          </>
        )}

        <div className="border-border/70 flex flex-col gap-2 border-t pt-2.5">
          <ChoiceSelect
            label="Then rows by"
            value={sort}
            options={ROW_SORTS}
            labels={ROW_SORT_LABELS}
            onChange={sortStore.set}
          />
          {values && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setArrangingRows(true)}
            >
              Arrange {ROW_SORT_LABELS[sort].toLowerCase()}&hellip;
            </Button>
          )}
          <p className="text-muted-foreground">
            {sort === "none"
              ? "The order the rows arrived in."
              : "A sub-task follows its parent wherever the parent lands."}
          </p>
        </div>
      </PopoverContent>

      {arrangingGroups && (
        <ArrangeDialog
          title={`Arrange ${GROUP_FIELD_LABELS[groupBy].toLowerCase()}`}
          lede="Drag a row by its grip, or focus one and press the arrows. The list reads top to bottom on the page."
          items={(groups ?? []).map((group) => ({
            id: group.key,
            label: group.label,
          }))}
          open={arrangingGroups}
          onOpenChange={setArrangingGroups}
          onSave={(next) => {
            saveArranged(groupBy, next);
            setArrangingGroups(false);
          }}
          onReset={() => {
            clearArranged(groupBy);
            setArrangingGroups(false);
          }}
        />
      )}

      {arrangingRows && (
        <ArrangeDialog
          title={`Arrange ${ROW_SORT_LABELS[sort].toLowerCase()}`}
          lede="Drag a row by its grip, or focus one and press the arrows. Every issue sorts by this order."
          items={rowItems}
          open={arrangingRows}
          onOpenChange={setArrangingRows}
          onSave={(next) => {
            saveArranged(rowKey(sort), next);
            setArrangingRows(false);
          }}
          onReset={() => {
            clearArranged(rowKey(sort));
            setArrangingRows(false);
          }}
        />
      )}
    </Popover>
  );
}

function FilterControl({
  issues,
  filters,
  setFilters,
  sprintNames,
}: {
  /** The unfiltered list, so an option never vanishes as it is chosen. */
  issues: Issue[];
  filters: Filters;
  setFilters: (filters: Filters) => void;
  sprintNames: Record<string, string>;
}) {
  const chosen = activeCount(filters);

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            size="icon-lg"
            aria-label={chosen > 0 ? `Filters, ${chosen} on` : "Filters"}
            className="relative"
          />
        }
        title="Filters"
      >
        <ListFilterIcon aria-hidden="true" />
        {chosen > 0 && (
          <Badge
            variant="primary-light"
            size="xs"
            radius="full"
            className="absolute -top-1.5 -right-1.5 tabular-nums"
          >
            {chosen}
          </Badge>
        )}
      </PopoverTrigger>

      <PopoverContent align="end" className="w-72 gap-0 p-0">
        <div className="border-border/70 flex items-center justify-between gap-3 border-b px-2.5 py-2">
          <p className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
            Filters
          </p>
          {chosen > 0 && (
            <Button variant="ghost" size="xs" onClick={() => setFilters({})}>
              Clear {chosen}
            </Button>
          )}
        </div>

        <div className="max-h-96 overflow-y-auto p-1">
          {FILTER_FIELDS.map((field) => {
            const options = optionsFor(issues, field, sprintNames);
            // A field the current rows never fill would offer nothing.
            if (options.length === 0) return null;

            return (
              <section key={field} className="py-1">
                <h3 className="text-muted-foreground px-2 py-1 text-[11px] font-medium tracking-wide uppercase">
                  {GROUP_FIELD_LABELS[field]}
                </h3>
                <ul>
                  {options.map((option) => {
                    const on = filters[field]?.includes(option.key) ?? false;
                    return (
                      <li key={option.key}>
                        <button
                          type="button"
                          onClick={() =>
                            setFilters(toggleValue(filters, field, option.key))
                          }
                          aria-pressed={on}
                          className="hover:bg-sidebar-accent focus-visible:ring-ring flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-left focus-visible:ring-2 focus-visible:outline-none"
                        >
                          <span
                            className={cn(
                              "flex size-3.5 shrink-0 items-center justify-center rounded-[3px] border",
                              on
                                ? "border-primary bg-primary text-primary-foreground"
                                : "border-border",
                            )}
                            aria-hidden="true"
                          >
                            {on && <CheckIcon className="size-2.5" />}
                          </span>
                          <span className="min-w-0 flex-1 truncate">
                            {option.label}
                          </span>
                          <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                            {option.count}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * A menu that opens under the pointer and stays open on the way to it.
 *
 * The menu renders in a portal, so it is no child of the trigger and leaving
 * the trigger would shut it before anything could be clicked. The delay
 * covers the gap between the two, and entering either half cancels it.
 * Clicking still works, which is what keyboard and touch need.
 */
function HoverMenu({
  trigger,
  children,
}: {
  trigger: React.ReactNode;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const closing = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const hold = () => {
    clearTimeout(closing.current);
    setOpen(true);
  };
  const release = () => {
    closing.current = setTimeout(() => setOpen(false), 180);
  };

  useEffect(() => () => clearTimeout(closing.current), []);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <span onMouseEnter={hold} onMouseLeave={release}>
        {trigger}
      </span>
      <DropdownMenuContent
        side="top"
        align="center"
        sideOffset={8}
        className="min-w-44"
        onMouseEnter={hold}
        onMouseLeave={release}
      >
        {/* Base UI throws if a label sits outside a group, and that throw
            takes the page down. The group belongs here, where no caller can
            forget it. */}
        <DropdownMenuGroup>{children}</DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * A panel that opens on hover and stays once entered.
 *
 * A menu can close when the pointer leaves, because every choice in it is one
 * click. A date field cannot: the browser's own calendar opens in a layer
 * outside the panel, and reaching for it would shut the thing underneath. So
 * entering the panel pins it, and only a click away or Escape closes it.
 */
function HoverPanel({
  trigger,
  children,
}: {
  trigger: React.ReactNode;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const closing = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(closing.current), []);

  function change(next: boolean) {
    setOpen(next);
    if (!next) setPinned(false);
  }

  return (
    <Popover open={open} onOpenChange={change}>
      <span
        onMouseEnter={() => {
          clearTimeout(closing.current);
          setOpen(true);
        }}
        onMouseLeave={() => {
          closing.current = setTimeout(() => {
            if (!pinned) setOpen(false);
          }, 180);
        }}
      >
        {trigger}
      </span>
      <PopoverContent
        side="top"
        align="center"
        sideOffset={8}
        className="w-56 gap-2 p-2.5"
        onMouseEnter={() => {
          clearTimeout(closing.current);
          setPinned(true);
        }}
      >
        {children}
      </PopoverContent>
    </Popover>
  );
}

/** One date, set or cleared across every chosen row. */
function BulkDate({
  name,
  icon,
  value,
  onApply,
}: {
  name: string;
  icon: React.ReactNode;
  /** The date every chosen row already shares, or "" when they differ. */
  value: string;
  onApply: (date: string | null) => void;
}) {
  return (
    <HoverPanel
      trigger={
        <PopoverTrigger
          render={<Button variant="ghost" size="icon-lg" aria-label={name} />}
          title={name}
        >
          {icon}
        </PopoverTrigger>
      }
    >
      <p className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
        {name}
      </p>
      {/* The browser's own date field. It parses, it validates, and it opens
          the calendar every reader already knows. */}
      <Input
        type="date"
        value={value}
        aria-label={name}
        onChange={(event) => onApply(event.target.value || null)}
      />
      <Button variant="outline" size="sm" onClick={() => onApply(null)}>
        Clear the date
      </Button>
    </HoverPanel>
  );
}

/**
 * Labels, added and removed rather than replaced.
 *
 * An issue carries several labels, so setting one has to leave the others
 * alone. A tick means every chosen row already carries it.
 */
function BulkLabels({
  labels,
  onEvery,
  onToggle,
}: {
  labels: string[];
  /** Whether every chosen row already carries the label. */
  onEvery: (label: string) => boolean;
  onToggle: (label: string, add: boolean) => void;
}) {
  return (
    <HoverMenu
      trigger={
        <DropdownMenuTrigger
          render={<Button variant="ghost" size="icon-lg" aria-label="Labels" />}
          title="Labels"
        >
          <TagIcon aria-hidden="true" />
        </DropdownMenuTrigger>
      }
    >
      <DropdownMenuLabel>Labels</DropdownMenuLabel>
      {labels.map((label) => {
        const on = onEvery(label);
        return (
          <DropdownMenuCheckboxItem
            key={label}
            checked={on}
            closeOnClick={false}
            onCheckedChange={() => onToggle(label, !on)}
          >
            <span
              className={cn("size-1.5 shrink-0 rounded-full", dotFor(label))}
              aria-hidden="true"
            />
            {label}
          </DropdownMenuCheckboxItem>
        );
      })}
    </HoverMenu>
  );
}

/** One end of a dependency, picked from the rows not already chosen. */
function BulkLink({
  name,
  icon,
  targets,
  onPick,
}: {
  name: string;
  icon: React.ReactNode;
  targets: Issue[];
  onPick: (key: string) => void;
}) {
  return (
    <HoverMenu
      trigger={
        <DropdownMenuTrigger
          render={<Button variant="ghost" size="icon-lg" aria-label={name} />}
          title={name}
        >
          {icon}
        </DropdownMenuTrigger>
      }
    >
      <DropdownMenuLabel>{name}</DropdownMenuLabel>
      {targets.length === 0 ? (
        <DropdownMenuLabel className="font-normal">
          No other row to link to.
        </DropdownMenuLabel>
      ) : (
        targets.map((issue) => (
          <DropdownMenuItem key={issue.key} onClick={() => onPick(issue.key)}>
            <span className="text-muted-foreground shrink-0 font-mono">
              {issue.key}
            </span>
            <span className="min-w-0 truncate">{issue.title}</span>
          </DropdownMenuItem>
        ))
      )}
    </HoverMenu>
  );
}

/** One bulk action. It names what it will do, never what is currently set. */
function BulkAction<T extends string>({
  name,
  icon,
  options,
  labels,
  onApply,
}: {
  name: string;
  icon: React.ReactNode;
  options: readonly T[];
  labels: Record<T, string>;
  onApply: (value: T) => void;
}) {
  return (
    <HoverMenu
      trigger={
        <DropdownMenuTrigger
          render={<Button variant="ghost" size="icon-lg" aria-label={name} />}
          title={name}
        >
          {icon}
        </DropdownMenuTrigger>
      }
    >
      <DropdownMenuLabel>{name}</DropdownMenuLabel>
      {options.map((option) => (
        <DropdownMenuItem key={option} onClick={() => onApply(option)}>
          {labels[option]}
        </DropdownMenuItem>
      ))}
    </HoverMenu>
  );
}

/**
 * The bar that appears once rows are chosen.
 *
 * It floats over the list rather than sitting in it, so choosing a row never
 * moves the row under the cursor.
 */
function BulkBar({
  chosen,
  assignees,
  labels,
  sprints,
  targets,
  shared,
  allIssues,
  onEveryHasLabel,
  onSet,
  onLabel,
  onLink,
  onDelete,
  onClear,
}: {
  /** The keys on the screen, in the order they appear. */
  chosen: string[];
  assignees: string[];
  labels: string[];
  sprints: { id: string; name: string }[];
  /** The rows a link can point at: everything not already chosen. */
  targets: Issue[];
  /** A date every chosen row shares, or "" when they differ. */
  shared: { start: string; due: string };
  /** Every row the page knows, so the question can name what else is hit. */
  allIssues: Issue[];
  onEveryHasLabel: (label: string) => boolean;
  onSet: (change: Partial<Issue>) => void;
  onLabel: (label: string, add: boolean) => void;
  onLink: (key: string, direction: "blocks" | "blockedBy") => void;
  onDelete: (keys: string[]) => void;
  onClear: () => void;
}) {
  // A long list would grow the menu past the bar it hangs off.
  const listed = chosen.slice(0, 12);
  const rest = chosen.length - listed.length;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-30 flex justify-center px-4">
      <div className="bg-popover pointer-events-auto flex items-center gap-1 rounded-lg p-1.5 text-xs shadow-lg ring-1 ring-foreground/10">
        {/* The count says how many. Hovering says which. */}
        <HoverMenu
          trigger={
            <DropdownMenuTrigger
              render={<Button variant="ghost" size="sm" />}
              aria-label={`${chosen.length} selected, list them`}
            >
              <span className="font-medium tabular-nums" aria-live="polite">
                {chosen.length} selected
              </span>
            </DropdownMenuTrigger>
          }
        >
          <DropdownMenuLabel>In the selection</DropdownMenuLabel>
          {listed.map((key) => (
            <DropdownMenuItem key={key} className="font-mono">
              {key}
            </DropdownMenuItem>
          ))}
          {rest > 0 && (
            <DropdownMenuLabel className="font-normal">
              and {rest} more
            </DropdownMenuLabel>
          )}
        </HoverMenu>

        <span className="bg-border mx-0.5 h-5 w-px" aria-hidden="true" />

        <BulkAction
          name="Status"
          icon={<CircleDotIcon aria-hidden="true" />}
          options={STATUS_ORDER}
          labels={STATUS_LABELS}
          onApply={(status) => onSet({ status })}
        />
        <BulkAction
          name="Priority"
          icon={<SignalHighIcon aria-hidden="true" />}
          options={PRIORITY_ORDER}
          labels={ISSUE_PRIORITY_LABELS}
          onApply={(priority) => onSet({ priority })}
        />
        <BulkAction
          name="Assignee"
          icon={<UserRoundIcon aria-hidden="true" />}
          options={assignees}
          labels={Object.fromEntries(assignees.map((name) => [name, name]))}
          onApply={(assignee) => onSet({ assignee })}
        />
        <BulkAction
          name="Sprint"
          icon={<RocketIcon aria-hidden="true" />}
          options={[...sprints.map((sprint) => sprint.id), NO_SPRINT]}
          labels={{
            ...Object.fromEntries(sprints.map((s) => [s.id, s.name])),
            [NO_SPRINT]: "No sprint",
          }}
          onApply={(id) => onSet({ sprintId: id === NO_SPRINT ? null : id })}
        />
        <BulkLabels
          labels={labels}
          onEvery={onEveryHasLabel}
          onToggle={onLabel}
        />

        <span className="bg-border mx-0.5 h-5 w-px" aria-hidden="true" />

        <BulkDate
          name="Start date"
          icon={<CalendarArrowUpIcon aria-hidden="true" />}
          value={shared.start}
          onApply={(start) => onSet({ start })}
        />
        <BulkDate
          name="Due date"
          icon={<CalendarArrowDownIcon aria-hidden="true" />}
          value={shared.due}
          onApply={(due) => onSet({ due })}
        />

        <span className="bg-border mx-0.5 h-5 w-px" aria-hidden="true" />

        <BulkLink
          name="Blocked by"
          icon={<BanIcon aria-hidden="true" />}
          targets={targets}
          onPick={(key) => onLink(key, "blockedBy")}
        />
        <BulkLink
          name="Blocking"
          icon={<OctagonXIcon aria-hidden="true" />}
          targets={targets}
          onPick={(key) => onLink(key, "blocks")}
        />

        <span className="bg-border mx-0.5 h-5 w-px" aria-hidden="true" />

        <DeleteIssues
          keys={chosen}
          issues={allIssues}
          onConfirm={() => onDelete(chosen)}
          trigger={
            <Button
              variant="ghost"
              size="icon-lg"
              aria-label="Delete the selection"
              title="Delete the selection"
              className="text-destructive hover:text-destructive"
            >
              <Trash2Icon aria-hidden="true" />
            </Button>
          }
        />

        <Button
          variant="ghost"
          size="icon-lg"
          onClick={onClear}
          aria-label="Clear the selection"
          title="Clear the selection (Esc)"
        >
          <XIcon aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}

export function IssueList({
  issues,
  today,
  sprintNames = {},
  allSprints = [],
  leading,
  onEdit: edit,
  onOpen,
  onDelete,
}: {
  issues: Issue[];
  today: string;
  /** Every sprint the page covers, by id. Grouping by sprint reads it, and
   *  every row wears the mark of the sprint it sits in. */
  sprintNames?: Record<string, string>;
  /** Every sprint a row could be moved to, which is more than the page
   *  shows. Without it the bulk action could only offer this one. */
  allSprints?: { id: string; name: string }[];
  /** Whatever the page puts at the left of the toolbar, opposite the two
   *  controls on the right. The sprint page steps between sprints there. */
  leading?: React.ReactNode;
  /**
   * Record a change against one or more rows. The page holds the edits,
   * because it decides which rows belong here and an edit can change that.
   */
  onEdit: (changes: Record<string, Partial<Issue>>) => void;
  /** Open one row's form. The key and the title are what open it. */
  onOpen: (issue: Issue) => void;
  /** Take rows out for good. The page holds what is gone. */
  onDelete: (keys: string[]) => void;
}) {
  const groupBy = groupStore.useValue();
  const subGroupBy = subGroupStore.useValue();
  const tree = treeStore.useValue();
  const groupOrder = groupOrderStore.useValue();
  const groupSort = groupSortStore.useValue();
  const sort = sortStore.useValue();
  const arranged = readArranged(arrangedStore.useValue());
  const hidden = readHidden(hiddenStore.useValue());
  // A filter is a question about this list, not a preference about every
  // list, so it starts empty on each page rather than surviving a reload.
  const [filters, setFilters] = useState<Filters>({});
  const [selection, setSelection] = useState<Selection>(NOTHING_SELECTED);
  // Worked out once: the row menus and the bulk bar offer the same choices.
  const allAssignees = [
    ...new Set(issues.map((issue) => issue.assignee)),
  ].sort();
  const allLabels = [
    ...new Set(issues.flatMap((issue) => issue.labels)),
  ].sort();

  // "Blocked by" is the other end of "blocks", turned around once here rather
  // than searched for on every row.
  const blockedBy = new Map<string, string[]>();
  for (const issue of issues) {
    for (const held of issue.blocks) {
      blockedBy.set(held, [...(blockedBy.get(held) ?? []), issue.key]);
    }
  }

  // Filter first, then nest. A child whose parent the filter removed becomes
  // a root, which is what keeps it on the screen.
  const shown = applyFilters(issues, filters, sprintNames);
  const rowRank = arranged[rowKey(sort)] ?? null;
  const nodes = sortNodes(
    tree === "on" ? nest(shown) : flat(shown),
    sort,
    rowRank,
  );
  const filtered = shown.length !== issues.length;

  // The groups are worked out once, because the render walks them and so
  // does the order below. Two walks would drift, and a shift-click would
  // then take a run the reader cannot see.
  const autoGroups =
    groupBy === "none" ? null : groupIssues(nodes, groupBy, sprintNames);
  const arranging = groupOrder === "manual" && groupBy !== "none";
  const groups = !autoGroups
    ? null
    : arranging
      ? arrange(autoGroups, arranged[groupBy] ?? [])
      : orderGroups(autoGroups, groupSort);
  const sections = groups?.map((group) => ({
    group,
    subs:
      subGroupBy === "none"
        ? null
        : groupIssues(group.nodes, subGroupBy, sprintNames),
  }));

  const keysIn = (list: IssueNode[]) =>
    list.flatMap((node) => [
      node.issue.key,
      ...node.children.map((child) => child.key),
    ]);

  /** Every row on the screen, top to bottom. Shift-click measures with it. */
  const order = sections
    ? sections.flatMap((section) =>
        section.subs
          ? section.subs.flatMap((sub) => keysIn(sub.nodes))
          : keysIn(section.group.nodes),
      )
    : keysIn(nodes);

  // A filter can hide a chosen row. The bar counts what is on the screen, so
  // a bulk action never reaches a row the reader cannot see. The set drops
  // the repeats that grouping by labels puts in the order.
  const chosen = [...new Set(order)].filter((key) => selection.keys.has(key));

  // Escape gives the selection up, which is where every list puts it.
  useEffect(() => {
    if (chosen.length === 0) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelection(NOTHING_SELECTED);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [chosen.length]);

  function pick(key: string, event: React.MouseEvent) {
    // A shift-click drags a text selection across the rows it spans.
    if (event.shiftKey) window.getSelection()?.removeAllRanges();
    setSelection((current) => select(current, key, order, event));
  }

  // Resolved once, because every sub-task row, every link and the bulk
  // bar ask the same question: which issue is this key.
  const byKey = new Map(issues.map((issue) => [issue.key, issue]));

  function apply(change: Partial<Issue>) {
    edit(Object.fromEntries(chosen.map((key) => [key, change])));
  }

  /** A label joins the rows that lack it, or leaves the rows that carry it. */
  function label(name: string, add: boolean) {
    edit(
      Object.fromEntries(
        chosen.map((key) => {
          const carried = byKey.get(key)?.labels ?? [];
          return [
            key,
            {
              labels: add
                ? carried.includes(name)
                  ? carried
                  : [...carried, name]
                : carried.filter((one) => one !== name),
            },
          ];
        }),
      ),
    );
  }

  /**
   * Write one dependency.
   *
   * Only "blocks" is stored, so the two directions write to different rows.
   * Blocking writes to the chosen rows. Blocked by writes to the row doing
   * the blocking, which is not chosen at all.
   */
  function link(target: string, direction: "blocks" | "blockedBy") {
    const join = (list: string[], key: string) =>
      list.includes(key) ? list : [...list, key];

    if (direction === "blocks") {
      edit(
        Object.fromEntries(
          chosen
            .filter((key) => key !== target)
            .map((key) => [
              key,
              { blocks: join(byKey.get(key)?.blocks ?? [], target) },
            ]),
        ),
      );
      return;
    }

    const blocker = byKey.get(target);
    if (!blocker) return;
    edit({
      [target]: {
        blocks: chosen
          .filter((key) => key !== target)
          .reduce(join, blocker.blocks),
      },
    });
  }

  /** A date only fills the field when every chosen row already agrees. */
  const sharedDate = (field: "start" | "due") => {
    const dates = chosen.map((key) => byKey.get(key)?.[field] ?? "");
    return dates.length > 0 && dates.every((one) => one === dates[0])
      ? (dates[0] ?? "")
      : "";
  };

  function row(issue: Issue, indent?: string, underParent?: boolean) {
    return (
      <IssueRow
        key={issue.key}
        issue={issue}
        today={today}
        indent={indent}
        underParent={underParent}
        selected={selection.keys.has(issue.key)}
        blockedBy={blockedBy.get(issue.key) ?? []}
        onPick={(event) => pick(issue.key, event)}
        onOpen={() => onOpen(issue)}
        assignees={allAssignees}
        sprints={allSprints}
        allLabels={allLabels}
        onTitle={(title) => edit({ [issue.key]: { title } })}
        onStatus={(status) => edit({ [issue.key]: { status } })}
        onPriority={(priority) => edit({ [issue.key]: { priority } })}
        onKind={(kind) => edit({ [issue.key]: { kind } })}
        onAssignee={(assignee) => edit({ [issue.key]: { assignee } })}
        onSprint={(sprintId) => edit({ [issue.key]: { sprintId } })}
        onLabels={(labels) => edit({ [issue.key]: { labels } })}
        onDates={(dates) => edit({ [issue.key]: dates })}
        onMove={(patch) => edit({ [issue.key]: patch })}
        onDelete={() => onDelete([issue.key])}
        show={(field) => !hidden.has(field)}
        byKey={byKey}
        onOpenKey={(key) => {
          const linked = byKey.get(key);
          if (linked) onOpen(linked);
        }}
        parentTitle={issue.parent ? byKey.get(issue.parent)?.title : undefined}
        sprintName={issue.sprintId ? sprintNames[issue.sprintId] : undefined}
      />
    );
  }

  // A child takes its parent's indent. The rule and the margin on the row
  // itself supply the step, so the tie to the parent stays visible.
  function rows(list: IssueNode[], indent?: string) {
    return (
      <ul>
        {list.map((node) => (
          <Fragment key={node.issue.key}>
            {row(node.issue, indent)}
            {node.children.map((child) => row(child, indent, true))}
          </Fragment>
        ))}
      </ul>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex min-h-8 items-center gap-2">
        {leading}

        {/* The page title counts the sprint. This counts what is on screen,
            so a filter never leaves the two silently disagreeing. */}
        {filtered && (
          <p className="text-muted-foreground text-xs tabular-nums">
            {shown.length} of {issues.length}
          </p>
        )}

        <div className="ml-auto flex items-center gap-2">
          <FilterControl
            issues={issues}
            filters={filters}
            setFilters={setFilters}
            sprintNames={sprintNames}
          />
          <SortControl
            groupBy={groupBy}
            subGroupBy={subGroupBy}
            order={groupOrder}
            groupSort={groupSort}
            sort={sort}
            groups={groups}
            rowRank={rowRank}
          />
          <ViewControl hidden={hidden} tree={tree} />
        </div>
      </div>

      {/* group/list, so one pointer anywhere in the list reveals every box. */}
      <div className="group/list border-border/70 divide-border/70 divide-y overflow-hidden rounded-lg border">
        {nodes.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
            <p className="text-sm font-medium">No issue matches</p>
            <p className="text-muted-foreground text-xs">
              Every row in this sprint fell outside the filter.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setFilters({})}
              className="mt-1"
            >
              Clear the filter
            </Button>
          </div>
        ) : !sections ? (
          rows(nodes)
        ) : (
          sections.map(({ group, subs }) => (
            <GroupSection
              key={group.key}
              group={group}
              id={`group-${groupBy}-${group.key}`}
            >
              {subs
                ? subs.map((sub) => (
                    <GroupSection
                      key={sub.key}
                      group={sub}
                      id={`group-${groupBy}-${group.key}-${sub.key}`}
                      nested
                    >
                      {rows(sub.nodes, INDENT[2])}
                    </GroupSection>
                  ))
                : rows(group.nodes, INDENT[1])}
            </GroupSection>
          ))
        )}
      </div>

      {chosen.length > 0 && (
        <BulkBar
          chosen={chosen}
          assignees={allAssignees}
          labels={allLabels}
          sprints={allSprints}
          targets={issues.filter((issue) => !selection.keys.has(issue.key))}
          shared={{ start: sharedDate("start"), due: sharedDate("due") }}
          onEveryHasLabel={(name) =>
            chosen.every((key) => byKey.get(key)?.labels.includes(name))
          }
          allIssues={issues}
          onSet={apply}
          onLabel={label}
          onLink={link}
          onDelete={(keys) => {
            onDelete(keys);
            setSelection(NOTHING_SELECTED);
          }}
          onClear={() => setSelection(NOTHING_SELECTED)}
        />
      )}
    </div>
  );
}
