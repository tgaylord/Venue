import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getDb } from "@/lib/db";
import { getStudioByClerkUserId } from "@/lib/studio";
import { listBookingsForStudio } from "@/lib/booking";
import { toBookingView, nextStep, type DashboardGroup } from "@/lib/domain/booking-view";
import { getWalkthroughSummary } from "@/lib/walkthrough";
import CopyLinkButton from "../_components/CopyLinkButton";
import MetricStrip from "./_components/MetricStrip";
import BookingRow from "./_components/BookingRow";

const GROUPS: { key: DashboardGroup; title: string }[] = [
  { key: "needs_action", title: "Needs your action" },
  { key: "in_progress", title: "In progress" },
  { key: "past", title: "Past" },
];

export default async function DashboardPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");
  const db = getDb();
  const studio = await getStudioByClerkUserId(db, userId);
  if (!studio) redirect("/settings");

  const bookings = await listBookingsForStudio(db, studio.id);
  const now = new Date();
  const rows = await Promise.all(bookings.map(async (b) => {
    const view = toBookingView(b, now);
    const wtSummary = await getWalkthroughSummary(db, b.id);
    const step = nextStep(view.effectiveState, wtSummary);
    return { booking: b, view, step };
  }));

  const today = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", weekday: "long", month: "long", day: "numeric",
  }).format(now);

  return (
    <main className="mx-auto max-w-3xl">
      <header className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="font-serif text-3xl text-owner-text">Dashboard</h1>
          <p className="mt-1 text-sm text-owner-muted">{today} · Atlanta</p>
        </div>
        <CopyLinkButton slug={studio.slug} />
      </header>

      {rows.length === 0 ? (
        <section className="rounded-xl border border-[#1e4a2c] bg-[#101a12] p-6">
          <div className="text-xs font-semibold uppercase tracking-wider text-success">Share your booking link</div>
          <p className="mt-2 text-sm text-owner-muted">
            Send renters to <span className="font-mono text-owner-text">/book/{studio.slug}</span>. Requests land here.
          </p>
          <div className="mt-4"><CopyLinkButton slug={studio.slug} /></div>
          <Link href="/settings" className="mt-4 inline-block text-sm text-owner-accent">Edit studio settings →</Link>
        </section>
      ) : (
        <>
          <MetricStrip rows={rows} />
          {GROUPS.map(({ key, title }) => {
            let items = rows.filter((r) => r.view.group === key);
            if (items.length === 0) return null;
            // Needs-action & in-progress: soonest first (already asc). Past: most recent first.
            if (key === "past") items = [...items].reverse();
            return (
              <section key={key} className="mb-8">
                <div className="mb-3 flex items-center gap-2">
                  <h2 className="font-mono text-[11px] uppercase tracking-wider text-owner-muted">{title}</h2>
                  <span className="rounded-full bg-owner-panel-2 px-2 py-0.5 text-[11px] text-owner-muted">{items.length}</span>
                </div>
                <div className="flex flex-col gap-2">
                  {items.map((r) => <BookingRow key={r.booking.id} booking={r.booking} view={r.view} step={r.step} />)}
                </div>
              </section>
            );
          })}
        </>
      )}
    </main>
  );
}
