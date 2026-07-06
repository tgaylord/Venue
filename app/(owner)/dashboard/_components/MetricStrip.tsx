import type { Booking } from "@/db/schema";
import type { BookingView } from "@/lib/domain/booking-view";

type Row = { booking: Booking; view: BookingView };

export default function MetricStrip({ rows }: { rows: Row[] }) {
  const needsAction = rows.filter((r) => r.view.group === "needs_action").length;
  const upcoming = rows.filter(
    (r) => r.view.effectiveState === "confirmed" || r.view.effectiveState === "event_day"
  ).length;
  const depositsToActOn = rows.filter(
    (r) => r.view.depositControlActive && r.booking.depositStatus !== "returned"
  ).length;

  const cards = [
    { label: "Needs action", value: needsAction },
    { label: "Upcoming", value: upcoming },
    { label: "Deposits to act on", value: depositsToActOn },
  ];
  return (
    <div className="mb-8 grid grid-cols-3 gap-3">
      {cards.map((c) => (
        <div key={c.label} className="rounded-xl border border-owner-border bg-owner-panel p-4">
          <div className="text-2xl font-semibold text-owner-text">{c.value}</div>
          <div className="mt-1 font-mono text-[11px] uppercase tracking-wider text-owner-muted">{c.label}</div>
        </div>
      ))}
    </div>
  );
}
