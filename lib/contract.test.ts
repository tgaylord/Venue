import { describe, it, expect, beforeEach } from "vitest";
import { eq, desc } from "drizzle-orm";
import { createTestDb } from "@/lib/domain/test-db";
import { studios, bookings, contracts, bookingEvents, type Booking } from "@/db/schema";
import {
  getContractForBooking, upsertContract, markContractSigned, generateAndAdvance, contractKey,
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
