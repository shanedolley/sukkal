"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";

import { useAccount } from "@/lib/account";
import { useIsClient } from "@/lib/local-store";
import { AppShell } from "@/components/blocks/app-shell-1/components/app-shell";
import { DetailPanelProvider } from "@/components/detail-panel";
import { SearchProvider } from "@/components/search/search-provider";
import { Shortcuts } from "@/components/shortcuts";
import { NeedsYouProvider } from "@/lib/needs-you-context";
import { ReviewProvider } from "@/lib/review-context";
import { SpaceProvider } from "@/lib/space-context";

const CRUMBS: Record<string, string[]> = {
  "/dashboard": ["Assistant", "Briefing"],
  "/review/proposed": ["Assistant", "Review queue", "Proposed facts"],
  "/review/stale": ["Assistant", "Review queue", "Stale facts"],
  "/meetings": ["Assistant", "Review queue", "Meetings today"],
  "/chat": ["Assistant", "Chat", "New chat"],
  "/chat/history": ["Assistant", "Chat", "History"],
  "/audit": ["Assistant", "Audit log"],
  "/settings": ["Preferences"],
  "/connections": ["Connections"],
  "/sprints/current": ["Project management", "Sprints", "Current sprint"],
  "/sprints/all": ["Project management", "Sprints", "All sprints"],
};

function crumbFor(pathname: string): string[] {
  if (CRUMBS[pathname]) return CRUMBS[pathname];
  // A saved chat carries an id the map cannot list.
  if (pathname.startsWith("/chat/")) return ["Assistant", "Chat", "Conversation"];
  // A project added in the sidebar carries a key the map cannot list either.
  if (pathname.startsWith("/projects/")) {
    const page = pathname.endsWith("/settings")
      ? "Settings"
      : pathname.endsWith("/issues")
        ? "Issues"
        : undefined;
    const trail = ["Project management", "Projects", "Project"];
    return page ? [...trail, page] : trail;
  }
  // The arrows on the current sprint page reach a sprint by its id.
  if (pathname.startsWith("/sprints/")) {
    return ["Project management", "Sprints", "Sprint"];
  }
  return ["Assistant"];
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  // The account is read from localStorage, which the server cannot see. Until
  // the browser has taken over, every render says "no account", so a gate
  // that trusted it would throw a person who set this box up months ago back
  // into the setup screen on every reload.
  const ready = useIsClient();
  const configured = useAccount() !== null;
  const firstBoot = ready && !configured;

  // The first boot. Nobody has set this box up, so every screen behind the
  // door leads back to the one that asks who you are.
  useEffect(() => {
    if (firstBoot) router.replace("/setup");
  }, [firstBoot, router]);

  // Nothing while it leaves, or the whole application paints for a second on
  // a box that has no account to paint it for.
  if (firstBoot) return null;

  return (
    <SpaceProvider>
      <NeedsYouProvider>
        <ReviewProvider>
          <DetailPanelProvider>
            <SearchProvider>
              <Shortcuts />
              <AppShell crumb={crumbFor(pathname)}>
                {children}
              </AppShell>
            </SearchProvider>
          </DetailPanelProvider>
        </ReviewProvider>
      </NeedsYouProvider>
    </SpaceProvider>
  );
}
