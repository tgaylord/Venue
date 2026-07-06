import { describe, it, expect } from "vitest";
import { createTestDb } from "@/lib/domain/test-db";
import { studios, bookings } from "@/db/schema";
import { getOrCreateWalkthrough, photoKey } from "@/lib/walkthrough";

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
