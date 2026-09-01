import { Fragment } from "react"

// Adapted from the ReUI app-shell-1 block. The original renders a fixed demo
// page. This one wraps whatever route is active and takes its own crumb.

import { cn } from "@/lib/utils"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"

import { AppSidebar } from "./app-sidebar"

export function AppShell({
  children,
  crumb,
}: {
  children: React.ReactNode
  /** The trail after "Assistant", innermost last. */
  crumb: string[]
}) {
  return (
    <SidebarProvider
      className={cn(
        "[--sidebar:color-mix(in_oklab,var(--color-sidebar)_60%,transparent)]",
        "[--sidebar-border:transparent]",
        "[--sidebar-width:250px]",
        "[--sidebar-accent:color-mix(in_oklab,var(--color-primary)_5%,transparent)]",
        "[--sidebar-accent-foreground:var(--color-primary)]"
      )}
    >
      <AppSidebar />
      {/* min-w-0, or a wide row inside sets the main column's min-content
          width and the whole page scrolls sideways. */}
      <SidebarInset className="min-w-0">
        <header className="bg-background sticky top-0 z-20 flex h-12 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
          <div className="flex items-center gap-2 px-4">
            <SidebarTrigger className="-ml-1 md:hidden" />
            <Breadcrumb>
              <BreadcrumbList>
                {/* The separator is a sibling <li>, never a child of one.
                    Nesting them is invalid HTML and fails hydration. */}
                {crumb.map((part, index) => {
                  const last = index === crumb.length - 1
                  return (
                    <Fragment key={part}>
                      <BreadcrumbItem
                        className={last ? undefined : "hidden md:block"}
                      >
                        {last ? (
                          <BreadcrumbPage>{part}</BreadcrumbPage>
                        ) : (
                          <span className="text-muted-foreground">{part}</span>
                        )}
                      </BreadcrumbItem>
                      {!last && (
                        <BreadcrumbSeparator className="hidden md:block" />
                      )}
                    </Fragment>
                  )
                })}
              </BreadcrumbList>
            </Breadcrumb>
          </div>
        </header>
        <div className="flex min-w-0 flex-1 flex-col gap-6 p-4 pt-0 md:p-6 md:pt-0">
          {children}
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
