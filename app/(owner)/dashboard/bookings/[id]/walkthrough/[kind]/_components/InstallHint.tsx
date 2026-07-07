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
    <div className="rounded-lg border border-owner-border bg-owner-panel px-3 py-2 text-[12px] leading-relaxed text-owner-muted">
      Tip: install VenueDash for the most reliable camera. On iPhone, open this page in{" "}
      <span className="text-owner-text">Safari</span>, tap the Share icon (a square with an ↑) in the
      bottom toolbar — tap the bottom of the screen first if it&rsquo;s hidden — then{" "}
      <span className="text-owner-text">Add to Home Screen</span>.
    </div>
  );
}
