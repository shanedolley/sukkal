import * as React from "react"

const MOBILE_BREAKPOINT = 768

function isMobileWidth() {
  return window.innerWidth < MOBILE_BREAKPOINT
}

function subscribe(onChange: () => void) {
  const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
  mql.addEventListener("change", onChange)
  return () => mql.removeEventListener("change", onChange)
}

// useSyncExternalStore reads the current width on the same render that
// subscribes to it, so mount needs no follow-up setState. The old version
// called setIsMobile once from inside the effect on top of subscribing,
// which forced a second render on every mount.
export function useIsMobile() {
  return React.useSyncExternalStore(subscribe, isMobileWidth, () => false)
}
