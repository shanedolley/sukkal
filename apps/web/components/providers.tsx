"use client";

// Root providers only: the theme and tooltips, which every route uses.
// Anything that needs data lives under app/(app)/layout.tsx instead.

import { ThemeProvider } from "next-themes";

import { AppearanceProvider } from "@/components/appearance-provider";
import { TooltipProvider } from "@/components/ui/tooltip";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      <AppearanceProvider>
        <TooltipProvider>{children}</TooltipProvider>
      </AppearanceProvider>
    </ThemeProvider>
  );
}
