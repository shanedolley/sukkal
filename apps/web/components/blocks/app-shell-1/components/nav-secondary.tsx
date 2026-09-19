"use client"

// Adapted from the ReUI app-shell-1 block. The original pointed every item at
// href="#". An item that leads nowhere is worse than one that says it is not
// built, so an item without an href renders as unavailable instead.

import { CircleXIcon, TriangleAlertIcon } from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useEffect, type ReactNode } from "react"

import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { describe, health, type Health } from "@/lib/connection-health"
import { reloadConnections, useConnections } from "@/lib/connections"

import { NAV_SECONDARY, type SecondaryItem } from "./data"

/** How often a page left open reads the connections again. The recheck runs
 *  hourly, so this only has to notice its answer, not keep pace with it. */
const RELOAD_MS = 5 * 60 * 1000

/**
 * The mark beside Connections, KPA-107: a green dot when every connection
 * works, a yellow warning when one or more fail, and a red error when all of
 * them fail. Nothing when there are no connections to report on.
 */
function HealthMark({ state }: { state: Health }) {
  if (state === "none") return null
  if (state === "working") {
    return <span aria-hidden="true" className="bg-success block size-2 rounded-full" />
  }
  const Icon = state === "all-failing" ? CircleXIcon : TriangleAlertIcon
  const colour = state === "all-failing" ? "text-destructive" : "text-warning"
  return <Icon aria-hidden="true" className={`${colour} size-3.5!`} />
}

/** The same state as a small spot on the icon, for the collapsed rail, where
 *  the badge beside the label is hidden. */
function RailMark({ state }: { state: Health }) {
  if (state === "none") return null
  const colour =
    state === "working" ? "bg-success" : state === "all-failing" ? "bg-destructive" : "bg-warning"
  return (
    <span
      aria-hidden="true"
      className={`${colour} ring-sidebar pointer-events-none absolute top-1 left-5 hidden size-2 rounded-full ring-2 group-data-[collapsible=icon]:block`}
    />
  )
}

function SecondaryNavItem({
  item,
  mark,
  label = item.label,
}: {
  item: SecondaryItem
  mark?: ReactNode
  label?: string
}) {
  const pathname = usePathname()

  if (!item.href) {
    return (
      <SidebarMenuItem>
        <SidebarMenuButton
          size="sm"
          tooltip={`${item.label} (not built yet)`}
          disabled
          className="[&_svg]:size-3.5"
        >
          {item.icon}
          <span>{item.label}</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    )
  }

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        size="sm"
        tooltip={label}
        aria-label={label}
        isActive={pathname === item.href}
        render={<Link href={item.href} />}
        className="[&_svg]:size-3.5"
      >
        {item.icon}
        <span>{item.label}</span>
      </SidebarMenuButton>
      {mark}
    </SidebarMenuItem>
  )
}

export function NavSecondary() {
  const connections = useConnections()
  const state = health(connections)
  const said = describe(connections)

  // A page left open learns what the hourly recheck found. Reading on a timer
  // is an effect's job: it keeps React in step with something outside it.
  useEffect(() => {
    const timer = setInterval(() => void reloadConnections(), RELOAD_MS)
    return () => clearInterval(timer)
  }, [])

  return (
    <SidebarGroup>
      <SidebarMenu>
        {NAV_SECONDARY.map((item) =>
          item.id === "connections" ? (
            <SecondaryNavItem
              key={item.id}
              item={item}
              label={state === "none" ? item.label : `${item.label}: ${said}`}
              mark={
                <>
                  <SidebarMenuBadge
                    data-health={state}
                    className="peer-data-[size=sm]/menu-button:top-1"
                  >
                    <HealthMark state={state} />
                  </SidebarMenuBadge>
                  <RailMark state={state} />
                </>
              }
            />
          ) : (
            <SecondaryNavItem key={item.id} item={item} />
          )
        )}
      </SidebarMenu>
    </SidebarGroup>
  )
}
