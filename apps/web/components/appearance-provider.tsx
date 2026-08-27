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
  ACCENT_HEX_KEY,
  ACCENT_KEY,
  CHARTS_HEX_KEY,
  CHARTS_KEY,
  CHART_PALETTES,
  RESOLVED_KEY,
  applyAppearance,
  resolveAppearance,
} from "@/lib/appearance";
import { createLocalStore } from "@/lib/local-store";

const isPreset = (presets: { id: string }[]) => (id: string) =>
  id === "custom" || presets.some((preset) => preset.id === id);

/** Six hex digits with a leading hash, which is what a colour input gives. */
const isHex = (value: string) => /^#[0-9a-f]{6}$/i.test(value);

const DEFAULT_HEX = "#0d6b45";

const accentStore = createLocalStore<string>(ACCENT_KEY, "green", isPreset(ACCENTS));
const chartsStore = createLocalStore<string>(
  CHARTS_KEY,
  "greens",
  isPreset(CHART_PALETTES)
);
const accentHexStore = createLocalStore<string>(ACCENT_HEX_KEY, DEFAULT_HEX, isHex);
const chartsHexStore = createLocalStore<string>(CHARTS_HEX_KEY, DEFAULT_HEX, isHex);

interface AppearanceValue {
  accent: string;
  charts: string;
  accentHex: string;
  chartsHex: string;
  setAccent: (id: string) => void;
  setCharts: (id: string) => void;
  /** Choosing a colour also selects the custom option. */
  setAccentHex: (hex: string) => void;
  setChartsHex: (hex: string) => void;
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
  const accentHex = accentHexStore.useValue();
  const chartsHex = chartsHexStore.useValue();
  const { resolvedTheme } = useTheme();

  const selection = useMemo(
    () => ({ accentId: accent, chartsId: charts, accentHex, chartsHex }),
    [accent, charts, accentHex, chartsHex]
  );

  useEffect(() => {
    applyAppearance(
      document.documentElement,
      selection,
      resolvedTheme === "dark"
    );
  }, [selection, resolvedTheme]);

  // Written for the bootstrap script, which applies it on the next load
  // before React runs. Kept here so the colour maths lives in one place.
  useEffect(() => {
    try {
      window.localStorage.setItem(
        RESOLVED_KEY,
        JSON.stringify(resolveAppearance(selection))
      );
    } catch {
      // A private window. The colours still hold for this session.
    }
  }, [selection]);

  const value = useMemo(
    () => ({
      accent,
      charts,
      accentHex,
      chartsHex,
      setAccent: accentStore.set,
      setCharts: chartsStore.set,
      // Picking a colour is the same act as choosing to use one, so it does
      // both rather than making you press the swatch and then a Custom button.
      setAccentHex: (hex: string) => {
        accentHexStore.set(hex);
        accentStore.set("custom");
      },
      setChartsHex: (hex: string) => {
        chartsHexStore.set(hex);
        chartsStore.set("custom");
      },
    }),
    [accent, charts, accentHex, chartsHex]
  );

  return <AppearanceContext value={value}>{children}</AppearanceContext>;
}
