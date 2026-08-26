"use client"

import { useState } from "react"
import { Badge } from "@/components/reui/badge"

import { cn } from "@/lib/utils"
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { PINNED_RESOURCES, type PinnedResource } from "./data"
import { ItemActionMenu } from "./item-action-menu"
import { ChevronDownIcon } from "lucide-react"

function ResourceDot({ color }: { color: string }) {
  return (
    <span
      className={cn("mr-1 ml-1.5 size-1.5 shrink-0 rounded-full", color)}
      aria-hidden="true"
    />
  )
}

function ResourceEnvLabel({ env }: { env: string }) {
  return (
    <Badge size="sm" variant="outline">
      {env}
    </Badge>
  )
}

function ResourceItem({ resource }: { resource: PinnedResource }) {
  return (
    <SidebarMenuItem>
      {/* Sidebar */}
      <SidebarMenuButton
        tooltip={
          resource.env ? `${resource.name} · ${resource.env}` : resource.name
        }
        render={<a href="#" />}
      >
        <ResourceDot color={resource.color} />
        <span className="min-w-0 truncate">{resource.name}</span>
        {resource.env && <ResourceEnvLabel env={resource.env} />}
      </SidebarMenuButton>
      {/* Row */}
      <ItemActionMenu label={resource.name} />
    </SidebarMenuItem>
  )
}

function ResourceList() {
  return (
    <SidebarGroupContent id="pinned-resources-list">
      {/* Sidebar */}
      <SidebarMenu className="gap-0.25">
        {PINNED_RESOURCES.map((resource) => (
          <ResourceItem key={resource.id} resource={resource} />
        ))}
      </SidebarMenu>
    </SidebarGroupContent>
  )
}

export function NavResources() {
  const [open, setOpen] = useState(true)

  return (
    <SidebarGroup className="group-data-[collapsible=icon]:hidden">
      {/* Sidebar */}
      <SidebarGroupLabel
        render={
          <button
            onClick={() => setOpen((prev) => !prev)}
            aria-expanded={open}
            aria-controls="pinned-resources-list"
          />
        }
        className="focus-visible:ring-sidebar-ring w-full cursor-pointer focus-visible:ring-2 focus-visible:outline-none"
      >
        Resources
        <ChevronDownIcon className={cn(
                          "ml-auto size-4 shrink-0 opacity-60 transition-transform duration-200",
                          !open && "-rotate-90"
                        )} aria-hidden="true" />
      </SidebarGroupLabel>

      {open && <ResourceList />}
    </SidebarGroup>
  )
}