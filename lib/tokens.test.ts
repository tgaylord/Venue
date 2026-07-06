import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "@/lib/domain/test-db";
import { studios, bookings, renterTokens } from "@/db/schema";
import { mintRenterToken, verifyRenterToken } from "@/lib/tokens";

let db: TestDb;
let close: () => Promise<void>;
let bookingId: string;

const future = new Date(Date.now() + 60 * 60 * 1000);
const past = new Date(Date.now() - 60 * 1000);

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  const [s] = await db.insert(studios).values({ clerkUserId: "u1", name: "S", slug: "s" }).returning();
  const [b] = await db.insert(bookings).values({
    studioId: s.id, renterName: "R", renterEmail: "r@x.com",
    startsAt: new Date("2026-08-01T18:00:00Z"), endsAt: new Date("2026-08-01T22:00:00Z"),
  }).returning();
  bookingId = b.id;
});
afterAll(async () => {
  await close();
});

describe("renter tokens", () => {
  it("mints a raw token and verifies it back to the booking id", async () => {
    const raw = await mintRenterToken(db, bookingId, "status", future);
    expect(raw).toMatch(/^[A-Za-z0-9_-]{40,}$/); // base64url of 32 bytes ≈ 43 chars
    expect(await verifyRenterToken(db, raw, "status")).toBe(bookingId);
  });

  it("stores only a hash, never the raw token", async () => {
    const raw = await mintRenterToken(db, bookingId, "status", future);
    const rows = await db.select().from(renterTokens).where(eq(renterTokens.bookingId, bookingId));
    for (const row of rows) {
      expect(row.tokenHash).not.toBe(raw);
      expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/); // sha256 hex
    }
  });

  it("rejects the wrong purpose", async () => {
    const raw = await mintRenterToken(db, bookingId, "status", future);
    expect(await verifyRenterToken(db, raw, "contract")).toBeNull();
  });

  it("rejects an expired token", async () => {
    const raw = await mintRenterToken(db, bookingId, "status", past);
    expect(await verifyRenterToken(db, raw, "status")).toBeNull();
  });

  it("re-minting rotates: the old token dies, one row per (booking,purpose)", async () => {
    const old = await mintRenterToken(db, bookingId, "status", future);
    const fresh = await mintRenterToken(db, bookingId, "status", future);
    expect(await verifyRenterToken(db, old, "status")).toBeNull();
    expect(await verifyRenterToken(db, fresh, "status")).toBe(bookingId);
    const rows = await db.select().from(renterTokens).where(eq(renterTokens.bookingId, bookingId));
    expect(rows.filter((r) => r.purpose === "status")).toHaveLength(1);
  });

  it("status and contract tokens coexist for one booking (contract link never rotates status)", async () => {
    const status = await mintRenterToken(db, bookingId, "status", future);
    const contract = await mintRenterToken(db, bookingId, "contract", future);
    // both remain independently valid — minting the contract token left status intact
    expect(await verifyRenterToken(db, status, "status")).toBe(bookingId);
    expect(await verifyRenterToken(db, contract, "contract")).toBe(bookingId);
    // each is scoped to its own purpose
    expect(await verifyRenterToken(db, status, "contract")).toBeNull();
    expect(await verifyRenterToken(db, contract, "status")).toBeNull();
    // one row per (booking, purpose): exactly one status and one contract row
    const rows = await db.select().from(renterTokens).where(eq(renterTokens.bookingId, bookingId));
    expect(rows.filter((r) => r.purpose === "status")).toHaveLength(1);
    expect(rows.filter((r) => r.purpose === "contract")).toHaveLength(1);
  });

  it("rejects garbage input", async () => {
    expect(await verifyRenterToken(db, "not-a-real-token", "status")).toBeNull();
  });
});
