"use client"

// The project management group, between Assistant and Resources.
//
// Sprints and Workspaces are the two ways into the same Jira board: by the
// window of time, or by who the work is for. A workspace holds its projects,
// and both levels take a new row through the same dialog.

import { useId, useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { SidebarMenuAction } from "@/components/ui/sidebar"
import {
  SPRINTS_NAV,
  workspacePages,
  WORKSPACES_ICON,
  WORKSPACES_NAV,
  type NavChild,
} from "./data"
import { NavGroup } from "./nav-main"
import { PlusIcon, SearchIcon } from "lucide-react"

/** A name becomes the route it is reached at. */
function slug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

/** One labelled field, laid out as the name field above it is. */
function Field({
  label,
  hint,
  children,
}: {
  label: React.ReactNode
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-2">
      {label}
      {children}
      {hint && <p className="text-muted-foreground text-xs">{hint}</p>}
    </div>
  )
}

/**
 * What a Collibra project needs beyond a name.
 *
 * Collibra runs every engagement through one Jira project, so a label is what
 * tells one engagement's issues from another's. The dates belong to the
 * contract rather than to Jira, which is why they come from Salesforce.
 *
 * ponytail: placeholders. The two fields a person fills take text and drop it
 * on submit, because nothing stores a project yet. The three the lookup would
 * fill stay shut, because there is no lookup. Wire both when the Jira and
 * Salesforce calls exist.
 */
function CollibraFields() {
  return (
    <>
      <Field
        label={<Label htmlFor="project-description">Description</Label>}
        hint="Optional. What the engagement covers."
      >
        <Textarea id="project-description" rows={3} />
      </Field>

      <Field
        label={<Label htmlFor="project-label">Jira label</Label>}
        hint="An issue carrying this label belongs to the project."
      >
        <Input id="project-label" placeholder="bhp-meridian" />
      </Field>

      <Field
        label={<Label htmlFor="project-salesforce">Salesforce project</Label>}
        hint="Salesforce is not connected yet, so the box searches nothing. The project linked here will set the start and end dates."
      >
        <InputGroup>
          <InputGroupAddon>
            <SearchIcon className="size-4" aria-hidden="true" />
          </InputGroupAddon>
          <InputGroupInput
            id="project-salesforce"
            placeholder="Find in Salesforce"
          />
        </InputGroup>
        <div className="grid grid-cols-2 gap-2">
          <Input aria-label="Start date" placeholder="Start" disabled />
          <Input aria-label="End date" placeholder="End" disabled />
        </div>
      </Field>
    </>
  )
}

/** The + on a row that holds others. One dialog serves every level. */
function AddRow({
  what,
  aria,
  placeholder,
  className,
  detailed = false,
  onAdd,
}: {
  what: string
  aria: string
  placeholder: string
  className?: string
  /** Collibra asks for more than a name. Every other workspace does not. */
  detailed?: boolean
  onAdd: (row: NavChild) => void
}) {
  const fieldId = useId()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const id = slug(name)
  const noun = what.toLowerCase()

  function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!id) return
    onAdd({ id, label: name.trim(), href: `/projects/${id}` })
    setName("")
    setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={<SidebarMenuAction aria-label={aria} className={className} />}
      >
        <PlusIcon aria-hidden="true" />
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a {noun}</DialogTitle>
          <DialogDescription>
            The name becomes the address the {noun} is reached at. Nothing
            reaches Jira yet, so the {noun} holds for this session only.
            {detailed &&
              " The fields below it are placeholders, and nothing keeps what you type in them."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor={fieldId}>{what} name</Label>
            <Input
              id={fieldId}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={placeholder}
              autoComplete="off"
              autoFocus
            />
            {id && (
              <p className="text-muted-foreground text-xs">/projects/{id}</p>
            )}
          </div>

          {detailed && <CollibraFields />}

          <DialogFooter>
            <DialogClose render={<Button variant="outline" type="button" />}>
              Cancel
            </DialogClose>
            <Button type="submit" disabled={!id}>
              Add {noun}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Replace one page of a workspace, leaving the rest of it alone. */
function withPage(
  workspace: NavChild,
  pageId: string,
  change: (page: NavChild) => NavChild
): NavChild {
  return {
    ...workspace,
    children: workspace.children?.map((page) =>
      page.id === pageId ? change(page) : page
    ),
  }
}

export function NavProjects() {
  // ponytail: the added rows hold in memory only.
  // `migrations/018_workspaces_and_projects.sql` is the table they belong in,
  // and slice seven is where this writes to it. A project needs a match rule
  // there, so a row added here inserts with its slug as the Jira label, which
  // is what every seeded Collibra project already carries.
  const [workspaces, setWorkspaces] = useState<NavChild[]>(WORKSPACES_NAV)

  function addWorkspace(row: NavChild) {
    setWorkspaces((current) =>
      current.some((workspace) => workspace.id === row.id)
        ? current
        : [...current, { ...row, children: workspacePages(row.href) }]
    )
  }

  function addProject(workspaceId: string, row: NavChild) {
    setWorkspaces((current) =>
      current.map((workspace) =>
        workspace.id !== workspaceId
          ? workspace
          : withPage(workspace, "projects", (page) =>
              page.children?.some((project) => project.id === row.id)
                ? page
                : { ...page, children: [...(page.children ?? []), row] }
            )
      )
    )
  }

  // The + belongs to the row it sits on, so it is built here rather than held
  // in state beside the data it would go stale against.
  const items = workspaces.map((workspace) => {
    const collibra = workspace.id === "collibra"
    return withPage(workspace, "projects", (page) => ({
      ...page,
      action: (
        <AddRow
          what="Project"
          aria={`Add a project to ${workspace.label}`}
          placeholder={collibra ? "BHP Meridian" : "Marinucci Support"}
          className="top-1"
          detailed={collibra}
          onAdd={(row) => addProject(workspace.id, row)}
        />
      ),
    }))
  })

  return (
    <NavGroup
      label="Project management"
      items={[
        SPRINTS_NAV,
        {
          id: "workspaces",
          label: "Workspaces",
          icon: WORKSPACES_ICON,
          children: items,
          action: (
            <AddRow
              what="Workspace"
              aria="Add a workspace"
              placeholder="Koinon Engineering"
              onAdd={addWorkspace}
            />
          ),
        },
      ]}
    />
  )
}
