// Adapted from the ReUI app-shell-1 block. The shapes are the block's; the
// content is KPA's. See docs/project-brief.md.

import { type ReactNode } from "react"
import {
  LayoutDashboardIcon,
  MessagesSquareIcon,
  ScrollTextIcon,
  ShieldCheckIcon,
  BookOpenIcon,
  SettingsIcon,
  ExternalLinkIcon,
  CopyIcon,
  StarIcon,
  EyeOffIcon,
} from "lucide-react"

import { AUDIT, MEETINGS, NEEDS_YOU } from "@/lib/fixtures"
import { inSpace, type SpaceFilter } from "@/lib/space-context"
import type { Fact } from "@/lib/types"

// ── Types ──

export type NavChild = {
  id: string
  label: string
  href: string
}

export type NavItem = {
  id: string
  label: string
  href?: string
  icon: ReactNode
  badge?: string | number
  isActive?: boolean
  children?: NavChild[]
}

export type PinnedResource = {
  id: string
  name: string
  color: string
  env?: string
}

export type SecondaryItem = {
  id: string
  label: string
  icon: ReactNode
  href?: string
}

export type Workspace = {
  id: string
  name: string
  tier?: string
  imageUrl?: string
  /** Tailwind class for avatar/fallback background (e.g. bg-primary, bg-violet-500) */
  avatarClassName?: string
}

export type ItemAction = {
  id: string
  label: string
  icon: ReactNode
  destructive: boolean
}

// ── Spaces ──
// The block calls these workspaces. KPA calls them spaces, and the brief
// keeps Collibra and Koinon apart as a guideline rather than a wall.

export const WORKSPACES: Workspace[] = [
  {
    id: "all",
    name: "All spaces",
    avatarClassName: "bg-primary text-primary-foreground",
  },
  {
    id: "collibra",
    name: "Collibra",
    tier: "Employer",
    avatarClassName: "bg-info text-info-foreground",
  },
  {
    id: "koinon",
    name: "Koinon",
    tier: "Own company",
    avatarClassName: "bg-primary text-primary-foreground",
  },
  {
    id: "personal",
    name: "Personal",
    avatarClassName: "bg-warning text-warning-foreground",
  },
]

// ── Nav Main ──
// Counts follow the space filter, so the sidebar never disagrees with the
// screen beside it.

export function navMain(space: SpaceFilter, facts: Fact[]): NavItem[] {
  const needsYou = inSpace(NEEDS_YOU, space).length
  const proposed = inSpace(facts, space).filter(
    (f) => f.state === "proposed"
  ).length
  const stale = inSpace(facts, space).filter((f) => f.state === "stale").length
  const meetings = inSpace(MEETINGS, space).length
  const denied = inSpace(AUDIT, space).filter(
    (e) => e.outcome === "denied"
  ).length

  return [
    {
      id: "dashboard",
      label: "Briefing",
      href: "/dashboard",
      icon: <LayoutDashboardIcon aria-hidden="true" />,
      badge: needsYou > 0 ? needsYou : undefined,
    },
    {
      id: "review",
      label: "Review queue",
      icon: <ScrollTextIcon aria-hidden="true" />,
      children: [
        {
          id: "proposed",
          label: `Proposed facts (${proposed})`,
          href: "/dashboard#proposed-facts",
        },
        {
          id: "stale",
          label: `Stale facts (${stale})`,
          href: "/dashboard#stale-facts",
        },
        {
          id: "meetings",
          label: `Meetings today (${meetings})`,
          href: "/dashboard#meetings-today",
        },
      ],
    },
    {
      id: "chat",
      label: "Chat",
      href: "/chat",
      icon: <MessagesSquareIcon aria-hidden="true" />,
    },
    {
      id: "audit",
      label: "Audit log",
      href: "/audit",
      icon: <ShieldCheckIcon aria-hidden="true" />,
      badge: denied > 0 ? denied : undefined,
    },
  ]
}

// ── Pinned engagements ──

export const PINNED_RESOURCES: PinnedResource[] = [
  { id: "meridian", name: "BHP Meridian", color: "bg-info", env: "Collibra" },
  { id: "maybank", name: "Maybank", color: "bg-primary", env: "Koinon" },
  { id: "sydney-water", name: "Sydney Water", color: "bg-info", env: "Collibra" },
  { id: "tfnsw", name: "Transport for NSW", color: "bg-info", env: "Collibra" },
]

// ── Nav Secondary ──

export const NAV_SECONDARY: SecondaryItem[] = [
  {
    id: "policy",
    label: "Policy",
    icon: <SettingsIcon aria-hidden="true" />,
  },
  {
    id: "brief",
    label: "Project brief",
    icon: <BookOpenIcon aria-hidden="true" />,
  },
]

// ── Item Actions ──

export const ITEM_ACTIONS: ItemAction[] = [
  {
    id: "open",
    label: "Open engagement",
    icon: <ExternalLinkIcon aria-hidden="true" />,
    destructive: false,
  },
  {
    id: "copy",
    label: "Copy link",
    icon: <CopyIcon aria-hidden="true" />,
    destructive: false,
  },
  {
    id: "unpin",
    label: "Unpin",
    icon: <StarIcon aria-hidden="true" />,
    destructive: false,
  },
  {
    id: "hide",
    label: "Remove from sidebar",
    icon: <EyeOffIcon aria-hidden="true" />,
    destructive: false,
  },
]
