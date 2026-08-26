"use client";

import { usePathname } from "next/navigation";

import { AppShell } from "@/components/blocks/app-shell-1/components/app-shell";
import { SourceDrawerProvider } from "@/components/source-drawer";
import { ReviewProvider } from "@/lib/review-context";
import { SpaceProvider } from "@/lib/space-context";

const CRUMBS: Record<string, string[]> = {
  "/dashboard": ["Assistant", "Briefing"],
  "/chat": ["Assistant", "Chat"],
  "/audit": ["Assistant", "Audit log"],
};

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <SpaceProvider>
      <ReviewProvider>
        <SourceDrawerProvider>
          <AppShell crumb={CRUMBS[pathname] ?? ["Assistant"]}>
            {children}
          </AppShell>
        </SourceDrawerProvider>
      </ReviewProvider>
    </SpaceProvider>
  );
}
