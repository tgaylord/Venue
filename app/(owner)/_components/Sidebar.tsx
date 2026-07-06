"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { label: "Dashboard", href: "/dashboard", enabled: true },
  { label: "Day-of checklist", href: null, enabled: false }, // Phase 7
  { label: "Settings & policies", href: "/settings", enabled: true },
] as const;

export default function Sidebar({ studioName, slug }: { studioName: string | null; slug: string | null }) {
  const pathname = usePathname();
  return (
    <aside className="hidden w-60 shrink-0 flex-col gap-6 border-r border-owner-border bg-[#0e0f13] p-5 md:flex">
      <div className="flex items-center gap-3">
        <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-owner-accent to-[#4954d6]" />
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-owner-text">{studioName ?? "Your studio"}</div>
          {slug ? <div className="truncate font-mono text-[11px] text-owner-muted">/book/{slug}</div> : null}
        </div>
      </div>
      <nav className="flex flex-col gap-1">
        {NAV.map((item) => {
          const active = item.href != null && pathname.startsWith(item.href);
          const base = "rounded-lg px-3 py-2 text-sm";
          if (!item.enabled || item.href == null) {
            return (
              <span key={item.label} className={`${base} cursor-not-allowed text-owner-muted/50`} title="Coming in a later release">
                {item.label}
              </span>
            );
          }
          return (
            <Link
              key={item.label}
              href={item.href}
              className={`${base} ${active ? "bg-owner-panel text-owner-text" : "text-owner-muted hover:text-owner-text"}`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
