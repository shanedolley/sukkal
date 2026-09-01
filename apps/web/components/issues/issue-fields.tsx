"use client";

// The parts a create form and a detail view both need.
//
// The two screens look nothing alike: one is a box that asks for a title, the
// other is a page that shows everything. What they share is the set of
// choices behind each field, and those belong in one place or they drift.

import { Fragment, useRef, useState } from "react";

import {
  BoldIcon,
  CodeIcon,
  Heading2Icon,
  ItalicIcon,
  LinkIcon,
  ListChecksIcon,
  ListIcon,
  ListOrderedIcon,
  MoveRightIcon,
  QuoteIcon,
  SquareCodeIcon,
  StrikethroughIcon,
  XIcon,
} from "lucide-react";

import {
  formatDay,
  formatFullDay,
  formatShortDay,
  realToday,
} from "@/lib/format";
import { parseDate } from "@/lib/parse-date";
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
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Label } from "@/components/ui/label";
import type { CustomField, Issue, Space } from "@/lib/types";
import { dotFor } from "./glyphs";

// The order lives beside the status order it is sorted with. Two copies
// would drift the day one of them changed.
export { PRIORITY_ORDER } from "@/lib/issue-view";

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
    kind: "story",
    priority: "none",
    project,
    space: o.spaceOf(project),
    labels: [],
    assignee: o.defaultAssignee,
    start: null,
    due: null,
    updated: new Date().toISOString().slice(0, 10),
    sprintId,
    fields: {},
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

// The trigger names itself. These wrappers used to label it, which meant
// thirteen rows of controls all called "Status" with nothing to tell them
// apart. A trigger carries either visible text or its own aria-label.
type Trigger = React.ReactElement<Record<string, unknown>>;

/**
 * A filter box that is there before it is seen.
 *
 * The list is what the reader came for, so it opens without a box above it.
 * The input still holds the focus, so the first keystroke lands in it and
 * brings it into view with what was typed already in it. A menu that hides
 * its typeahead is what every other menu does.
 */
function Filter({
  name,
  value,
  onChange,
}: {
  name: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className={cn(!value && "sr-only")}>
      <CommandInput
        placeholder={`${name}...`}
        value={value}
        onValueChange={onChange}
      />
    </div>
  );
}

/**
 * One choice, filtered by typing.
 *
 * Every one of these opens with the cursor in a search box, so "pri" reaches
 * Priya without a hand leaving the keyboard. A list of five needs no filter
 * and a list of fifty does, and one behaviour for both is easier to learn
 * than a rule about when the box appears.
 */
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
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        // The box goes back out of sight with what was typed in it.
        if (!next) setSearch("");
      }}
    >
      <PopoverTrigger render={trigger} />
      <PopoverContent align="start" className="w-56 p-0">
        <Command>
          <Filter name={name} value={search} onChange={setSearch} />
          <CommandList>
            <CommandEmpty>Nothing of that name.</CommandEmpty>
            <CommandGroup>
              {options.map((option) => (
                <CommandItem
                  key={option}
                  value={labels[option]}
                  onSelect={() => {
                    onChange(option);
                    setOpen(false);
                  }}
                >
                  {glyphs?.(option)}
                  {labels[option]}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
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
      <PopoverTrigger render={trigger} />
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

/** What one toolbar button does to the box. */
interface Mark {
  name: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Pressed with the platform's own modifier key. */
  shortcut?: string;
  /** Typed before and after the selection. */
  wrap?: [string, string];
  /** Typed at the head of every line the selection touches. */
  lines?: (index: number) => string;
  /** The one that builds something rather than marking what is there. */
  link?: boolean;
  /** A rule drawn before this one, where the kind of mark changes. */
  breaks?: boolean;
}

// Held out here as plain data. The buttons need the box, and a list of
// closures over it built during a render is a ref read where React forbids
// one; this way the box is only ever reached from a handler.
//
// Three groups, in the order a writer reaches for them: marks on a phrase,
// then what a paragraph is, then lists.
const MARKS: Mark[] = [
  { name: "Bold", icon: BoldIcon, shortcut: "b", wrap: ["**", "**"] },
  { name: "Italic", icon: ItalicIcon, shortcut: "i", wrap: ["_", "_"] },
  {
    name: "Strikethrough",
    icon: StrikethroughIcon,
    wrap: ["~~", "~~"],
  },
  { name: "Code", icon: CodeIcon, shortcut: "e", wrap: ["`", "`"] },
  { name: "Link", icon: LinkIcon, shortcut: "k", link: true },
  {
    name: "Heading",
    icon: Heading2Icon,
    breaks: true,
    lines: () => "## ",
  },
  { name: "Quote", icon: QuoteIcon, lines: () => "> " },
  {
    name: "Code block",
    icon: SquareCodeIcon,
    wrap: ["```\n", "\n```"],
  },
  {
    name: "Bulleted list",
    icon: ListIcon,
    breaks: true,
    lines: () => "- ",
  },
  {
    name: "Numbered list",
    icon: ListOrderedIcon,
    lines: (index) => `${index + 1}. `,
  },
  { name: "Checklist", icon: ListChecksIcon, lines: () => "- [ ] " },
];

/**
 * The description, with the marks a writer reaches for above it.
 *
 * The buttons type markdown into the box rather than hiding it behind a
 * rendered view. The field is one string on the way to Jira, and a writer who
 * can see the asterisks can fix them; a writer looking at bold text cannot.
 *
 * Both modals use this one, because a create form and a detail view asking
 * for the same thing in two ways is how the two drift apart.
 */
export function DescriptionField({
  value,
  onChange,
  rows,
  className,
}: {
  value: string;
  onChange: (description: string) => void;
  rows: number;
  className?: string;
}) {
  const box = useRef<HTMLTextAreaElement>(null);
  // The toolbar is for whoever is writing. Anyone reading the form past it
  // has eleven other fields to take in, so it waits until it is wanted.
  const [writing, setWriting] = useState(false);

  function run(mark: Mark) {
    const el = box.current;
    if (!el) return;
    const from = el.selectionStart;
    const to = el.selectionEnd;

    // React owns the value, so the caret has to be put back after the render
    // that carries the new text. Without this every button sends the caret to
    // the end, and the next word lands in the wrong place.
    const apply = (text: string, at: number, until: number) => {
      onChange(text);
      requestAnimationFrame(() => {
        box.current?.focus();
        box.current?.setSelectionRange(at, until);
      });
    };

    if (mark.wrap) {
      const [open, close] = mark.wrap;
      const chosen = value.slice(from, to);
      // Bold on bold text takes the bold off, which is what the button looks
      // like it will do.
      const marked =
        from >= open.length &&
        value.slice(from - open.length, from) === open &&
        value.slice(to, to + close.length) === close;

      if (marked) {
        apply(
          value.slice(0, from - open.length) +
            chosen +
            value.slice(to + close.length),
          from - open.length,
          to - open.length
        );
        return;
      }
      apply(
        value.slice(0, from) + open + chosen + close + value.slice(to),
        from + open.length,
        to + open.length
      );
      return;
    }

    if (mark.lines) {
      const head = value.lastIndexOf("\n", from - 1) + 1;
      const broken = value.indexOf("\n", to);
      const tail = broken === -1 ? value.length : broken;
      const lines = value.slice(head, tail).split("\n");
      // A second press takes the mark off again. On a list of ten that is the
      // difference between one click and ten corrections.
      const marked = lines.every((line, index) =>
        line.startsWith(mark.lines!(index))
      );
      const changed = lines
        .map((line, index) =>
          marked
            ? line.slice(mark.lines!(index).length)
            : mark.lines!(index) + line
        )
        .join("\n");
      apply(
        value.slice(0, head) + changed + value.slice(tail),
        head,
        head + changed.length
      );
      return;
    }

    // The caret lands on the word "url", because that is the part nobody can
    // guess for the writer.
    const words = value.slice(from, to) || "text";
    const made = `[${words}](url)`;
    const at = from + made.length - 4;
    apply(value.slice(0, from) + made + value.slice(to), at, at + 3);
  }

  return (
    <div className="flex flex-col gap-1">
      <div
        role="toolbar"
        aria-label="Description formatting"
        className={cn(
          "-ml-1.5 flex items-center gap-0.5",
          !writing && "hidden"
        )}
      >
        {MARKS.map((mark) => (
          <Fragment key={mark.name}>
            {mark.breaks && (
              <span className="bg-border/70 mx-1 h-4 w-px" aria-hidden="true" />
            )}
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={mark.name}
              title={mark.name}
              className="text-muted-foreground hover:text-foreground"
              // The box loses focus to the button otherwise, and with it the
              // selection the mark was meant to be put around.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => run(mark)}
            >
              <mark.icon />
            </Button>
          </Fragment>
        ))}
      </div>
      <textarea
        ref={box}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onFocus={() => setWriting(true)}
        // A toolbar button takes focus off the box for an instant. Its own
        // mousedown is prevented, so a real blur is somebody leaving.
        onBlur={() => setWriting(false)}
        // The shortcuts are the ones a writer presses without looking. A
        // toolbar nothing but a pointer can reach is half a toolbar.
        onKeyDown={(event) => {
          if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
          const pressed = event.key.toLowerCase();
          const mark = MARKS.find((one) => one.shortcut === pressed);
          if (!mark) return;
          event.preventDefault();
          run(mark);
        }}
        placeholder="Add description..."
        aria-label="Description"
        rows={rows}
        className={cn(
          "placeholder:text-muted-foreground/70 field-sizing-content w-full resize-none bg-transparent text-sm outline-none",
          className
        )}
      />
    </div>
  );
}

/**
 * One box that reads words and answers with a date.
 *
 * The box holds no date of its own. What is set already shows as the
 * placeholder, so the person types over an empty box rather than clearing one
 * first, and an empty box means "leave it alone" rather than "take it away".
 * The cross inside it is how a date comes off, and it is only there when
 * there is a date to take.
 */
export function DateBox({
  name,
  value,
  from,
  text,
  onText,
  onClear,
  ref,
}: {
  name: string;
  value: string | null;
  /** The day the words count from. */
  from: string;
  text: string;
  onText: (text: string) => void;
  onClear: () => void;
  ref?: React.Ref<HTMLInputElement>;
}) {
  const read = parseDate(text, from);
  const typing = text.trim().length > 0;

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <Label htmlFor={`date-${name}`} className="text-[11px]">
        {name}
      </Label>
      <InputGroup>
        <InputGroupInput
          id={`date-${name}`}
          ref={ref}
          autoComplete="off"
          placeholder={value ? formatDay(value) : ""}
          value={text}
          onChange={(event) => onText(event.target.value)}
          aria-invalid={typing && read === null}
        />
        {value && (
          <InputGroupAddon align="inline-end">
            <InputGroupButton
              size="icon-xs"
              aria-label={`Clear the ${name.toLowerCase()} date`}
              onClick={onClear}
            >
              <XIcon aria-hidden="true" />
            </InputGroupButton>
          </InputGroupAddon>
        )}
      </InputGroup>
      {/* What the words came to, so nobody has to save to find out. The line
          holds its height empty, or the arrow beside it would move. */}
      <p
        className={cn(
          "h-4 truncate text-[11px]",
          typing && !read ? "text-destructive" : "text-muted-foreground"
        )}
      >
        {read
          ? formatFullDay(read)
          : typing
            ? "Not a date"
            : value
              ? formatFullDay(value)
              : ""}
      </p>
    </div>
  );
}

/**
 * Both dates, in one box, in words.
 *
 * They sit side by side under the same arrow the badge uses, because a range
 * is the thing a person has in mind: setting the far end after closing the
 * near one is two trips for one thought.
 *
 * Both sets of words live here rather than in the boxes, because the far end
 * counts from the near one. Moving the start changes what "Friday" means in
 * the due box, and a due date read from the old start would sit on the badge
 * disagreeing with the answer printed under the words that produced it.
 */
export function FieldDates({
  trigger,
  start,
  due,
  onChange,
  field,
}: {
  trigger: Trigger;
  start: string | null;
  due: string | null;
  onChange: (dates: { start?: string | null; due?: string | null }) => void;
  /** The box the pointer asked for. Anything but the start date means due. */
  field: "start" | "due";
}) {
  const startBox = useRef<HTMLInputElement>(null);
  const dueBox = useRef<HTMLInputElement>(null);
  // Read once, when the row mounts. A page left open over midnight should not
  // change what "tomorrow" means halfway through typing it.
  const [today] = useState(realToday);
  const [startWords, setStartWords] = useState("");
  const [dueWords, setDueWords] = useState("");
  // What the badge said before anybody touched it. A date lands as it is
  // typed, so taking it back needs the old one kept somewhere.
  const [asOpened, setAsOpened] = useState({ start, due });
  // Held here rather than left to the popover, because the return key closes
  // it from inside a box and needs something to close.
  const [open, setOpen] = useState(false);

  // What the due box says now, counted from a start that has just moved.
  // Words that are not a date leave the date alone, so a half-typed word
  // never takes away what is already set.
  const dueFrom = (near: string | null) =>
    parseDate(dueWords, near ?? today) ?? due;

  // Yesterday's words in today's box are somebody else's question. The date
  // they made is on the badge already, because each date lands as it is typed.
  const shut = (cancel: boolean) => {
    setOpen(false);
    setStartWords("");
    setDueWords("");
    if (cancel) onChange(asOpened);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next, details) => {
        if (next) {
          setAsOpened({ start, due });
          setOpen(true);
          return;
        }
        // The escape key means "forget it", and a person who meant to keep
        // the dates has every other way of closing this.
        shut(details.reason === "escape-key");
      }}
    >
      <PopoverTrigger render={trigger} />
      <PopoverContent
        align="end"
        className="w-80 gap-2 p-2.5"
        initialFocus={field === "start" ? startBox : dueBox}
        // The return key is how a person says they are finished. Nothing is
        // left to save: it closes on what the boxes have already put on the
        // badge.
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            shut(false);
          }
        }}
      >
        {/* The middle row of each column is the box, so centring the row puts
            the arrow level with them both and needs no measurement. */}
        <div className="flex items-center gap-2">
          <DateBox
            ref={startBox}
            name="Start"
            value={start}
            from={today}
            text={startWords}
            onText={(words) => {
              setStartWords(words);
              const moved = parseDate(words, today) ?? start;
              onChange({ start: moved, due: dueFrom(moved) });
            }}
            onClear={() => {
              setStartWords("");
              onChange({ start: null, due: dueFrom(null) });
            }}
          />
          <MoveRightIcon
            className="text-muted-foreground size-4 shrink-0"
            aria-hidden="true"
          />
          <DateBox
            ref={dueBox}
            name="Due"
            value={due}
            // A range is read from its near end. "Friday" on a job starting
            // Tuesday is the Friday of that week, not the one after today.
            from={start ?? today}
            text={dueWords}
            onText={(words) => {
              setDueWords(words);
              const said = parseDate(words, start ?? today);
              if (said) onChange({ due: said });
            }}
            onClear={() => {
              setDueWords("");
              onChange({ due: null });
            }}
          />
        </div>
        <p className="text-muted-foreground border-border/60 border-t pt-2 text-[11px]">
          Words work: tomorrow, Wednesday, next week, in 3 days, 1 Sep. Due
          counts from the start date.
        </p>
      </PopoverContent>
    </Popover>
  );
}

/** Labels add and take away rather than replace, so the list stays open. */
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
  const [search, setSearch] = useState("");

  return (
    <Popover onOpenChange={(open) => !open && setSearch("")}>
      <PopoverTrigger render={trigger} />
      <PopoverContent align="start" className="w-56 p-0">
        <Command>
          <Filter name="Labels" value={search} onChange={setSearch} />
          <CommandList>
            <CommandEmpty>No label of that name.</CommandEmpty>
            <CommandGroup>
              {all.map((label) => {
                const on = chosen.includes(label);
                return (
                  <CommandItem
                    key={label}
                    value={label}
                    data-checked={on}
                    onSelect={() =>
                      onChange(
                        on
                          ? chosen.filter((one) => one !== label)
                          : [...chosen, label]
                      )
                    }
                  >
                    <span
                      className={cn(
                        "size-1.5 shrink-0 rounded-full",
                        dotFor(label)
                      )}
                      aria-hidden="true"
                    />
                    {label}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
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
  open: opened,
  onOpenChange,
}: {
  /** What opens it. A caller holding the state below needs none. */
  trigger?: Trigger;
  /** The rows to go. */
  keys: string[];
  /** Every row the page knows, for working out what else is touched. */
  issues: Issue[];
  onConfirm: () => void;
  /** Held by the caller when a menu item opens the box, because the item is
   *  gone by the time the box is on the screen. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [own, setOwn] = useState(false);
  const open = opened ?? own;
  const setOpen = onOpenChange ?? setOwn;
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
      {trigger && <DialogTrigger render={trigger} />}
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

/**
 * The project's own fields, written where the rest of the form is written.
 *
 * A required one carries the mark, and the caller refuses to file the issue
 * until it holds something. The name comes from the project's settings, and
 * the value is filed under the id, which a rename keeps.
 */
export function CustomFieldInputs({
  fields,
  values,
  onChange,
  showMissing,
}: {
  fields: CustomField[];
  values: Record<string, string>;
  onChange: (values: Record<string, string>) => void;
  /** Mark the empty required ones. Set once the reader has tried to file. */
  showMissing?: boolean;
}) {
  if (fields.length === 0) return null;

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {fields.map((field) => {
        const value = values[field.id] ?? "";
        const missing = showMissing && field.required && !value.trim();
        return (
          <div key={field.id} className="flex min-w-0 flex-col gap-1.5">
            <Label htmlFor={`field-${field.id}`}>
              {field.name}
              {field.required && (
                <span className="text-destructive" aria-hidden="true">
                  *
                </span>
              )}
              {field.required && <span className="sr-only">, required</span>}
            </Label>
            <Input
              id={`field-${field.id}`}
              value={value}
              aria-invalid={missing || undefined}
              onChange={(event) =>
                onChange({ ...values, [field.id]: event.target.value })
              }
              autoComplete="off"
            />
          </div>
        );
      })}
    </div>
  );
}
