"use client"

import { useState } from "react"

import { cn } from "@/lib/utils"
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Item, ItemMedia } from "@/components/ui/item"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { WORKSPACES, type Workspace } from "./data"
import { CheckIcon, MoreHorizontalIcon, PlusIcon } from "lucide-react"

function getWorkspaceInitials(name: string): string {
  return name.charAt(0).toUpperCase()
}

function AuthLogo({ className }: { className?: string }) {
  return (
    <Item
      className={cn(
        "p-0",
        "bg-primary text-primary-foreground flex size-8 shrink-0 items-center justify-center",
        className
      )}
      aria-hidden="true"
    >
      <ItemMedia variant="icon" className="size-auto">
        <svg
          width="50"
          height="50"
          viewBox="25.668 25.1352 49.6644 50"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="size-4"
        >
          <circle cx="70.634" cy="29.8334" r="4.69799" fill="currentColor" />
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M25.668 57.0144V29.8332C25.668 27.2386 27.7713 25.1352 30.366 25.1352C32.9606 25.1352 35.0639 27.2386 35.0639 29.8332V57.0144C35.0639 61.833 38.9702 65.7392 43.7888 65.7392H57.2116C62.0302 65.7392 65.9364 61.833 65.9364 57.0144V43.7258C65.9364 41.1312 68.0398 39.0278 70.6344 39.0278C73.229 39.0278 75.3324 41.1312 75.3324 43.7258V57.0144C75.3324 67.0222 67.2194 75.1352 57.2116 75.1352H43.7888C33.7809 75.1352 25.668 67.0222 25.668 57.0144Z"
            fill="currentColor"
          />
        </svg>
      </ItemMedia>
    </Item>
  )
}

function SidebarLogo({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "relative flex size-6 shrink-0 items-center justify-center",
        className
      )}
    >
      <AuthLogo className="absolute top-1/2 left-1/2 origin-center -translate-x-1/2 -translate-y-1/2 scale-75" />
    </span>
  )
}

function WorkspaceAvatar({
  workspace,
  className,
  size = "default",
}: {
  workspace: Workspace
  className?: string
  size?: "default" | "sm" | "lg"
}) {
  const initials = getWorkspaceInitials(workspace.name)
  return (
    <Avatar size={size} className={cn("size-6! shrink-0", className)}>
      {workspace.imageUrl ? (
        <AvatarImage
          src={workspace.imageUrl}
          alt={workspace.name}
          className="rounded-md"
        />
      ) : null}
      <AvatarFallback
        className={cn(
          "rounded-md text-sm",
          workspace.avatarClassName ?? "bg-primary text-primary-foreground"
        )}
      >
        {initials}
      </AvatarFallback>
    </Avatar>
  )
}

function WorkspaceItem({
  workspace,
  isActive,
  onSelect,
}: {
  workspace: Workspace
  isActive: boolean
  onSelect: (ws: Workspace) => void
}) {
  return (
    <DropdownMenuItem onClick={() => onSelect(workspace)}>
      <WorkspaceAvatar workspace={workspace} />
      <div className="flex items-center gap-1">
        <span className="truncate text-sm">{workspace.name}</span>
      </div>
      {isActive && (
        <CheckIcon aria-hidden="true" className="ml-auto size-3.5" />
      )}
    </DropdownMenuItem>
  )
}

export function WorkspaceSwitcher() {
  const [active, setActive] = useState<Workspace>(WORKSPACES[0])

  return (
    <SidebarMenu>
      {/* Sidebar */}
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton
                className="h-9"
                aria-label="Switch workspace"
              />
            }
          >
            <SidebarLogo className="transition-[margin] duration-300 ease-in-out in-data-[state=collapsed]:-ml-1" />
            <div className="truncate font-semibold">{active.name}</div>
            <MoreHorizontalIcon aria-hidden="true" className="ml-auto size-3.5 opacity-60" />
          </DropdownMenuTrigger>

          <DropdownMenuContent side="bottom" align="start" sideOffset={4}>
            <DropdownMenuGroup>
              <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
              <DropdownMenuGroup>
                {WORKSPACES.map((ws) => (
                  <WorkspaceItem
                    key={ws.id}
                    workspace={ws}
                    isActive={active.id === ws.id}
                    onSelect={setActive}
                  />
                ))}
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem>
                <PlusIcon aria-hidden="true" className="mx-1 size-4" />
                <div className="flex flex-col items-start">
                  <span className="text-sm">New Workspace</span>
                  <span className="text-muted-foreground ml-auto text-xs">
                    Collaborate with others.
                  </span>
                </div>
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}