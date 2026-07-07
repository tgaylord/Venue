import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "./test-db";
import { studios, bookings, bookingEvents, type Booking } from "@/db/schema";
import { closeOutBooking, CloseOutNotAllowedError } from "./close-out";
import type { Db } from "./transitions";

async function seedBooking(db: Db, state: string, startsAt: Date, endsAt: Date): Promise<Booking> {
  const [studio] = await db.insert(studios).values({
    clerkUserId: "u-" + Math.random().toString(36).slice(2),
    name: "Westview",
    slug: "westview-" + Math.random().toString(36).slice(2),
  }).returning();
  const [booking] = await db.insert(bookings).values({
    studioId: studio.id, state: state as Booking["state"],
    renterName: "Dana", renterEmail: "d@x.com",
    startsAt, endsAt,
    depositCents: 40000, rateSnapshot: { hourlyRateCents: 12000, minHours: 3 },
  }).returning();
  return booking;
}

const PAST_START = new Date("2026-06-01T18:00:00Z");
const PAST_END = new Date("2026-06-01T22:00:00Z");
const AFTER = new Date("2026-06-02T12:00:00Z");
const ACTOR = { type: "owner" as const, id: "owner-1" };

describe("closeOutBooking", () => {
  let db: Db;
  beforeEach(async () => { db = (await createTestDb()).db; });

  it("from stored confirmed (effective post_event): persists 3 hops and closes", async () => {
    const b = await seedBooking(db, "confirmed", PAST_START, PAST_END);
    await closeOutBooking(db, b, ACTOR, AFTER);

    const [row] = await db.select().from(bookings).where(eq(bookings.id, b.id));
    expect(row.state).toBe("closed");

    const events = await db.select().from(bookingEvents)
      .where(eq(bookingEvents.bookingId, b.id))
      .orderBy(bookingEvents.createdAt);
    expect(events).toHaveLength(3);
    expect(events.map(e => `${e.fromState}→${e.toState}`)).toEqual([
      "confirmed→event_day",
      "event_day→post_event",
      "post_event→closed",
    ]);
  });

  it("from stored event_day (effective post_event): persists 2 hops", async () => {
    const b = await seedBooking(db, "event_day", PAST_START, PAST_END);
    await closeOutBooking(db, b, ACTOR, AFTER);

    const [row] = await db.select().from(bookings).where(eq(bookings.id, b.id));
    expect(row.state).toBe("closed");

    const events = await db.select().from(bookingEvents)
      .where(eq(bookingEvents.bookingId, b.id))
      .orderBy(bookingEvents.createdAt);
    expect(events).toHaveLength(2);
    expect(events.map(e => `${e.fromState}→${e.toState}`)).toEqual([
      "event_day→post_event",
      "post_event→closed",
    ]);
  });

  it("from stored post_event: persists 1 hop (just closes)", async () => {
    const b = await seedBooking(db, "post_event", PAST_START, PAST_END);
    await closeOutBooking(db, b, ACTOR, AFTER);

    const [row] = await db.select().from(bookings).where(eq(bookings.id, b.id));
    expect(row.state).toBe("closed");

    const events = await db.select().from(bookingEvents)
      .where(eq(bookingEvents.bookingId, b.id))
      .orderBy(bookingEvents.createdAt);
    expect(events).toHaveLength(1);
    expect(events[0].fromState).toBe("post_event");
    expect(events[0].toState).toBe("closed");
  });

  it("throws CloseOutNotAllowedError from pre-event states", async () => {
    const b = await seedBooking(db, "pending", PAST_START, PAST_END);
    await expect(closeOutBooking(db, b, ACTOR, new Date("2026-05-01T00:00:00Z")))
      .rejects.toThrow(CloseOutNotAllowedError);
  });

  it("throws CloseOutNotAllowedError from confirmed before event starts", async () => {
    const b = await seedBooking(db, "confirmed", PAST_START, PAST_END);
    await expect(closeOutBooking(db, b, ACTOR, new Date("2026-05-01T00:00:00Z")))
      .rejects.toThrow(CloseOutNotAllowedError);
  });

  it("double-fire: second call throws (already closed)", async () => {
    const b = await seedBooking(db, "post_event", PAST_START, PAST_END);
    await closeOutBooking(db, b, ACTOR, AFTER);
    await expect(closeOutBooking(db, b, ACTOR, AFTER)).rejects.toThrow();
  });
});
