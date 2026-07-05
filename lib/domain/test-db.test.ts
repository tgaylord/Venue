import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestDb, type TestDb } from "@/lib/domain/test-db";
import { studios, bookings } from "@/db/schema";

let db: TestDb;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
});
afterAll(async () => {
  await close();
});

describe("schema (via real migrations on PGlite)", () => {
  it("inserts and reads a studio and a booking with defaults applied", async () => {
    const [studio] = await db
      .insert(studios)
      .values({ clerkUserId: "user_test1", name: "Test Studio", slug: "test-studio" })
      .returning();
    expect(studio.coiRequired).toBe(false);

    const [booking] = await db
      .insert(bookings)
      .values({
        studioId: studio.id,
        renterName: "Test Renter",
        renterEmail: "renter@test.com",
        startsAt: new Date("2026-08-01T18:00:00Z"),
        endsAt: new Date("2026-08-01T22:00:00Z"),
      })
      .returning();
    expect(booking.state).toBe("pending");
    expect(booking.depositStatus).toBe("uncollected");
    expect(booking.depositProtected).toBe(true);
  });

  it("enforces the unique slug", async () => {
    await expect(
      db.insert(studios).values({ clerkUserId: "user_test2", name: "Dup", slug: "test-studio" })
    ).rejects.toThrow();
  });
});
