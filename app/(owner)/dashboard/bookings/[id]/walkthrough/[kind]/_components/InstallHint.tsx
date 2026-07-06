"use client";
import { useEffect, useState } from "react";

export default function InstallHint() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)").matches
      || (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    setShow(!standalone);
  }, []);
  if (!show) return null;
  return (
    <div className="rounded-lg border border-owner-border bg-owner-panel px-3 py-2 text-[12px] text-owner-muted">
      Tip: add VenueDash to your home screen for the most reliable camera — Share → Add to Home Screen.
    </div>
  );
}
