"use client"

// Adapted from the ReUI app-shell-1 block. The original pointed every item at
// href="#". An item that leads nowhere is worse than one that says it is not
// built, so an item without an href renders as unavailable instead.

import Link from "next/link"
import { usePathname } from "next/navigation"

import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"

import { NAV_SECONDARY, type SecondaryItem } from "./data"

function SecondaryNavItem({ item }: { item: SecondaryItem }) {
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
        tooltip={item.label}
        isActive={pathname === item.href}
        render={<Link href={item.href} />}
        className="[&_svg]:size-3.5"
      >
        {item.icon}
        <span>{item.label}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}

export function NavSecondary() {
  return (
    <SidebarGroup>
      <SidebarMenu>
        {NAV_SECONDARY.map((item) => (
          <SecondaryNavItem key={item.id} item={item} />
        ))}
      </SidebarMenu>
    </SidebarGroup>
  )
}
