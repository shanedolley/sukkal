"use client";

// Holds the chosen menu and chart colours and writes them to the root element.
//
// The choice moved to the server in KPA-126, so this reads `lib/account.ts`
// rather than `localStorage`. ADR-0022 gives the reason: an accent is a
// person's taste, and somebody who picks a colour on the laptop expects the
// phone to match.
//
// NOTHING IS APPLIED UNTIL THE READ ANSWERS, and that is the whole of the
// no-flash guarantee. `applyAppearance` clears every property before it sets
// any, so running it with a default selection would wipe what the bootstrap
// script painted before React ran, show the default, and then show the real
// colour once the fetch landed. Two wrong paints where there were none. A null
// selection therefore means "do not touch the root element", and it covers the
// read being in flight and the read having failed.
//
// A SECOND DEVICE PAINTS THE DEFAULT ONCE. It has no `kpa.appearance` in its
// own storage, so the bootstrap script returns early and the stylesheet's own
// green shows. The read then lands, the colour applies, and the resolved blob
// is cached for every load after that. ADR-0022 accepts that one paint as the
// price of never flashing, and it is the same trade the bootstrap already made.
//
// The values re-apply whenever the resolved theme changes, because each preset
// carries a light set and a dark set. Writing to documentElement.style inside
// an effect is the right use of one: it synchronises React state to something
// outside React, which is what effects are for.

import { createContext, useContext, useEffect, useMemo } from "react";
import { useTheme } from "next-themes";

import { saveAppearance, useOwner } from "@/lib/account";
import {
  DEFAULT_SELECTION,
  RESOLVED_KEY,
  applyAppearance,
  resolveAppearance,
  type Selection,
} from "@/lib/appearance";

interface AppearanceValue {
  accent: string;
  charts: string;
  accentHex: string;
  chartsHex: string;
  /** False until the server has answered. Nothing reads as selected before
   *  then, the way nothing did before the browser took over. */
  ready: boolean;
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
  const { status, appearance } = useOwner();
  const { resolvedTheme } = useTheme();

  // Null until the read answers. A row holding no choice is the default, which
  // is a selection and applies; a read that failed is not, and does not.
  const selection: Selection | null =
    status === "ready" ? (appearance ?? DEFAULT_SELECTION) : null;

  useEffect(() => {
    if (!selection) return;
    applyAppearance(
      document.documentElement,
      selection,
      resolvedTheme === "dark"
    );
  }, [selection, resolvedTheme]);

  // Written for the bootstrap script, which applies it on the next load before
  // React runs. Kept here so the colour maths lives in one place.
  useEffect(() => {
    if (!selection) return;
    try {
      window.localStorage.setItem(
        RESOLVED_KEY,
        JSON.stringify(resolveAppearance(selection))
      );
    } catch {
      // A private window. The colours still hold for this session.
    }
  }, [selection]);

  const value = useMemo(() => {
    // What a change is made against. The default stands in while the read is
    // still out, so a swatch pressed early writes a whole selection rather
    // than one field over three undefined ones.
    const current = selection ?? DEFAULT_SELECTION;
    return {
      accent: current.accentId,
      charts: current.chartsId,
      accentHex: current.accentHex,
      chartsHex: current.chartsHex,
      ready: selection !== null,
      setAccent: (id: string) =>
        saveAppearance({ ...current, accentId: id }),
      setCharts: (id: string) =>
        saveAppearance({ ...current, chartsId: id }),
      // Picking a colour is the same act as choosing to use one, so it does
      // both rather than making you press the swatch and then a Custom button.
      setAccentHex: (hex: string) =>
        saveAppearance({ ...current, accentHex: hex, accentId: "custom" }),
      setChartsHex: (hex: string) =>
        saveAppearance({ ...current, chartsHex: hex, chartsId: "custom" }),
    };
  }, [selection]);

  return <AppearanceContext value={value}>{children}</AppearanceContext>;
}
