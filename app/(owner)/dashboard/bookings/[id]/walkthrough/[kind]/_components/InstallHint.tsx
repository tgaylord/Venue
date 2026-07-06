"use client";
import { useSyncExternalStore } from "react";

function subscribe() {
  // Standalone-mode never flips while the page is open — no real subscription needed.
  return () => {};
}
function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches
    || (window.navigator as unknown as { standalone?: boolean }).standalone === true;
}
function getServerSnapshot() {
  return false;
}

export default function InstallHint() {
  const standalone = useSyncExternalStore(subscribe, isStandalone, getServerSnapshot);
  if (standalone) return null;
  return (
    <div className="rounded-lg border border-owner-border bg-owner-panel px-3 py-2 text-[12px] text-owner-muted">
      Tip: add VenueDash to your home screen for the most reliable camera — Share → Add to Home Screen.
    </div>
  );
}
