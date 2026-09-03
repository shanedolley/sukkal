"use client"

// The corner of the screen that says who you are.
//
// IT READS THE ACCOUNT ROW, and KPA-144 is why. The ReUI block KPA-37 adapted
// named Shane Dolley and his address in code, and that was true while the brief
// gave the system one user called Shane. ADR-0009 changed it to one owner per
// installation, so somebody who pulls the container down and sets it up was
// reading Shane's name in the corner they look at most.
//
// NOTHING IS SHOWN UNTIL THE READ ANSWERS. `lib/account.ts` reports "loading"
// before the fetch lands and "error" when it fails, and neither may paint a
// name. A wrong name here is worse than no name, because this is the one place
// a person checks whose box they are on.
//
// FOUR ITEMS ARE GONE. Profile, Billing and Usage, Help and Support and API
// Reference came from the block and did nothing. Profile said the same thing
// Preferences says on a box with one account, Billing describes a product this
// is not, and the other two point at documentation nobody wrote. What is left
// goes somewhere: Preferences opens /settings, the theme toggle works, and
// Sign Out ends the session.

import { useEffect, useState } from "react"
import { useTheme } from "next-themes"
import Link from "next/link"

import { useOwner } from "@/lib/account"
import { initialsOf } from "@/lib/initials"
import { cn } from "@/lib/utils"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
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
import { Skeleton } from "@/components/ui/skeleton"
import { SunIcon, MoonIcon, MonitorIcon, SettingsIcon, PaletteIcon, LogOutIcon, MoreHorizontalIcon } from "lucide-react"

// ── Who is signed in ──

/** What the menu shows, and whether it may be shown yet. */
function useIdentity() {
  const { status, account } = useOwner()
  if (status !== "ready" || account === null) {
    return { ready: false, name: "", email: "", initials: "" }
  }
  return {
    ready: true,
    name: account.name,
    email: account.email,
    initials: initialsOf(account.name),
  }
}

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

// ── Signing out ──

/**
 * Ends the session on the server, then leaves.
 *
 * KPA-77 built `DELETE /api/session`, which removes the row, and this item sat
 * over nothing until KPA-128. Clearing the cookie is not what ends a session:
 * the delete is, which is why this waits for the answer before it navigates.
 *
 * A hard navigation rather than the router, for the reason `sign-in-form.tsx`
 * gives. The module-level store in `lib/account.ts` holds the account this
 * browser was just shown, and a full load is what empties it.
 */
function signOut() {
  void fetch("/api/session", { method: "DELETE" })
    .catch((cause: unknown) => {
      // The row may still stand. Leaving anyway is right: the person asked to
      // go, and the cookie dies with the session it names inside a fortnight.
      console.error("sign out:", cause)
    })
    .finally(() => {
      window.location.assign("/sign-in")
    })
}

// ── Menu Sections ──

function UserMenuHeader() {
  const { ready, name, email, initials } = useIdentity()

  return (
    <DropdownMenuLabel className="flex items-center gap-2.5 py-2">
      <Avatar className="size-8 rounded-md">
        <AvatarFallback>{ready ? initials : "?"}</AvatarFallback>
      </Avatar>
      <div className="flex min-w-0 flex-col gap-1">
        {ready ? (
          <>
            <span className="text-foreground text-sm font-semibold">
              {name}
            </span>
            <span className="text-muted-foreground truncate text-xs font-normal">
              {email}
            </span>
          </>
        ) : (
          <>
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-3 w-36" />
          </>
        )}
      </div>
    </DropdownMenuLabel>
  )
}

function UserMenuAccount() {
  return (
    <DropdownMenuGroup>
      {/* The shortcut is real. `components/shortcuts.tsx` registers the comma
          and pushes the same route, so the hint and the key agree. */}
      <DropdownMenuItem
        render={<Link href="/settings" />}
        nativeButton={false}
      >
        <SettingsIcon aria-hidden="true" />
        Preferences
        <DropdownMenuShortcut>⌘,</DropdownMenuShortcut>
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
        <UserMenuTheme />
        <DropdownMenuSeparator />
        {/* No shortcut hint. The block printed ⇧⌘Q, which nothing registers
            and which macOS itself uses to log the whole machine out. */}
        <DropdownMenuItem onClick={signOut}>
          <LogOutIcon aria-hidden="true" />
          Sign Out
        </DropdownMenuItem>
      </DropdownMenuGroup>
    </DropdownMenuContent>
  )
}

// ── Nav User ──

export function NavUser() {
  const { ready, name, initials } = useIdentity()

  return (
    <SidebarMenu>
      {/* Sidebar */}
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            className="bg-background border-border h-auto shrink-0 border p-1.5 text-sm shadow-sm shadow-black/5 group-data-[collapsible=icon]:justify-center"
            render={<SidebarMenuButton size="lg" aria-label="Open user menu" />}
          >
            {/* No AvatarImage. Nothing anywhere holds a picture of the owner,
                so the fallback was the only thing that ever rendered and the
                empty src fetched the current page. */}
            <Avatar className="size-6 transition-all duration-300 ease-in-out in-data-[state=collapsed]:size-7!">
              <AvatarFallback>{ready ? initials : "?"}</AvatarFallback>
            </Avatar>
            <div className="grid min-w-0 flex-1 text-left text-sm leading-tight group-data-[collapsible=icon]:hidden">
              {ready ? (
                <span className="truncate font-semibold">{name}</span>
              ) : (
                <Skeleton className="h-4 w-24" />
              )}
            </div>
            <MoreHorizontalIcon className="mr-1 ml-auto size-4 shrink-0 opacity-50 group-data-[collapsible=icon]:hidden" aria-hidden="true" />
          </DropdownMenuTrigger>

          <UserMenuContent />
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}