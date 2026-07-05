import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "@/lib/domain/test-db";
import { studios } from "@/db/schema";
import {
  slugify, createStudio, getStudioByClerkUserId, getSpacesForStudio, getChecklistForStudio,
  updateProfile, updateHouseRules, updatePricing, replaceChecklistItems, completeOnboarding,
  DEFAULT_CHECKLIST, STANDARD_LADDER,
} from "@/lib/studio";

let db: TestDb;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
});
afterAll(async () => {
  await close();
});

describe("slugify", () => {
  it("lowercases, hyphenates, strips punctuation", () => {
    expect(slugify("Westview Studio")).toBe("westview-studio");
    expect(slugify("  K&Co. Loft!  ")).toBe("k-co-loft");
  });
  it("falls back for empty results", () => {
    expect(slugify("???")).toBe("studio");
  });
});

describe("createStudio", () => {
  it("creates the studio with slug, ladder, default checklist, and spaces", async () => {
    const studio = await createStudio(db, {
      clerkUserId: "user_a",
      name: "Westview Studio",
      address: "742 Lowery Blvd",
      equipmentList: "Profoto B10 kit",
      spaces: [
        { name: "Main floor + cyc wall", maxOccupancy: 40 },
        { name: "Lounge", maxOccupancy: 15 },
      ],
    });
    expect(studio.slug).toBe("westview-studio");
    expect(studio.cancellationLadder).toEqual(STANDARD_LADDER);
    expect(studio.onboardingCompletedAt).toBeNull();

    const sp = await getSpacesForStudio(db, studio.id);
    expect(sp.map((s) => s.name)).toEqual(["Main floor + cyc wall", "Lounge"]);

    const items = await getChecklistForStudio(db, studio.id);
    expect(items.map((i) => i.name)).toEqual(DEFAULT_CHECKLIST.map((d) => d.name));
    expect(items.map((i) => i.position)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("suffixes the slug on collision", async () => {
    const second = await createStudio(db, {
      clerkUserId: "user_b", name: "Westview Studio", address: null, equipmentList: null, spaces: [],
    });
    expect(second.slug).toBe("westview-studio-2");
    const third = await createStudio(db, {
      clerkUserId: "user_c", name: "Westview Studio", address: null, equipmentList: null, spaces: [],
    });
    expect(third.slug).toBe("westview-studio-3");
  });

  it("finds a studio by clerk user id (and misses cleanly)", async () => {
    const found = await getStudioByClerkUserId(db, "user_a");
    expect(found?.name).toBe("Westview Studio");
    expect(await getStudioByClerkUserId(db, "user_nope")).toBeUndefined();
  });
});

describe("step updates", () => {
  it("updateProfile replaces spaces and preserves the slug", async () => {
    const studio = await createStudio(db, {
      clerkUserId: "user_upd", name: "Update Me", address: null, equipmentList: null,
      spaces: [{ name: "Old room", maxOccupancy: 10 }],
    });
    await updateProfile(db, studio.id, {
      name: "Renamed Studio", address: "New addr", equipmentList: "New gear",
      spaces: [{ name: "Room A", maxOccupancy: 20 }, { name: "Room B", maxOccupancy: null }],
    });
    const after = await getStudioByClerkUserId(db, "user_upd");
    expect(after?.name).toBe("Renamed Studio");
    expect(after?.slug).toBe("update-me"); // immutable
    const sp = await getSpacesForStudio(db, studio.id);
    expect(sp.map((s) => s.name)).toEqual(["Room A", "Room B"]);
  });

  it("updateHouseRules and updatePricing persist independently of profile fields", async () => {
    const studio = await createStudio(db, {
      clerkUserId: "user_ind", name: "Indy", address: "Addr", equipmentList: "Gear", spaces: [],
    });
    await updateHouseRules(db, studio.id, {
      alcoholPolicy: "prohibited", vendorPolicy: "allowed", noiseCurfew: "10:00 PM", cleanupWindowMin: 30,
    });
    await updatePricing(db, studio.id, { hourlyRateCents: 16500, minHours: 3, depositCents: 40000 });
    const after = await getStudioByClerkUserId(db, "user_ind");
    expect(after).toMatchObject({
      name: "Indy", address: "Addr", equipmentList: "Gear",      // untouched
      alcoholPolicy: "prohibited", vendorPolicy: "allowed",
      hourlyRateCents: 16500, minHours: 3, depositCents: 40000,
    });
  });

  it("replaceChecklistItems replaces all items with 1-based positions", async () => {
    const studio = await createStudio(db, {
      clerkUserId: "user_ck", name: "Check", address: null, equipmentList: null, spaces: [],
    });
    await replaceChecklistItems(db, studio.id, [
      { name: "Kitchen", hint: "Counters" }, { name: "Patio", hint: null },
    ]);
    const items = await getChecklistForStudio(db, studio.id);
    expect(items.map((i) => [i.position, i.name])).toEqual([[1, "Kitchen"], [2, "Patio"]]);
  });

  it("completeOnboarding sets the timestamp once and never resets it", async () => {
    const studio = await createStudio(db, {
      clerkUserId: "user_done", name: "Done", address: null, equipmentList: null, spaces: [],
    });
    await completeOnboarding(db, studio.id);
    const [first] = await db.select().from(studios).where(eq(studios.id, studio.id));
    expect(first.onboardingCompletedAt).not.toBeNull();
    await new Promise((r) => setTimeout(r, 10));
    await completeOnboarding(db, studio.id);
    const [second] = await db.select().from(studios).where(eq(studios.id, studio.id));
    expect(second.onboardingCompletedAt?.getTime()).toBe(first.onboardingCompletedAt?.getTime());
  });
});
