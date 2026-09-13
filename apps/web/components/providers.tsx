"use client";

// Root providers only: the theme and tooltips, which every route uses.
// Anything that needs data lives under app/(app)/layout.tsx instead.

import { ThemeProvider } from "next-themes";

import { AppearanceProvider } from "@/components/appearance-provider";
import { TooltipProvider } from "@/components/ui/tooltip";

export function Providers({
  children,
  nonce,
}: {
  children: React.ReactNode;
  nonce?: string;
}) {
  return (
    // `nonce` reaches the inline script next-themes writes to set the class
    // before React hydrates. Next nonces the scripts it emits itself and this
    // is not one of them, so without the prop the policy refuses it and the
    // theme arrives a paint late on every load.
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      nonce={nonce}
    >
      <AppearanceProvider>
        <TooltipProvider>{children}</TooltipProvider>
      </AppearanceProvider>
    </ThemeProvider>
  );
}
