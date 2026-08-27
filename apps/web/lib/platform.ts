"use client";

// Which modifier key to print in a shortcut hint.
//
// Read through useSyncExternalStore rather than an effect: the server has no
// navigator, so it answers "Ctrl" and the client answers for the real
// machine, and React treats the difference as expected rather than as a
// hydration mismatch.

import { useSyncExternalStore } from "react";

// The value never changes for the life of the page, so nothing to subscribe to.
const subscribe = () => () => {};

function getSnapshot(): boolean {
  return /mac|iphone|ipad/i.test(navigator.userAgent);
}

function getServerSnapshot(): boolean {
  return false;
}

/** "⌘" on a Mac, "Ctrl" everywhere else. */
export function useModifierKey(): string {
  const isApple = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return isApple ? "⌘" : "Ctrl";
}

/** True when the event carries the platform's own command modifier. */
export function hasCommandModifier(event: KeyboardEvent): boolean {
  return event.metaKey || event.ctrlKey;
}
