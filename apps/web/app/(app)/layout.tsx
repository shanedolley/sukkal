"use client";

import { usePathname } from "next/navigation";

import { AppShell } from "@/components/blocks/app-shell-1/components/app-shell";

const CRUMBS: Record<string, string[]> = {
  "/dashboard": ["Assistant", "Briefing"],
  "/chat": ["Assistant", "Chat"],
  "/audit": ["Assistant", "Audit log"],
};

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return <AppShell crumb={CRUMBS[pathname] ?? ["Assistant"]}>{children}</AppShell>;
}
