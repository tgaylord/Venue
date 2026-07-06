import Link from "next/link";
import type { Booking } from "@/db/schema";
import type { BookingView } from "@/lib/domain/booking-view";
import { formatAtlantaRange } from "@/lib/tz";
import StateChip from "../../_components/StateChip";

const ACTION_HINT: Record<string, string> = {
  approve: "Review request",
  mark_signed: "Mark signed",
};

export default function BookingRow({ booking, view }: { booking: Booking; view: BookingView }) {
  const title = booking.eventType ?? "Event request";
  const hint = view.legalActions.map((a) => ACTION_HINT[a]).find(Boolean);
  return (
    <Link
      href={`/dashboard/bookings/${booking.id}`}
      className="flex items-center gap-3 rounded-lg border border-owner-border bg-owner-panel px-4 py-3 hover:border-[#3a3d4a] hover:bg-[#1a1c23]"
    >
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-owner-text">{title}</div>
        <div className="truncate text-xs text-owner-muted">
          {booking.renterName} · {formatAtlantaRange(booking.startsAt, booking.endsAt)}
        </div>
      </div>
      <StateChip label={view.chip.label} tone={view.chip.tone} />
      {hint ? <span className="hidden text-xs text-owner-muted sm:inline">{hint}</span> : null}
      <span className="text-owner-muted">›</span>
    </Link>
  );
}
