"use client";

// Holds the chosen menu and chart colours and writes them to the root element.
//
// The values re-apply whenever the resolved theme changes, because each preset
// carries a light set and a dark set. Writing to documentElement.style inside
// an effect is the right use of one: it synchronises React state to something
// outside React, which is what effects are for. Reading the saved choice is
// not, so that goes through lib/local-store.ts instead.

import { createContext, useContext, useEffect, useMemo } from "react";
import { useTheme } from "next-themes";

import {
  ACCENTS,
  ACCENT_KEY,
  CHARTS_KEY,
  CHART_PALETTES,
  applyAppearance,
} from "@/lib/appearance";
import { createLocalStore } from "@/lib/local-store";

const accentStore = createLocalStore<string>(ACCENT_KEY, "green", (id) =>
  ACCENTS.some((preset) => preset.id === id)
);
const chartsStore = createLocalStore<string>(CHARTS_KEY, "greens", (id) =>
  CHART_PALETTES.some((preset) => preset.id === id)
);

interface AppearanceValue {
  accent: string;
  charts: string;
  setAccent: (id: string) => void;
  setCharts: (id: string) => void;
}

const AppearanceContext = createContext<AppearanceValue | null>(null);

export function useAppearance(): AppearanceValue {
  const value = useContext(AppearanceContext);
  if (!value) {
    throw new Error("useAppearance must be used inside AppearanceProvider");
  }
  return value;
}

export function AppearanceProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const accent = accentStore.useValue();
  const charts = chartsStore.useValue();
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    applyAppearance(
      document.documentElement,
      accent,
      charts,
      resolvedTheme === "dark"
    );
  }, [accent, charts, resolvedTheme]);

  const value = useMemo(
    () => ({
      accent,
      charts,
      setAccent: accentStore.set,
      setCharts: chartsStore.set,
    }),
    [accent, charts]
  );

  return <AppearanceContext value={value}>{children}</AppearanceContext>;
}
