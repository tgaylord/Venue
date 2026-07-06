import { describe, it, expect } from "vitest";
import { createTestDb } from "@/lib/domain/test-db";
import { studios, bookings, walkthroughs, walkthroughPhotos } from "@/db/schema";
import { eq } from "drizzle-orm";

async function seedLockable() {
  const { db, close } = await createTestDb();
  const [s] = await db.insert(studios).values({ clerkUserId: "u1", name: "S", slug: "s" }).returning();
  const [b] = await db.insert(bookings).values({
    studioId: s.id, renterName: "R", renterEmail: "r@x.com",
    startsAt: new Date("2026-08-01T18:00:00Z"), endsAt: new Date("2026-08-01T22:00:00Z"),
  }).returning();
  const [w] = await db.insert(walkthroughs).values({ bookingId: b.id, kind: "pre", startedAt: new Date() }).returning();
  return { db, close, w };
}

describe("locked-walkthrough immutability", () => {
  it("allows the lock write, then forbids further updates/deletes", async () => {
    const { db, close, w } = await seedLockable();
    // pre-lock update is fine
    await db.update(walkthroughs).set({ startedAt: new Date() }).where(eq(walkthroughs.id, w.id));
    // the lock write itself is allowed (OLD.locked_at IS NULL)
    await db.update(walkthroughs).set({ lockedAt: new Date() }).where(eq(walkthroughs.id, w.id));
    // any subsequent update fails
    await expect(
      db.update(walkthroughs).set({ acknowledgedAt: new Date() }).where(eq(walkthroughs.id, w.id))
    ).rejects.toThrow();
    // delete fails
    await expect(db.delete(walkthroughs).where(eq(walkthroughs.id, w.id))).rejects.toThrow();
    await close();
  });

  it("forbids writing a photo under a locked walkthrough", async () => {
    const { db, close, w } = await seedLockable();
    // photo insert while unlocked is fine
    const [p] = await db.insert(walkthroughPhotos).values({
      walkthroughId: w.id, r2Key: "k", sha256: "h",
    }).returning();
    await db.update(walkthroughs).set({ lockedAt: new Date() }).where(eq(walkthroughs.id, w.id));
    await expect(
      db.update(walkthroughPhotos).set({ sha256: "tampered" }).where(eq(walkthroughPhotos.id, p.id))
    ).rejects.toThrow();
    await expect(db.delete(walkthroughPhotos).where(eq(walkthroughPhotos.id, p.id))).rejects.toThrow();
    await close();
  });
});
