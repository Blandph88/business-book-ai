// Device gate — same approach as Freehold: tag <html> with `is-mobile` on phones/tablets only
// (UA + coarse-pointer + iPadOS-as-Mac), so the mobile shell is DEVICE-gated, not width-gated —
// a narrow desktop window stays a fluid desktop. The full data-owning experience (File System
// Access) is desktop-only, so mobile is a read-optimised view + a "best on a laptop" nudge.

export function isMobileDevice(): boolean {
  if (typeof navigator === "undefined" || typeof window === "undefined") return false;
  const ua = navigator.userAgent || "";
  const uaMobile = /Android|iPhone|iPad|iPod|Mobile|Tablet|Silk|Kindle/i.test(ua);
  // iPadOS 13+ reports as "MacIntel" but has touch points.
  const iPadOS = navigator.platform === "MacIntel" && (navigator.maxTouchPoints || 0) > 1;
  const coarseTouch =
    (navigator.maxTouchPoints || 0) > 0 &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(pointer: coarse)").matches;
  return uaMobile || iPadOS || coarseTouch;
}

export function applyDeviceClass(): void {
  if (typeof document !== "undefined" && isMobileDevice()) {
    document.documentElement.classList.add("is-mobile");
  }
}
