"use client";

// Every global keyboard shortcut, in one place.
//
// One listener rather than one per feature, so the set is readable and two
// shortcuts cannot quietly claim the same key. Add a row to SHORTCUTS and it
// appears in the settings page too, because that page reads this list.

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { useSearch } from "@/components/search/search-provider";
import { hasCommandModifier } from "@/lib/platform";

/** The key, what it does, and what to print. Settings renders this. */
export const SHORTCUTS = [
  { keys: ["K"], label: "Search, or ask a question" },
  { keys: [","], label: "Open preferences" },
] as const;

export function Shortcuts() {
  const router = useRouter();
  const { toggle } = useSearch();

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!hasCommandModifier(event)) return;

      const key = event.key.toLowerCase();
      if (key === "k") {
        event.preventDefault();
        toggle();
        return;
      }
      if (key === ",") {
        event.preventDefault();
        router.push("/settings");
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [router, toggle]);

  return null;
}
