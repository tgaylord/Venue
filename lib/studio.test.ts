import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestDb, type TestDb } from "@/lib/domain/test-db";
import {
  slugify, createStudio, getStudioByClerkUserId, getSpacesForStudio, getChecklistForStudio,
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
