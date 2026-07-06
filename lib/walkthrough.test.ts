import { describe, it, expect } from "vitest";
import { createTestDb } from "@/lib/domain/test-db";
import { studios, bookings } from "@/db/schema";
import { getOrCreateWalkthrough, photoKey, startCapture, commitCapture, WalkthroughLockedError } from "@/lib/walkthrough";
import { walkthroughs as wt, walkthroughPhotos } from "@/db/schema";
import { eq } from "drizzle-orm";

async function seed() {
  const { db, close } = await createTestDb();
  const [s] = await db.insert(studios).values({ clerkUserId: "u1", name: "S", slug: "s" }).returning();
  const [b] = await db.insert(bookings).values({
    studioId: s.id, renterName: "R", renterEmail: "r@x.com",
    startsAt: new Date("2026-08-01T18:00:00Z"), endsAt: new Date("2026-08-01T22:00:00Z"),
  }).returning();
  return { db, close, bookingId: b.id };
}

describe("getOrCreateWalkthrough", () => {
  it("creates once and is idempotent per (booking, kind)", async () => {
    const { db, close, bookingId } = await seed();
    const a = await getOrCreateWalkthrough(db, bookingId, "pre");
    const b = await getOrCreateWalkthrough(db, bookingId, "pre");
    expect(a.id).toBe(b.id);
    expect(a.kind).toBe("pre");
    expect(a.startedAt).not.toBeNull();
    const post = await getOrCreateWalkthrough(db, bookingId, "post");
    expect(post.id).not.toBe(a.id);
    await close();
  });
});

describe("photoKey", () => {
  it("is deterministic", () => {
    expect(photoKey("w1", "i1")).toBe("walkthroughs/w1/i1.jpg");
  });
});

const deps = { getUploadUrl: async (key: string) => `https://r2/${key}?sig` };

async function seedWithItem() {
  const { db, close } = await createTestDb();
  const [s] = await db.insert(studios).values({ clerkUserId: "u1", name: "S", slug: "s" }).returning();
  const { checklistItems } = await import("@/db/schema");
  const [item] = await db.insert(checklistItems).values({ studioId: s.id, position: 1, name: "Floor" }).returning();
  const [b] = await db.insert(bookings).values({
    studioId: s.id, renterName: "R", renterEmail: "r@x.com",
    startsAt: new Date("2026-08-01T18:00:00Z"), endsAt: new Date("2026-08-01T22:00:00Z"),
  }).returning();
  return { db, close, bookingId: b.id, itemId: item.id };
}

describe("startCapture / commitCapture", () => {
  it("returns a deterministic key + presigned url, commit upserts one row per item", async () => {
    const { db, close, bookingId, itemId } = await seedWithItem();
    const start = await startCapture(db, { bookingId, kind: "pre", checklistItemId: itemId }, deps);
    expect(start.key).toBe(`walkthroughs/${start.walkthroughId}/${itemId}.jpg`);
    expect(start.uploadUrl).toContain("https://r2/");

    await commitCapture(db, { walkthroughId: start.walkthroughId, checklistItemId: itemId, sha256: "h1", bytes: 100, contentType: "image/jpeg", lat: 33.7, lng: -84.4 });
    // retake — same item overwrites, still one row
    await commitCapture(db, { walkthroughId: start.walkthroughId, checklistItemId: itemId, sha256: "h2", bytes: 120, contentType: "image/jpeg" });
    const rows = await db.select().from(walkthroughPhotos).where(eq(walkthroughPhotos.walkthroughId, start.walkthroughId));
    expect(rows).toHaveLength(1);
    expect(rows[0].sha256).toBe("h2");
    await close();
  });

  it("refuses capture on a locked walkthrough", async () => {
    const { db, close, bookingId, itemId } = await seedWithItem();
    const start = await startCapture(db, { bookingId, kind: "pre", checklistItemId: itemId }, deps);
    await db.update(wt).set({ lockedAt: new Date() }).where(eq(wt.id, start.walkthroughId));
    await expect(
      startCapture(db, { bookingId, kind: "pre", checklistItemId: itemId }, deps)
    ).rejects.toBeInstanceOf(WalkthroughLockedError);
    await expect(
      commitCapture(db, { walkthroughId: start.walkthroughId, checklistItemId: itemId, sha256: "x", bytes: 1, contentType: "image/jpeg" })
    ).rejects.toBeInstanceOf(WalkthroughLockedError);
    await close();
  });
});

describe("lockWalkthrough", () => {
  it("blocks lock until required item count is met, then is idempotent", async () => {
    const { db, close, bookingId, itemId } = await seedWithItem();
    const { lockWalkthrough, IncompleteWalkthroughError } = await import("@/lib/walkthrough");
    const start = await startCapture(db, { bookingId, kind: "pre", checklistItemId: itemId }, deps);
    await expect(lockWalkthrough(db, start.walkthroughId, { requireItemCount: 1 }))
      .rejects.toBeInstanceOf(IncompleteWalkthroughError);
    await commitCapture(db, { walkthroughId: start.walkthroughId, checklistItemId: itemId, sha256: "h", bytes: 1, contentType: "image/jpeg" });
    const first = await lockWalkthrough(db, start.walkthroughId, { requireItemCount: 1 });
    expect(first).toEqual({ locked: true, alreadyLocked: false });
    const second = await lockWalkthrough(db, start.walkthroughId, { requireItemCount: 1 });
    expect(second).toEqual({ locked: false, alreadyLocked: true });
    await close();
  });
});

describe("skipWalkthrough", () => {
  it("clears deposit_protected", async () => {
    const { db, close, bookingId } = await seedWithItem();
    const { skipWalkthrough } = await import("@/lib/walkthrough");
    await skipWalkthrough(db, bookingId);
    const [b] = await db.select().from(bookings).where(eq(bookings.id, bookingId));
    expect(b.depositProtected).toBe(false);
    await close();
  });
});
