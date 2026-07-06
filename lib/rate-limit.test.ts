import { describe, it, expect } from "vitest";
import { createTestDb } from "@/lib/domain/test-db";
import { rateLimits } from "@/db/schema";
import { checkRateLimit } from "@/lib/rate-limit";

describe("checkRateLimit", () => {
  it("allows up to the limit, then blocks with a positive retryAfterMs", async () => {
    const { db, close } = await createTestDb();
    const key = "book:1.2.3.4";
    for (let i = 0; i < 3; i++) {
      expect((await checkRateLimit(db, key, 3, 600_000)).allowed).toBe(true);
    }
    const blocked = await checkRateLimit(db, key, 3, 600_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
    await close();
  });

  it("resets the count once the window has expired", async () => {
    const { db, close } = await createTestDb();
    const key = "book:5.6.7.8";
    // An exhausted window that started an hour ago; the 10-min window is long expired.
    await db.insert(rateLimits).values({ key, count: 99, windowStartedAt: new Date(Date.now() - 3_600_000) });
    const r = await checkRateLimit(db, key, 3, 600_000);
    expect(r.allowed).toBe(true); // count reset to 1
    await close();
  });

  it("tracks keys independently", async () => {
    const { db, close } = await createTestDb();
    await checkRateLimit(db, "book:a", 1, 600_000);            // a -> count 1 (allowed)
    const aBlocked = await checkRateLimit(db, "book:a", 1, 600_000); // a -> count 2 (blocked)
    const bAllowed = await checkRateLimit(db, "book:b", 1, 600_000); // b -> fresh (allowed)
    expect(aBlocked.allowed).toBe(false);
    expect(bAllowed.allowed).toBe(true);
    await close();
  });
});
