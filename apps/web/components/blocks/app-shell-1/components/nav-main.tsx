"use client"

// Adapted from the ReUI app-shell-1 block. Two changes from the original:
// the links are real routes through next/link, and the active item comes from
// the current path rather than a flag in the data.

import { useState, type ReactNode } from "react"
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
  const pathname = usePathname()
  // A row that holds pages of its own opens them rather than going anywhere.
  // The pages are where the reader is headed, and one of them is always the
  // one the row would have led to.
  const [open, setOpen] = useState(() =>
    (child.children ?? []).some((page) => pathname === page.href)
  )

  if (!child.children) {
    return (
      <SidebarMenuSubItem>
        <SidebarMenuSubButton
          render={<Link href={child.href} />}
          isActive={pathname === child.href}
          title={child.label}
        >
          <span>{child.label}</span>
        </SidebarMenuSubButton>
      </SidebarMenuSubItem>
    )
  }

  return (
    <SidebarMenuSubItem>
      <SidebarMenuSubButton
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-controls={`subnav-${child.id}`}
        isActive={child.children.some((page) => pathname === page.href)}
        title={child.label}
      >
        <span className="min-w-0 truncate">{child.label}</span>
        <ChevronRightIcon
          className={cn(
            "ml-auto size-3.5 shrink-0 opacity-60 transition-transform duration-200",
            open && "rotate-90",
            child.action && "mr-5"
          )}
          aria-hidden="true"
        />
      </SidebarMenuSubButton>

      {child.action}

      {open && <NavSubMenu id={child.id} items={child.children} />}
    </SidebarMenuSubItem>
  )
}

// Each level insets from both edges, but only the left one draws the tree, and
// the right one costs a name 24px a level. Drop it.
function NavSubMenu({ id, items }: { id: string; items: NavChild[] }) {
  return (
    <SidebarMenuSub id={`subnav-${id}`} className="mr-0 pr-0">
      {items.length === 0 ? (
        <SidebarMenuSubItem>
          <span className="text-muted-foreground flex h-7 items-center px-2 text-xs">
            None yet
          </span>
        </SidebarMenuSubItem>
      ) : (
        items.map((child) => <NavSubItem key={child.id} child={child} />)
      )}
    </SidebarMenuSub>
  )
}

// The rail has no room to nest, so every level flattens into one list. A row
// that holds others becomes a heading above them, indented by its depth.
function railRows(rows: NavChild[], depth = 0): ReactNode[] {
  return rows.flatMap((row) => {
    const indent = { paddingLeft: 8 + depth * 12 }
    return row.children
      ? [
          <DropdownMenuLabel key={row.id} style={indent}>
            {row.label}
          </DropdownMenuLabel>,
          ...railRows(row.children, depth + 1),
        ]
      : [
          <DropdownMenuItem
            key={row.id}
            render={<Link href={row.href} />}
            style={indent}
          >
            {row.label}
          </DropdownMenuItem>,
        ]
  })
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
            {railRows(item.children)}
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
            open && "rotate-90",
            // The action sits on the right edge, so the chevron steps aside.
            item.action && "mr-5"
          )}
          aria-hidden="true"
        />
      </SidebarMenuButton>

      {item.action}

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

/** One labelled group of nav items. Project management uses it too. */
export function NavGroup({
  label,
  items,
}: {
  label: string
  items: NavItem[]
}) {
  const pathname = usePathname()

  return (
    <SidebarGroup>
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu className="gap-1!">
          {items.map((item) => {
            // Any depth, because a project's pages sit two levels down and
            // the group above them still has to read as the active one.
            const holds = (rows: NavChild[]): boolean =>
              rows.some(
                (row) => row.href === pathname || holds(row.children ?? [])
              )
            const isActive = item.href
              ? pathname === item.href
              : holds(item.children ?? [])
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

export function NavMain() {
  const { space } = useSpace()
  const { facts } = useReview()
  return <NavGroup label="Assistant" items={navMain(space, facts)} />
}
