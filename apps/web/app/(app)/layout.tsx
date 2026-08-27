"use client";

import { usePathname } from "next/navigation";

import { AppShell } from "@/components/blocks/app-shell-1/components/app-shell";
import { DetailPanelProvider } from "@/components/detail-panel";
import { SearchProvider } from "@/components/search/search-provider";
import { Shortcuts } from "@/components/shortcuts";
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
  "/settings": ["Assistant", "Preferences"],
};

function crumbFor(pathname: string): string[] {
  if (CRUMBS[pathname]) return CRUMBS[pathname];
  // A saved chat carries an id the map cannot list.
  if (pathname.startsWith("/chat/")) return ["Assistant", "Chat", "Conversation"];
  return ["Assistant"];
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <SpaceProvider>
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
    </SpaceProvider>
  );
}
