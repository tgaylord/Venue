import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "@/lib/domain/test-db";
import { studios, bookings, bookingEvents } from "@/db/schema";
import {
  createBooking, getBusyIntervals, type TermsSnapshot,
  listBookingsForStudio, getBookingForOwner, getBookingEvents,
  setDepositStatus, setContractSignedAt,
} from "@/lib/booking";
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

describe("owner booking helpers", () => {
  it("listBookingsForStudio returns only that studio's bookings, ascending by start", async () => {
    const { db, close } = await createTestDb();
    const a = await seedStudio(db); // existing helper in this file
    const [b2] = await db.insert(studios).values({
      clerkUserId: "other-u", name: "Other", slug: "other-studio",
    }).returning();

    const { booking: later } = await createBooking(db, {
      ...input(a), startsAt: new Date("2026-07-20T22:00:00Z"), endsAt: new Date("2026-07-21T02:00:00Z"),
    });
    const { booking: earlier } = await createBooking(db, input(a)); // 2026-07-18
    await createBooking(db, { ...input(b2.id) });

    const rows = await listBookingsForStudio(db, a);
    expect(rows.map((r) => r.id)).toEqual([earlier.id, later.id]); // ascending, other studio excluded
    await close();
  });

  it("getBookingForOwner returns the booking only for its own studio", async () => {
    const { db, close } = await createTestDb();
    const a = await seedStudio(db);
    const [b2] = await db.insert(studios).values({
      clerkUserId: "o2", name: "O2", slug: "o2",
    }).returning();
    const { booking } = await createBooking(db, input(a));

    expect((await getBookingForOwner(db, booking.id, a))?.id).toBe(booking.id);
    expect(await getBookingForOwner(db, booking.id, b2.id)).toBeNull(); // foreign studio
    await close();
  });

  it("getBookingEvents returns the transition history ascending", async () => {
    const { db, close } = await createTestDb();
    const a = await seedStudio(db);
    const { booking } = await createBooking(db, input(a));
    await transitionBooking(db, booking.id, "awaiting_contract", { type: "owner", id: "u" });
    await transitionBooking(db, booking.id, "canceled", { type: "owner", id: "u" });

    const events = await getBookingEvents(db, booking.id);
    expect(events.map((e) => e.toState)).toEqual(["awaiting_contract", "canceled"]);
    await close();
  });

  it("setDepositStatus updates status and stamps depositStatusAt", async () => {
    const { db, close } = await createTestDb();
    const a = await seedStudio(db);
    const { booking } = await createBooking(db, input(a));
    expect(booking.depositStatus).toBe("uncollected");
    expect(booking.depositStatusAt).toBeNull();

    const updated = await setDepositStatus(db, booking.id, "collected");
    expect(updated.depositStatus).toBe("collected");
    expect(updated.depositStatusAt).toBeInstanceOf(Date);
    await close();
  });

  it("setContractSignedAt stamps the timestamp", async () => {
    const { db, close } = await createTestDb();
    const a = await seedStudio(db);
    const { booking } = await createBooking(db, input(a));
    const at = new Date("2026-07-10T12:00:00Z");
    await setContractSignedAt(db, booking.id, at);
    const [row] = await db.select().from(bookings).where(eq(bookings.id, booking.id));
    expect(row.contractSignedAt?.toISOString()).toBe(at.toISOString());
    await close();
  });
});
