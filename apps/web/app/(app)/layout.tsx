"use client";

import { usePathname } from "next/navigation";

import { AppShell } from "@/components/blocks/app-shell-1/components/app-shell";
import { DetailPanelProvider } from "@/components/detail-panel";
import { ReviewProvider } from "@/lib/review-context";
import { SpaceProvider } from "@/lib/space-context";

const CRUMBS: Record<string, string[]> = {
  "/dashboard": ["Assistant", "Briefing"],
  "/review/proposed": ["Assistant", "Review queue", "Proposed facts"],
  "/review/stale": ["Assistant", "Review queue", "Stale facts"],
  "/meetings": ["Assistant", "Review queue", "Meetings today"],
  "/chat": ["Assistant", "Chat"],
  "/audit": ["Assistant", "Audit log"],
};

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <SpaceProvider>
      <ReviewProvider>
        <DetailPanelProvider>
          <AppShell crumb={CRUMBS[pathname] ?? ["Assistant"]}>
            {children}
          </AppShell>
        </DetailPanelProvider>
      </ReviewProvider>
    </SpaceProvider>
  );
}
