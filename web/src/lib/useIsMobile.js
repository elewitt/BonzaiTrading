import { useSyncExternalStore } from "react";

const QUERY = "(max-width: 768px)"; // matches the breakpoint already used at styles.css:1738,2172

function subscribe(callback) {
  const mql = window.matchMedia(QUERY);
  mql.addEventListener("change", callback);
  return () => mql.removeEventListener("change", callback);
}

function getSnapshot() {
  return window.matchMedia(QUERY).matches;
}

/** Single source of truth for "mobile vs desktop" — reactive to viewport
 * resize/rotation (matchMedia's change event), not just read once on
 * mount, so rotating a tablet or resizing a browser window updates
 * components live rather than needing a reload. */
export function useIsMobile() {
  return useSyncExternalStore(subscribe, getSnapshot);
}
