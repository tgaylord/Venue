import { describe, it, expect, beforeEach } from "vitest";
import { eq, desc } from "drizzle-orm";
import { createTestDb } from "@/lib/domain/test-db";
import { studios, bookings, contracts, bookingEvents, type Booking } from "@/db/schema";
import {
  getContractForBooking, upsertContract, markContractSigned, generateAndAdvance, contractKey,
  approveAndSendContract,
} from "./contract";
import type { Db } from "@/lib/domain/transitions";

async function seedBooking(db: Db, state = "awaiting_contract"): Promise<Booking> {
  const [studio] = await db.insert(studios).values({
    clerkUserId: "u-" + Math.random().toString(36).slice(2), name: "Westview", slug: "westview-" + Math.random().toString(36).slice(2),
  }).returning();
  const [booking] = await db.insert(bookings).values({
    studioId: studio.id, state: state as Booking["state"], renterName: "Dana", renterEmail: "d@x.com",
    startsAt: new Date("2026-08-15T18:00:00Z"), endsAt: new Date("2026-08-15T22:00:00Z"),
    depositCents: 40000, rateSnapshot: { hourlyRateCents: 12000, minHours: 3 },
  }).returning();
  return booking;
}

const IDENTITY = { studioName: "Westview", studioAddress: null, equipmentList: null };

describe("contract DB access", () => {
  let db: Db;
  beforeEach(async () => { db = (await createTestDb()).db; });

  it("upserts one contract per booking (unique booking_id)", async () => {
    const b = await seedBooking(db);
    const c1 = await upsertContract(db, b.id, "k1", new Date());
    const c2 = await upsertContract(db, b.id, "k2", new Date());
    expect(c2.id).toBe(c1.id);
    expect(c2.pdfR2Key).toBe("k2");
    const rows = await db.select().from(contracts).where(eq(contracts.bookingId, b.id));
    expect(rows.length).toBe(1);
  });

  it("markContractSigned flips status + signedAt", async () => {
    const b = await seedBooking(db);
    await upsertContract(db, b.id, "k1", new Date());
    await markContractSigned(db, b.id, new Date("2026-08-01T00:00:00Z"));
    const c = await getContractForBooking(db, b.id);
    expect(c?.status).toBe("signed");
    expect(c?.signedAt?.toISOString()).toBe("2026-08-01T00:00:00.000Z");
  });

  it("generateAndAdvance renders, stores, writes a row, and advances state", async () => {
    const b = await seedBooking(db);
    let putKey = ""; let rendered = false;
    const c = await generateAndAdvance(db, b, IDENTITY, {
      render: async () => { rendered = true; return Buffer.from("%PDF-fake"); },
      put: async (key) => { putKey = key; },
      now: () => new Date("2026-07-06T00:00:00Z"),
    }, { type: "owner", id: "owner-1" });
    expect(rendered).toBe(true);
    expect(putKey).toBe(contractKey(b.id));
    expect(c.status).toBe("sent");
    expect(c.pdfR2Key).toBe(contractKey(b.id));
    const [row] = await db.select().from(bookings).where(eq(bookings.id, b.id));
    expect(row.state).toBe("awaiting_signature");
    const [event] = await db
      .select()
      .from(bookingEvents)
      .where(eq(bookingEvents.bookingId, b.id))
      .orderBy(desc(bookingEvents.createdAt))
      .limit(1);
    expect(event.actorType).toBe("owner");
    expect(event.actorId).toBe("owner-1");
  });

  it("generateAndAdvance is idempotent-safe: a second call from awaiting_signature throws (illegal transition)", async () => {
    const b = await seedBooking(db);
    const deps = { render: async () => Buffer.from("%PDF-fake"), put: async () => {} };
    await generateAndAdvance(db, b, IDENTITY, deps, { type: "owner", id: "owner-1" });
    const [advanced] = await db.select().from(bookings).where(eq(bookings.id, b.id));
    await expect(
      generateAndAdvance(db, advanced, IDENTITY, deps, { type: "owner", id: "owner-1" })
    ).rejects.toThrow();
  });
});

describe("approveAndSendContract", () => {
  let db: Db;
  beforeEach(async () => { db = (await createTestDb()).db; });

  const fakeDeps = {
    render: async () => Buffer.from("%PDF-fake"),
    put: async () => {},
    now: () => new Date("2026-07-07T00:00:00Z"),
  };

  it("happy path: pending → awaiting_contract → awaiting_signature with two booking_events + contract row", async () => {
    const b = await seedBooking(db, "pending");
    const contract = await approveAndSendContract(db, b, IDENTITY, fakeDeps, { type: "owner", id: "owner-1" });

    // Final state is awaiting_signature
    const [row] = await db.select().from(bookings).where(eq(bookings.id, b.id));
    expect(row.state).toBe("awaiting_signature");

    // Two booking_events rows: pending→awaiting_contract, awaiting_contract→awaiting_signature
    const events = await db
      .select()
      .from(bookingEvents)
      .where(eq(bookingEvents.bookingId, b.id))
      .orderBy(bookingEvents.createdAt);
    expect(events).toHaveLength(2);
    expect(events[0].fromState).toBe("pending");
    expect(events[0].toState).toBe("awaiting_contract");
    expect(events[1].fromState).toBe("awaiting_contract");
    expect(events[1].toState).toBe("awaiting_signature");

    // Contract row exists
    expect(contract.pdfR2Key).toBe(contractKey(b.id));
    expect(contract.status).toBe("sent");
  });

  it("double-fire idempotence: second call throws (CAS catches the stale expectedFrom)", async () => {
    const b = await seedBooking(db, "pending");
    await approveAndSendContract(db, b, IDENTITY, fakeDeps, { type: "owner", id: "owner-1" });
    await expect(
      approveAndSendContract(db, b, IDENTITY, fakeDeps, { type: "owner", id: "owner-1" })
    ).rejects.toThrow();
  });

  it("failure after first hop leaves booking in awaiting_contract with recovery path", async () => {
    const b = await seedBooking(db, "pending");
    const failingDeps = {
      render: async () => { throw new Error("render boom"); },
      put: async () => {},
    };
    await expect(
      approveAndSendContract(db, b, IDENTITY, failingDeps, { type: "owner", id: "owner-1" })
    ).rejects.toThrow("render boom");

    // Booking parked at awaiting_contract — the first hop committed
    const [row] = await db.select().from(bookings).where(eq(bookings.id, b.id));
    expect(row.state).toBe("awaiting_contract");

    // One booking_event for the first hop
    const events = await db
      .select()
      .from(bookingEvents)
      .where(eq(bookingEvents.bookingId, b.id));
    expect(events).toHaveLength(1);
    expect(events[0].toState).toBe("awaiting_contract");

    // Recovery: standalone generateAndAdvance still works from awaiting_contract
    const [parked] = await db.select().from(bookings).where(eq(bookings.id, b.id));
    await generateAndAdvance(db, parked, IDENTITY, fakeDeps, { type: "owner", id: "owner-1" });
    const [recovered] = await db.select().from(bookings).where(eq(bookings.id, b.id));
    expect(recovered.state).toBe("awaiting_signature");
  });
});
