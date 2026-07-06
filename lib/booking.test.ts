import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "@/lib/domain/test-db";
import { studios, bookingEvents } from "@/db/schema";
import { createBooking, getBusyIntervals, type TermsSnapshot } from "@/lib/booking";
import { verifyRenterToken } from "@/lib/tokens";
import { transitionBooking } from "@/lib/domain/transitions";

const TERMS: TermsSnapshot = {
  hourlyRateCents: 16500, minHours: 3, cancellationLadder: { full: 30, half: 14, none: 0 },
  alcoholPolicy: "byob_with_acknowledgment", vendorPolicy: "pre_approval",
  noiseCurfew: "22:00", cleanupWindowMin: 60, maxOccupancy: 40,
};

async function seedStudio(db: TestDb): Promise<string> {
  const [s] = await db.insert(studios).values({
    clerkUserId: "book-u", name: "Book Studio", slug: "book-studio", depositCents: 40000,
    onboardingCompletedAt: new Date(),
  }).returning();
  return s.id;
}

const input = (studioId: string) => ({
  studioId, renterName: "Maya Reeves", renterEmail: "maya@x.com", renterPhone: null,
  eventType: "Birthday celebration", headcount: 25, byob: true, outsideVendors: false, notes: "Balloon arch",
  startsAt: new Date("2026-07-18T22:00:00Z"), endsAt: new Date("2026-07-19T02:00:00Z"),
  depositCents: 40000, termsSnapshot: TERMS,
});

describe("createBooking", () => {
  it("inserts a pending booking with the terms snapshot and a status token", async () => {
    const { db, close } = await createTestDb();
    const studioId = await seedStudio(db);
    const { booking, statusToken } = await createBooking(db, input(studioId));

    expect(booking.state).toBe("pending");
    expect(booking.depositCents).toBe(40000);
    expect(booking.rateSnapshot).toEqual(TERMS);
    expect(await verifyRenterToken(db, statusToken, "status")).toBe(booking.id);
    await close();
  });

  it("writes NO booking_events row on creation (pending is genesis)", async () => {
    const { db, close } = await createTestDb();
    const studioId = await seedStudio(db);
    const { booking } = await createBooking(db, input(studioId));
    const events = await db.select().from(bookingEvents).where(eq(bookingEvents.bookingId, booking.id));
    expect(events).toHaveLength(0);
    await close();
  });
});

describe("getBusyIntervals", () => {
  it("includes non-terminal bookings and excludes declined/canceled", async () => {
    const { db, close } = await createTestDb();
    const studioId = await seedStudio(db);
    const { booking: live } = await createBooking(db, input(studioId));
    const { booking: dead } = await createBooking(db, {
      ...input(studioId),
      startsAt: new Date("2026-07-20T22:00:00Z"), endsAt: new Date("2026-07-21T02:00:00Z"),
    });
    await transitionBooking(db, dead.id, "declined", { type: "owner" });

    const busy = await getBusyIntervals(db, studioId, new Date("2026-07-01T00:00Z"), new Date("2026-08-01T00:00Z"));
    expect(busy).toHaveLength(1);
    expect(busy[0].startsAt.toISOString()).toBe(live.startsAt.toISOString());
    await close();
  });
});
