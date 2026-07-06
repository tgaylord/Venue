import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { getStudioBySlug, getSpacesForStudio } from "@/lib/studio";
import { getBusyIntervals } from "@/lib/booking";
import { submitBooking } from "./actions";
import BookingFlow, { type BookViewModel } from "./_components/BookingFlow";

const DAYS_AHEAD = 30;

export default async function BookPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const db = getDb();
  const studio = await getStudioBySlug(db, slug);
  if (!studio || !studio.onboardingCompletedAt) notFound();

  const spaces = await getSpacesForStudio(db, studio.id);
  const maxOccupancy = spaces.reduce<number | null>(
    (m, s) => (s.maxOccupancy != null ? Math.max(m ?? 0, s.maxOccupancy) : m), null
  );

  const now = new Date();
  const to = new Date(now.getTime() + DAYS_AHEAD * 24 * 60 * 60 * 1000);
  const busy = await getBusyIntervals(db, studio.id, now, to);

  // Next 30 calendar days as Atlanta-labelled day chips.
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
  const dow = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short" });
  const dnum = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", day: "numeric" });
  const days = Array.from({ length: DAYS_AHEAD }, (_, i) => {
    const d = new Date(now.getTime() + i * 24 * 60 * 60 * 1000);
    return { dateISO: fmt.format(d), dow: dow.format(d).toUpperCase(), num: dnum.format(d) };
  });

  const vm: BookViewModel = {
    slug: studio.slug,
    studioName: studio.name,
    description: studio.description,
    address: studio.address,
    hourlyRateCents: studio.hourlyRateCents ?? 0,
    minHours: studio.minHours ?? 1,
    depositCents: studio.depositCents ?? 0,
    maxOccupancy,
    alcoholPolicy: studio.alcoholPolicy,
    vendorPolicy: studio.vendorPolicy,
    noiseCurfew: studio.noiseCurfew,
    spaces: spaces.map((s) => ({ name: s.name, maxOccupancy: s.maxOccupancy })),
    days,
    busy: busy.map((b) => ({ startsAt: b.startsAt.toISOString(), endsAt: b.endsAt.toISOString() })),
  };

  return <BookingFlow vm={vm} action={submitBooking.bind(null, studio.slug)} />;
}
