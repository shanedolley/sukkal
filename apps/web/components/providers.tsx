"use client";

import { ThemeProvider } from "next-themes";

import { SourceDrawerProvider } from "@/components/source-drawer";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SpaceProvider } from "@/lib/space-context";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      <TooltipProvider>
        <SpaceProvider>
          <SourceDrawerProvider>{children}</SourceDrawerProvider>
        </SpaceProvider>
      </TooltipProvider>
    </ThemeProvider>
  );
}
