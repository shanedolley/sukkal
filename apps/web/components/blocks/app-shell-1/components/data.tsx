import { type ReactNode } from "react"
import { HouseIcon, ZapIcon, LayersIcon, ActivityIcon, ShieldCheckIcon, SettingsIcon, UsersIcon, BookOpenIcon, ExternalLinkIcon, CopyIcon, StarIcon, Trash2Icon } from "lucide-react"

// ── Types ──

export type NavChild = {
  id: string
  label: string
  isActive?: boolean
}

export type NavItem = {
  id: string
  label: string
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

// ── Workspaces ──

export const WORKSPACES: Workspace[] = [
  {
    id: "reui",
    name: "ReUI",
    tier: "Pro",
    avatarClassName: "bg-primary text-primary-foreground",
  },
  {
    id: "keenthemes",
    name: "Keenthemes",
    avatarClassName: "bg-blue-500 text-white",
  },
  {
    id: "metronic",
    name: "Metronic",
    avatarClassName: "bg-red-500 text-white",
  },
]

// ── Nav Main ──

export const NAV_MAIN: NavItem[] = [
  {
    id: "overview",
    label: "Overview",
    icon: (
      <HouseIcon aria-hidden="true" />
    ),
    isActive: true,
  },
  {
    id: "pipelines",
    label: "Pipelines",
    icon: (
      <ZapIcon aria-hidden="true" />
    ),
    children: [
      { id: "builds", label: "Build Runs" },
      { id: "deployments", label: "Deployments", isActive: true },
      { id: "releases", label: "Release Gates" },
    ],
  },
  {
    id: "infrastructure",
    label: "Infrastructure",
    icon: (
      <LayersIcon aria-hidden="true" />
    ),
    children: [
      { id: "clusters", label: "Clusters" },
      { id: "namespaces", label: "Namespaces" },
      { id: "storage", label: "Storage Volumes" },
    ],
  },
  {
    id: "observability",
    label: "Observability",
    icon: (
      <ActivityIcon aria-hidden="true" />
    ),
    badge: "14",
  },
  {
    id: "security",
    label: "Security",
    icon: (
      <ShieldCheckIcon aria-hidden="true" />
    ),
  },
]

// ── Pinned Resources ──

export const PINNED_RESOURCES: PinnedResource[] = [
  { id: "api", name: "API Gateway", color: "bg-emerald-500", env: "Prod" },
  { id: "ml", name: "ML Pipeline", color: "bg-violet-500" },
  { id: "db", name: "Database", color: "bg-blue-500", env: "US-East" },
  { id: "cdn", name: "CDN", color: "bg-amber-500" },
  { id: "auth", name: "Authentication", color: "bg-rose-500" },
]

// ── Nav Secondary ──

export const NAV_SECONDARY: SecondaryItem[] = [
  {
    id: "settings",
    label: "Settings",
    icon: (
      <SettingsIcon aria-hidden="true" />
    ),
  },
  {
    id: "invite",
    label: "Invite Team",
    icon: (
      <UsersIcon aria-hidden="true" />
    ),
  },
  {
    id: "docs",
    label: "Documentation",
    icon: (
      <BookOpenIcon aria-hidden="true" />
    ),
  },
]

// ── Item Actions ──

export const ITEM_ACTIONS: ItemAction[] = [
  {
    id: "open",
    label: "Details",
    icon: (
      <ExternalLinkIcon aria-hidden="true" />
    ),
    destructive: false,
  },
  {
    id: "copy",
    label: "Copy Link",
    icon: (
      <CopyIcon aria-hidden="true" />
    ),
    destructive: false,
  },
  {
    id: "pin",
    label: "Pin to Favorites",
    icon: (
      <StarIcon aria-hidden="true" />
    ),
    destructive: false,
  },
  {
    id: "remove",
    label: "Remove",
    icon: (
      <Trash2Icon aria-hidden="true" />
    ),
    destructive: true,
  },
]