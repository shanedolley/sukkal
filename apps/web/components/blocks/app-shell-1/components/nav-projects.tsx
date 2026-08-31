"use client"

// The project management group, between Assistant and Resources.
//
// Sprints and Projects are the two ways into the same Jira board: by the
// window of time, or by the piece of work. Both render through NavGroup, so
// the collapsed rail, the active row and the submenu behave as they do above.

import { useState } from "react"

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
import { Label } from "@/components/ui/label"
import { SidebarMenuAction } from "@/components/ui/sidebar"
import { PROJECTS, PROJECTS_ICON, SPRINTS_NAV, type NavChild } from "./data"
import { NavGroup } from "./nav-main"
import { PlusIcon } from "lucide-react"

/** A name becomes the route it is reached at. */
function slug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

function AddProject({ onAdd }: { onAdd: (project: NavChild) => void }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const id = slug(name)

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
        render={<SidebarMenuAction aria-label="Add a project" />}
      >
        <PlusIcon aria-hidden="true" />
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a project</DialogTitle>
          <DialogDescription>
            The name becomes the address the project is reached at. Nothing
            reaches Jira yet, so the project holds for this session only.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="project-name">Project name</Label>
            <Input
              id="project-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Marinucci Support"
              autoComplete="off"
              autoFocus
            />
            {id && (
              <p className="text-muted-foreground text-xs">/projects/{id}</p>
            )}
          </div>

          <DialogFooter>
            <DialogClose render={<Button variant="outline" type="button" />}>
              Cancel
            </DialogClose>
            <Button type="submit" disabled={!id}>
              Add project
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function NavProjects() {
  // ponytail: the added projects hold in memory only. Read them from the Jira
  // project list once that call exists.
  const [projects, setProjects] = useState<NavChild[]>(PROJECTS)

  function add(project: NavChild) {
    setProjects((current) =>
      current.some((p) => p.id === project.id) ? current : [...current, project]
    )
  }

  return (
    <NavGroup
      label="Project management"
      items={[
        SPRINTS_NAV,
        {
          id: "projects",
          label: "Projects",
          icon: PROJECTS_ICON,
          children: projects,
          action: <AddProject onAdd={add} />,
        },
      ]}
    />
  )
}
