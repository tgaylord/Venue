import Link from "next/link";
import type { Booking } from "@/db/schema";
import type { BookingView, NextStep } from "@/lib/domain/booking-view";
import { formatAtlantaRange } from "@/lib/tz";
import StateChip from "../../_components/StateChip";

function hrefFor(bookingId: string, step: NextStep): string {
  switch (step.href) {
    case "pre_walkthrough":
      return `/dashboard/bookings/${bookingId}/walkthrough/pre`;
    case "post_walkthrough":
      return `/dashboard/bookings/${bookingId}/walkthrough/post`;
    default:
      return `/dashboard/bookings/${bookingId}`;
  }
}

export default function BookingRow({ booking, view, step }: { booking: Booking; view: BookingView; step: NextStep | null }) {
  const title = booking.eventType ?? "Event request";
  const href = step ? hrefFor(booking.id, step) : `/dashboard/bookings/${booking.id}`;
  return (
    <Link
      href={href}
      className="flex items-center gap-3 rounded-lg border border-owner-border bg-owner-panel px-4 py-3 hover:border-[#3a3d4a] hover:bg-[#1a1c23]"
    >
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-owner-text">{title}</div>
        <div className="truncate text-xs text-owner-muted">
          {booking.renterName} · {formatAtlantaRange(booking.startsAt, booking.endsAt)}
        </div>
      </div>
      <StateChip label={view.chip.label} tone={view.chip.tone} />
      {step ? <span className="hidden text-xs text-owner-muted sm:inline">{step.label}</span> : null}
      <span className="text-owner-muted">›</span>
    </Link>
  );
}
