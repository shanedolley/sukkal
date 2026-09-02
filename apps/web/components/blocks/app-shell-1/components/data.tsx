// Adapted from the ReUI app-shell-1 block. The shapes are the block's; the
// content is KPA's. See docs/project-brief.md.

import { type ReactNode } from "react"
import {
  LayoutDashboardIcon,
  MessagesSquareIcon,
  ScrollTextIcon,
  ShieldCheckIcon,
  BookOpenIcon,
  ScaleIcon,
  PlugIcon,
  SettingsIcon,
  RocketIcon,
  BriefcaseIcon,
  ExternalLinkIcon,
  CopyIcon,
  StarIcon,
  EyeOffIcon,
} from "lucide-react"

import { AUDIT, CONVERSATIONS, MEETINGS } from "@/lib/fixtures"
import { inSpace, type SpaceFilter } from "@/lib/space-context"
import { WORKSPACES } from "@/lib/workspaces"
import type { Fact } from "@/lib/types"

// ── Types ──

export type NavChild = {
  id: string
  label: string
  href: string
  /** Deeper levels. A workspace holds pages, and one page holds projects. */
  children?: NavChild[]
  /** A control on the right of the row, such as the + on Projects. */
  action?: ReactNode
}

/** What every workspace holds. The href is built from the workspace's own. */
export function workspacePages(
  href: string,
  projects: NavChild[] = []
): NavChild[] {
  return [
    // A folder, so the row opens rather than goes anywhere. The href only
    // matters on the collapsed rail, which cannot nest.
    { id: "projects", label: "Projects", href, children: projects },
    { id: "issues", label: "Issues", href: `${href}/issues` },
    { id: "settings", label: "Settings", href: `${href}/settings` },
  ]
}

export type NavItem = {
  id: string
  label: string
  href?: string
  icon: ReactNode
  badge?: string | number
  isActive?: boolean
  children?: NavChild[]
  /** A control on the right of the row, such as the + on Projects. */
  action?: ReactNode
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

/** One choice in the space switcher at the top of the sidebar. */
export type SpaceOption = {
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
// The ReUI block called these workspaces. They are spaces: whose world you
// are looking at. A workspace is a Jira project, and those live in
// lib/workspaces.ts. The brief keeps Collibra and Koinon apart as a guideline
// rather than a wall.

export const SPACE_OPTIONS: SpaceOption[] = [
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

export function navMain(
  space: SpaceFilter,
  facts: Fact[],
  /** Open Needs you rows, or null while the read has not answered. The badge
   *  stays off until it has: a confident number beside a spinner is worse
   *  than no number. */
  needsYou: number | null,
  known = true
): NavItem[] {
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
      badge: needsYou !== null && needsYou > 0 ? needsYou : undefined,
    },
    {
      id: "review",
      label: "Review queue",
      icon: <ScrollTextIcon aria-hidden="true" />,
      children: [
        {
          id: "proposed",
          label: known ? `Proposed facts (${proposed})` : "Proposed facts",
          href: "/review/proposed",
        },
        {
          id: "stale",
          label: known ? `Stale facts (${stale})` : "Stale facts",
          href: "/review/stale",
        },
        {
          id: "meetings",
          label: known ? `Meetings today (${meetings})` : "Meetings today",
          href: "/meetings",
        },
      ],
    },
    {
      id: "chat",
      label: "Chat",
      icon: <MessagesSquareIcon aria-hidden="true" />,
      children: [
        { id: "chat-new", label: "New chat", href: "/chat" },
        {
          id: "chat-history",
          label: `History (${CONVERSATIONS.length})`,
          href: "/chat/history",
        },
      ],
    },
    {
      id: "audit",
      label: "Audit log",
      href: "/audit",
      icon: <ShieldCheckIcon aria-hidden="true" />,
      badge: known && denied > 0 ? denied : undefined,
    },
  ]
}

// ── Sprints and workspaces ──
// Jira, one step removed. The routes exist before the data does, so the shape
// of the section gets reviewed while the API work is still open.

export const SPRINTS_NAV: NavItem = {
  id: "sprints",
  label: "Sprints",
  icon: <RocketIcon aria-hidden="true" />,
  // The future sprint has no entry of its own. The arrows on the current
  // sprint page step to it, which is where a person already is when they
  // wonder what comes next.
  children: [
    { id: "sprint-current", label: "Current sprint", href: "/sprints/current" },
    { id: "sprint-all", label: "All sprints", href: "/sprints/all" },
  ],
}

export const WORKSPACES_ICON = <BriefcaseIcon aria-hidden="true" />

// The sidebar draws the workspaces and the projects inside them. What they
// are and how an issue is matched to one lives in lib/workspaces.ts, because
// the issue screens ask the same question and two lists would drift.

export const WORKSPACES_NAV: NavChild[] = WORKSPACES.map(
  ({ id, name, projects }) => ({
    id,
    label: name,
    href: `/projects/${id}`,
    // Every project opens on its issues, so the one route serves them all.
    children: workspacePages(
      `/projects/${id}`,
      projects.map((project) => ({
        id: project.id,
        label: project.name,
        href: `/projects/${project.id}`,
      }))
    ),
  })
)

/** Every row a key can name: the workspaces and the projects inside them. */
export const NAMED_ROWS: NavChild[] = WORKSPACES.flatMap(
  ({ id, name, projects }) => [
    { id, label: name, href: `/projects/${id}` },
    ...projects.map((project) => ({
      id: project.id,
      label: project.name,
      href: `/projects/${project.id}`,
    })),
  ]
)

// ── Pinned engagements ──

export const PINNED_RESOURCES: PinnedResource[] = [
  { id: "meridian", name: "BHP Meridian", color: "bg-info", env: "Collibra" },
  { id: "maybank", name: "Maybank", color: "bg-primary", env: "Koinon" },
  { id: "sydney-water", name: "Sydney Water", color: "bg-info", env: "Collibra" },
  { id: "tfnsw", name: "Transport for NSW", color: "bg-info", env: "Collibra" },
]

// ── Nav Secondary ──

// A cog means preferences and nothing else. The policy is the set of rules
// the assistant is judged against, which is a different idea and deserves a
// different mark. An item with no href is not built yet, and says so rather
// than pretending to be a link.
export const NAV_SECONDARY: SecondaryItem[] = [
  {
    id: "connections",
    label: "Connections",
    href: "/connections",
    icon: <PlugIcon aria-hidden="true" />,
  },
  {
    id: "policy",
    label: "Policy",
    icon: <ScaleIcon aria-hidden="true" />,
  },
  {
    id: "brief",
    label: "Project brief",
    icon: <BookOpenIcon aria-hidden="true" />,
  },
  {
    id: "settings",
    label: "Preferences",
    href: "/settings",
    icon: <SettingsIcon aria-hidden="true" />,
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
