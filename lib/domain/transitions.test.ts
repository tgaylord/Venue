import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "@/lib/domain/test-db";
import { studios, bookings, bookingEvents } from "@/db/schema";
import { BOOKING_STATES, LEGAL_TRANSITIONS, type BookingState } from "@/lib/domain/states";
import {
  transitionBooking, registerTransitionHook, clearTransitionHooks,
  BookingNotFoundError, IllegalTransitionError, ConcurrentTransitionError,
} from "@/lib/domain/transitions";

let db: TestDb;
let close: () => Promise<void>;
let studioId: string;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  const [s] = await db.insert(studios).values({ clerkUserId: "u1", name: "S", slug: "s" }).returning();
  studioId = s.id;
});
afterAll(async () => {
  await close();
});
beforeEach(() => clearTransitionHooks());

// Test fixture: inserting a row WITH an initial state is allowed;
// only transitionBooking may CHANGE state afterwards.
async function makeBooking(state: BookingState): Promise<string> {
  const [b] = await db.insert(bookings).values({
    studioId, state,
    renterName: "R", renterEmail: "r@x.com",
    startsAt: new Date("2026-08-01T18:00:00Z"), endsAt: new Date("2026-08-01T22:00:00Z"),
  }).returning();
  return b.id;
}

describe("transition matrix (all 9×9 pairs)", () => {
  for (const from of BOOKING_STATES) {
    for (const to of BOOKING_STATES) {
      const legal = LEGAL_TRANSITIONS[from].includes(to);
      it(`${from} → ${to} is ${legal ? "allowed" : "rejected"}`, async () => {
        const id = await makeBooking(from);
        if (legal) {
          const updated = await transitionBooking(db, id, to, { type: "owner", id: "u1" });
          expect(updated.state).toBe(to);
          const events = await db.select().from(bookingEvents).where(eq(bookingEvents.bookingId, id));
          expect(events).toHaveLength(1);
          expect(events[0]).toMatchObject({ fromState: from, toState: to, actorType: "owner", actorId: "u1" });
        } else {
          await expect(transitionBooking(db, id, to, { type: "owner" })).rejects.toThrow(IllegalTransitionError);
          const [row] = await db.select().from(bookings).where(eq(bookings.id, id));
          expect(row.state).toBe(from);
          const events = await db.select().from(bookingEvents).where(eq(bookingEvents.bookingId, id));
          expect(events).toHaveLength(0);
        }
      });
    }
  }
});

describe("transitionBooking behavior", () => {
  it("throws BookingNotFoundError for a missing id", async () => {
    await expect(
      transitionBooking(db, "00000000-0000-0000-0000-000000000000", "declined", { type: "owner" })
    ).rejects.toThrow(BookingNotFoundError);
  });

  it("records metadata on the audit row", async () => {
    const id = await makeBooking("pending");
    await transitionBooking(db, id, "declined", { type: "owner" }, { meta: { reason: "double booked" } });
    const [ev] = await db.select().from(bookingEvents).where(eq(bookingEvents.bookingId, id));
    expect(ev.metadata).toEqual({ reason: "double booked" });
  });

  it("throws ConcurrentTransitionError when expectedFrom no longer matches (CAS)", async () => {
    const id = await makeBooking("awaiting_contract"); // someone else already advanced it
    await expect(
      transitionBooking(db, id, "awaiting_contract", { type: "owner" }, { expectedFrom: "pending" })
    ).rejects.toThrow(ConcurrentTransitionError);
    const events = await db.select().from(bookingEvents).where(eq(bookingEvents.bookingId, id));
    expect(events).toHaveLength(0);
  });

  it("runs registered hooks after commit and survives hook failure", async () => {
    const calls: string[] = [];
    registerTransitionHook("declined", async (b) => { calls.push(`declined:${b.id}`); });
    registerTransitionHook("declined", async () => { throw new Error("hook boom"); });
    const id = await makeBooking("pending");
    const updated = await transitionBooking(db, id, "declined", { type: "owner" });
    expect(updated.state).toBe("declined");           // hook failure never breaks the transition
    expect(calls).toEqual([`declined:${id}`]);
  });

  it("does not run hooks when the transition is illegal", async () => {
    const calls: string[] = [];
    registerTransitionHook("closed", async () => { calls.push("x"); });
    const id = await makeBooking("pending");
    await expect(transitionBooking(db, id, "closed", { type: "owner" })).rejects.toThrow(IllegalTransitionError);
    expect(calls).toEqual([]);
  });
});
