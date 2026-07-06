import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { verifyRenterToken } from "@/lib/tokens";
import { formatAtlantaRange } from "@/lib/tz";
import { bookings, studios } from "@/db/schema";
import type { BookingState } from "@/lib/domain/states";

const BADGE: Record<BookingState, { label: string; tone: string }> = {
  pending: { label: "Request sent — waiting on the studio", tone: "#8a867c" },
  awaiting_contract: { label: "Approved — rental agreement next", tone: "#4d7c4a" },
  awaiting_signature: { label: "Approved — rental agreement next", tone: "#4d7c4a" },
  confirmed: { label: "You're booked", tone: "#4d7c4a" },
  event_day: { label: "You're booked", tone: "#4d7c4a" },
  post_event: { label: "You're booked", tone: "#4d7c4a" },
  closed: { label: "This booking is complete", tone: "#8a867c" },
  declined: { label: "This request wasn't accepted", tone: "#b4462f" },
  canceled: { label: "This booking was canceled", tone: "#b4462f" },
};

export default async function StatusPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const db = getDb();
  const bookingId = await verifyRenterToken(db, token, "status");
  if (!bookingId) notFound();

  const [booking] = await db.select().from(bookings).where(eq(bookings.id, bookingId));
  if (!booking) notFound();
  const [studio] = await db.select({ name: studios.name }).from(studios).where(eq(studios.id, booking.studioId));

  const badge = BADGE[booking.state];
  const when = formatAtlantaRange(booking.startsAt, booking.endsAt);

  return (
    <main className="mx-auto min-h-screen w-full max-w-[430px] bg-renter-bg px-6 pt-16">
      <div className="mb-2 font-mono text-[9.5px] uppercase tracking-[.12em] text-[#8a867c]">{studio?.name}</div>
      <h1 className="mb-4 font-serif text-[26px] leading-tight" style={{ color: badge.tone }}>{badge.label}</h1>
      <div className="rounded-xl border border-renter-border bg-white p-4 text-[13px] leading-8 text-renter-ink">
        <strong>{when}</strong><br />
        {booking.eventType} · {booking.headcount} guests
      </div>
      <p className="mt-6 text-xs leading-relaxed text-[#8a867c]">
        Bookmark this page to check your request status anytime — no account needed.
      </p>
    </main>
  );
}
