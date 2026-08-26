"use client"

// Adapted from the ReUI app-shell-1 block. Two changes from the original:
// the links are real routes through next/link, and the active item comes from
// the current path rather than a flag in the data.

import { useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { Badge } from "@/components/reui/badge"

import { cn } from "@/lib/utils"
import { useReview } from "@/lib/review-context"
import { useSpace } from "@/lib/space-context"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from "@/components/ui/sidebar"
import { navMain, type NavChild, type NavItem } from "./data"
import { ChevronRightIcon } from "lucide-react"

function NavSubItem({ child }: { child: NavChild }) {
  return (
    <SidebarMenuSubItem>
      <SidebarMenuSubButton render={<Link href={child.href} />}>
        <span>{child.label}</span>
      </SidebarMenuSubButton>
    </SidebarMenuSubItem>
  )
}

function NavSubMenu({ id, items }: { id: string; items: NavChild[] }) {
  return (
    <SidebarMenuSub id={`subnav-${id}`}>
      {items.map((child) => (
        <NavSubItem key={child.id} child={child} />
      ))}
    </SidebarMenuSub>
  )
}

// Collapsed (icon) rail: the inline submenu would push the next item down, so
// the children open in a side dropdown anchored to the icon button instead.
function CollapsedNavItem({
  item,
}: {
  item: NavItem & { children: NavChild[] }
}) {
  return (
    <SidebarMenuItem>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <SidebarMenuButton
              tooltip={item.label}
              isActive={item.isActive}
              aria-label={item.label}
            />
          }
        >
          {item.icon}
          <span>{item.label}</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side="right"
          align="start"
          sideOffset={8}
          className="min-w-48"
        >
          <DropdownMenuGroup>
            <DropdownMenuLabel>{item.label}</DropdownMenuLabel>
            {item.children.map((child) => (
              <DropdownMenuItem key={child.id} render={<Link href={child.href} />}>
                {child.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  )
}

// Expanded rail: the submenu expands inline under its parent button.
function ExpandedNavItem({
  item,
  open,
  onToggle,
}: {
  item: NavItem & { children: NavChild[] }
  open: boolean
  onToggle: () => void
}) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        tooltip={item.label}
        isActive={item.isActive}
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={`subnav-${item.id}`}
      >
        {item.icon}
        <span>{item.label}</span>
        <ChevronRightIcon
          className={cn(
            "ml-auto size-4 shrink-0 opacity-60 transition-transform duration-200",
            open && "rotate-90"
          )}
          aria-hidden="true"
        />
      </SidebarMenuButton>

      {open && <NavSubMenu id={item.id} items={item.children} />}
    </SidebarMenuItem>
  )
}

function CollapsibleNavItem({
  item,
}: {
  item: NavItem & { children: NavChild[] }
}) {
  const { state } = useSidebar()
  // Kept on the always-mounted parent so the expanded open state survives a
  // collapse/expand cycle instead of resetting when the branch swaps.
  const [open, setOpen] = useState(true)

  return state === "collapsed" ? (
    <CollapsedNavItem item={item} />
  ) : (
    <ExpandedNavItem
      item={item}
      open={open}
      onToggle={() => setOpen((prev) => !prev)}
    />
  )
}

function LeafNavItem({ item }: { item: NavItem }) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        tooltip={item.label}
        isActive={item.isActive}
        render={<Link href={item.href ?? "#"} />}
      >
        {item.icon}
        <span>{item.label}</span>
        {item.badge !== undefined && (
          <SidebarMenuBadge>
            <Badge variant="primary-light" size="sm">
              {item.badge}
            </Badge>
          </SidebarMenuBadge>
        )}
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}

export function NavMain() {
  const pathname = usePathname()
  const { space } = useSpace()
  const { facts } = useReview()
  const items = navMain(space, facts)

  return (
    <SidebarGroup>
      <SidebarGroupLabel>Assistant</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu className="gap-1!">
          {items.map((item) => {
            const isActive = item.href ? pathname === item.href : false
            const withActive = { ...item, isActive }
            return item.children ? (
              <CollapsibleNavItem
                key={item.id}
                item={withActive as NavItem & { children: NavChild[] }}
              />
            ) : (
              <LeafNavItem key={item.id} item={withActive} />
            )
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}
