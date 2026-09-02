"use client";

// The custom fields one project carries.
//
// Jira lets a project hold fields this model never names. Collibra's board
// has two, and an issue filed without Customer on it is an issue nobody can
// bill. So the list lives here, and both issue forms read it.
//
// A field is picked from what the site offers rather than typed. A typed name
// is a name that agrees with Jira only by luck, and the day it does not, the
// value is written to a field that does not exist.
//
// The list is a row in `workspace_fields` since KPA-127, filed under
// `workspaces.id`, so a rename of the workspace moves nothing.
//
// ponytail: JIRA_FIELDS carries a slug per field and no tracker id, and
// migration 021 requires the tracker id on every row rather than deriving one
// from the name. So a field added from the catalogue is shown and refused by
// the route. The scan that fills the catalogue is the worker's, and KPA-105 is
// where it lands.

import { useState } from "react";
import {
  CheckIcon,
  PlusIcon,
  RefreshCwIcon,
  XIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { FIELDS_SCANNED_AT, JIRA_FIELDS } from "@/lib/fixtures";
import { formatShortDay } from "@/lib/format";
import {
  setWorkspaceFields,
  useWorkspaceFields,
  type WorkspaceField,
} from "@/lib/workspace-fields";
import type { CustomField } from "@/lib/types";

/**
 * One chosen field.
 *
 * The pill opens a menu rather than hiding two gestures inside itself. A
 * click that means one thing on the left and another on the right is a click
 * nobody gets right twice.
 */
function FieldPill({
  field,
  onRequired,
  onRemove,
}: {
  field: CustomField;
  onRequired: (required: boolean) => void;
  onRemove: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className={cn(
              "focus-visible:ring-ring inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-full border px-2.5 text-xs whitespace-nowrap focus-visible:ring-2 focus-visible:outline-none",
              field.required
                ? "border-primary/40 bg-primary/10 text-primary"
                : "border-border/70 text-foreground hover:bg-sidebar-accent"
            )}
          />
        }
        aria-label={`${field.name}${field.required ? ", required" : ""}`}
      >
        {field.name}
        {field.required && (
          <span className="text-primary" aria-hidden="true">
            *
          </span>
        )}
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="min-w-52">
        <DropdownMenuGroup>
          <DropdownMenuCheckboxItem
            checked={field.required}
            closeOnClick={false}
            onCheckedChange={onRequired}
          >
            Required on a new issue
          </DropdownMenuCheckboxItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={onRemove}>
            <XIcon aria-hidden="true" />
            Take it off this project
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Pick from what the site offers, by typing enough of the name. */
function AddField({
  taken,
  onAdd,
}: {
  taken: string[];
  onAdd: (field: { id: string; name: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const spare = JIRA_FIELDS.filter((field) => !taken.includes(field.id));

  function add(field: { id: string; name: string }) {
    onAdd(field);
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={<Button variant="outline" size="sm" />}
        disabled={spare.length === 0}
      >
        <PlusIcon aria-hidden="true" />
        {spare.length === 0 ? "Every field is on" : "Add a field"}
      </PopoverTrigger>

      <PopoverContent align="start" className="w-72 p-0">
        <Command
          // Tab takes the highlighted match, which is the gesture a reader
          // already uses to accept a completion. Enter does the same.
          onKeyDown={(event) => {
            if (event.key !== "Tab") return;
            const active = event.currentTarget.querySelector<HTMLElement>(
              '[cmdk-item][data-selected="true"]'
            );
            if (!active) return;
            event.preventDefault();
            active.click();
          }}
        >
          <CommandInput placeholder="Search the site's fields..." />
          <CommandList>
            <CommandEmpty>
              No field of that name. A scan brings in anything new.
            </CommandEmpty>
            <CommandGroup>
              {spare.map((field) => (
                <CommandItem
                  key={field.id}
                  value={field.name}
                  onSelect={() => add(field)}
                >
                  {field.name}
                  <span className="text-muted-foreground ml-auto font-mono text-[11px]">
                    {field.id}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export function CustomFields({ project }: { project: string }) {
  const fields = useWorkspaceFields(project);
  const [scan, setScan] = useState<{ at: string; running: boolean }>({
    at: FIELDS_SCANNED_AT,
    running: false,
  });

  const write = (next: WorkspaceField[]) => setWorkspaceFields(project, next);

  function rescan() {
    setScan((current) => ({ ...current, running: true }));
    // Reading the site's fields is the worker's call. Here it re-reads what
    // the last scan left, which is what the catalogue below already holds.
    setTimeout(
      () =>
        setScan({ at: new Date().toISOString().slice(0, 10), running: false }),
      600
    );
  }

  return (
    <div className="border-border/70 flex flex-col gap-4 rounded-lg border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-muted-foreground text-xs">
          {JIRA_FIELDS.length} fields on the site, read {formatShortDay(scan.at)}.
        </p>
        <Button
          variant="ghost"
          size="sm"
          onClick={rescan}
          disabled={scan.running}
          aria-label="Rescan the site's custom fields"
        >
          <RefreshCwIcon
            className={cn(scan.running && "animate-spin")}
            aria-hidden="true"
          />
          {scan.running ? "Scanning" : "Rescan"}
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {fields.map((field) => (
          <FieldPill
            key={field.id}
            field={field}
            onRequired={(required) =>
              write(
                fields.map((one) =>
                  one.id === field.id ? { ...one, required } : one
                )
              )
            }
            onRemove={() => write(fields.filter((one) => one.id !== field.id))}
          />
        ))}

        <AddField
          taken={fields.map((field) => field.id)}
          onAdd={(field) =>
            write([...fields, { ...field, jiraId: "", required: false }])
          }
        />
      </div>

      {fields.length === 0 ? (
        <p className="text-muted-foreground text-xs">
          {project} carries no custom fields. Add one and it appears on every
          issue in this project.
        </p>
      ) : (
        <p className="text-muted-foreground flex items-start gap-2 text-xs">
          <CheckIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          A pill opens its own menu. Mark one required and a new issue cannot
          be filed until it holds something.
        </p>
      )}
    </div>
  );
}
