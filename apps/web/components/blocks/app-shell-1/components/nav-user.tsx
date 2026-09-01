"use client"

import { useEffect, useState } from "react"
import { useTheme } from "next-themes"

import { cn } from "@/lib/utils"
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import { SunIcon, MoonIcon, MonitorIcon, UserIcon, CreditCardIcon, SettingsIcon, LifeBuoyIcon, BookOpenIcon, PaletteIcon, LogOutIcon, MoreHorizontalIcon } from "lucide-react"

// ── Constants ──

// The brief's "Users" decision: one user, Shane. No permission model.
// No avatar URL: the box is on a home LAN behind Cloudflare Access, and the
// initials fallback is what renders when a remote image cannot load.
const USER = {
  name: "Shane Dolley",
  email: "shane@koinon.com.au",
  avatar: "",
  initials: "SD",
} as const

const THEMES = [
  {
    value: "light",
    label: "Light",
    icon: (
      <SunIcon className="size-3.5" aria-hidden="true" />
    ),
  },
  {
    value: "dark",
    label: "Dark",
    icon: (
      <MoonIcon className="size-3.5" aria-hidden="true" />
    ),
  },
  {
    value: "system",
    label: "System",
    icon: (
      <MonitorIcon className="size-3.5" aria-hidden="true" />
    ),
  },
]

// ── Theme Toggle ──

function ThemeSegmentedToggle() {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  const currentTheme = mounted ? (theme ?? "system") : "system"

  return (
    // A group of pressed buttons, not a radiogroup. The block declared
    // role="radiogroup" with three separate tab stops and no arrow-key
    // handling, so a screen reader announced a model the keyboard did not
    // honour. aria-pressed says the same thing and is true of the markup.
    <div
      role="group"
      aria-label="Theme"
      className="bg-muted/60 inline-flex items-center gap-0.5 rounded-full p-0.5"
    >
      {THEMES.map(({ value, label, icon }) => {
        const isActive = currentTheme === value
        return (
          <Button
            key={value}
            type="button"
            aria-pressed={isActive}
            aria-label={label}
            variant="ghost"
            size="icon-xs"
            onClick={() => setTheme(value)}
            className={cn(
              "rounded-full",
              isActive
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {icon}
          </Button>
        )
      })}
    </div>
  )
}

// ── Menu Sections ──

function UserMenuHeader() {
  return (
    <DropdownMenuLabel className="flex items-center gap-2.5 py-2">
      <Avatar className="size-8 rounded-md">
        <AvatarImage
          src={USER.avatar}
          alt={USER.name}
          className="rounded-md!"
        />
        <AvatarFallback>{USER.initials}</AvatarFallback>
      </Avatar>
      <div className="flex min-w-0 flex-col">
        <span className="text-foreground text-sm font-semibold">
          {USER.name}
        </span>
        <span className="text-muted-foreground truncate text-xs font-normal">
          {USER.email}
        </span>
      </div>
    </DropdownMenuLabel>
  )
}

function UserMenuAccount() {
  return (
    <DropdownMenuGroup>
      {/* Row */}
      <DropdownMenuItem>
        <UserIcon aria-hidden="true" />
        Profile
        <DropdownMenuShortcut>⇧⌘P</DropdownMenuShortcut>
      </DropdownMenuItem>
      <DropdownMenuItem>
        <CreditCardIcon aria-hidden="true" />
        Billing & Usage
      </DropdownMenuItem>
      <DropdownMenuItem>
        <SettingsIcon aria-hidden="true" />
        Preferences
        <DropdownMenuShortcut>⌘</DropdownMenuShortcut>
      </DropdownMenuItem>
    </DropdownMenuGroup>
  )
}

function UserMenuSupport() {
  return (
    <DropdownMenuGroup>
      {/* Row */}
      <DropdownMenuItem>
        <LifeBuoyIcon aria-hidden="true" />
        Help & Support
      </DropdownMenuItem>
      <DropdownMenuItem>
        <BookOpenIcon aria-hidden="true" />
        API Reference
      </DropdownMenuItem>
    </DropdownMenuGroup>
  )
}

function UserMenuTheme() {
  return (
    <DropdownMenuGroup>
      {/* Row */}
      <DropdownMenuItem className="cursor-default focus:bg-transparent!">
        <PaletteIcon aria-hidden="true" />
        Theme
        <div className="ml-auto">
          <ThemeSegmentedToggle />
        </div>
      </DropdownMenuItem>
    </DropdownMenuGroup>
  )
}

function UserMenuContent() {
  const { isMobile } = useSidebar()

  return (
    <DropdownMenuContent
      side={isMobile ? "top" : "right"}
      align="end"
      sideOffset={8}
      className="w-60"
    >
      {/* List */}
      <DropdownMenuGroup>
        <UserMenuHeader />
        <DropdownMenuSeparator />
        <UserMenuAccount />
        <DropdownMenuSeparator />
        <UserMenuSupport />
        <DropdownMenuSeparator />
        <UserMenuTheme />
        <DropdownMenuSeparator />
        <DropdownMenuItem>
          <LogOutIcon aria-hidden="true" />
          Sign Out
          <DropdownMenuShortcut>⇧⌘Q</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuGroup>
    </DropdownMenuContent>
  )
}

// ── Nav User ──

export function NavUser() {
  return (
    <SidebarMenu>
      {/* Sidebar */}
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            className="bg-background border-border h-auto shrink-0 border p-1.5 text-sm shadow-sm shadow-black/5 group-data-[collapsible=icon]:justify-center"
            render={<SidebarMenuButton size="lg" aria-label="Open user menu" />}
          >
            <Avatar className="size-6 transition-all duration-300 ease-in-out in-data-[state=collapsed]:size-7!">
              <AvatarImage
                src={USER.avatar}
                alt={USER.name}
                className="rounded-md"
              />
              <AvatarFallback>{USER.initials}</AvatarFallback>
            </Avatar>
            <div className="grid min-w-0 flex-1 text-left text-sm leading-tight group-data-[collapsible=icon]:hidden">
              <span className="truncate font-semibold">{USER.name}</span>
            </div>
            <MoreHorizontalIcon className="mr-1 ml-auto size-4 shrink-0 opacity-50 group-data-[collapsible=icon]:hidden" aria-hidden="true" />
          </DropdownMenuTrigger>

          <UserMenuContent />
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}