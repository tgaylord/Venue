# VenueDash Phase 3 — Onboarding Wizard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A signed-up owner walks a 5-step wizard at `/settings` and comes out with a configured studio (slug, spaces, policies, pricing, checklist), a "share your link" dashboard empty state, and landing CTAs re-pointed to sign-up.

**Architecture:** Server-first wizard: each step is a small client form component calling a per-step server action; actions are thin (Clerk `auth()` → pure FormData parser → `lib/studio.ts` persistence function taking the `Db` handle). All testable logic (money parsing, form parsing, persistence incl. slug generation and defaults seeding) is pure or PGlite-tested. `proxy.ts` gains `/settings(.*)` protection.

**Tech Stack:** Next.js 16 App Router · React 19 (`useActionState`) · Clerk `auth()` · Drizzle + existing `getDb()` singleton · PGlite test harness (`lib/domain/test-db.ts`) · Vitest.

## Global Constraints

_Copied from the Phase 3 spec (`docs/specs/2026-07-05-venuedash-phase-3-onboarding-wizard-design.md`). Every task's requirements implicitly include this section._

- **Branch `feat/phase-3-onboarding-wizard`** (exists, contains the spec). One PR.
- **Node 20:** prefix EVERY npm command with `source ~/.nvm/nvm.sh && nvm use 20 && ` (default shell Node is 24; engine-strict rejects it).
- **No new npm dependencies.**
- **Do NOT touch** `prototype/`, `app/(public)`, `db/schema.ts`, `drizzle/`, `lib/domain/`, `lib/tokens.ts`, `scripts/seed.ts`. Marketing changes are limited to `Header.tsx`, `Hero.tsx`, `PricingCta.tsx`.
- **State discipline still holds:** nothing in this phase touches `bookings` at all.
- **Enum values (exact):** `alcohol_policy` ∈ `byob_with_acknowledgment` | `prohibited` | `licensed_bartender_only`; `vendor_policy` ∈ `pre_approval` | `allowed`.
- **Standard cancellation ladder jsonb (exact):** `{ "full": 30, "half": 14, "none": 0 }`.
- **Default checklist (exact 6, in order):** Cyc wall / Floors / Lighting equipment / Furniture & props / Bathroom / Entryway & door — with the hints used in `scripts/seed.ts`.
- **Slug:** generated once at creation (slugified name, numeric-suffix uniqueness: `westview`, `westview-2`); immutable afterwards. `onboarding_completed_at` set on first step-5 save, never cleared.
- **Copy truth:** no "VenueDash processes the deposit", no COI toggle, no 48-hour-claim-window line, no "immutable evidence". Step-3 copy: "The deposit is a term in your contract — you collect and return it the way you already do."
- **Design tokens:** dark owner surface (`bg-owner-bg`, `bg-owner-panel #16171c`, `border-owner-border #26272e`, `text-owner-muted`, accent `owner-accent`); prototype hexes without tokens as arbitrary values (`#5e6070` dim text, pill active `rgba(122,134,255,.14)` + `#aab2ff`).
- **Tests run in CI with no secrets** (PGlite + pure functions). Existing 119 tests keep passing.

---

## File Structure

```
lib/money.ts + lib/money.test.ts                    → parseDollarsToCents (pure)
lib/studio.ts + lib/studio.test.ts                  → persistence: create/get/update fns (Db param, PGlite-tested)
app/(owner)/settings/forms.ts + forms.test.ts       → pure FormData parsers per step
app/(owner)/settings/actions.ts                     → thin server actions (auth → parse → persist → redirect)
app/(owner)/settings/page.tsx                       → wizard shell: fetch studio, step clamp, dots, render step
app/(owner)/settings/_components/WizardDots.tsx     → progress dots / step links
app/(owner)/settings/_components/Step1Profile.tsx   → client form (spaces editor inline)
app/(owner)/settings/_components/Step2Rules.tsx     → client form (pill selects inline)
app/(owner)/settings/_components/Step3Pricing.tsx   → client form
app/(owner)/settings/_components/Step4Contract.tsx  → server component (clause summary + disclaimer)
app/(owner)/settings/_components/Step5Checklist.tsx → client form (checklist editor + You're live card)
app/(owner)/_components/CopyLinkButton.tsx          → client copy-to-clipboard button (shared with dashboard)
app/(owner)/dashboard/page.tsx                      → MODIFY: redirect-to-wizard / share-link empty state
proxy.ts                                            → MODIFY: matcher + "/settings(.*)"
app/(marketing)/_components/Header.tsx              → MODIFY: CTA → /sign-up
app/(marketing)/_components/Hero.tsx                → MODIFY: button pair, waitlist form removed
app/(marketing)/_components/PricingCta.tsx          → MODIFY: secondary waitlist copy + id="waitlist"
```

---

### Task 1: Money parser + studio creation path (slug, defaults)

**Files:**
- Create: `lib/money.ts`, `lib/money.test.ts`, `lib/studio.ts`, `lib/studio.test.ts`

**Interfaces:**
- Consumes: `Db` from `@/lib/domain/transitions`; `studios`, `spaces`, `checklistItems` from `@/db/schema`; `createTestDb` from `@/lib/domain/test-db`.
- Produces (used by Tasks 2–6):
  ```ts
  // lib/money.ts
  export function parseDollarsToCents(input: string): number | null   // "$165" | "165" | "165.50" → cents; null if invalid/≤0
  // lib/studio.ts
  export const STANDARD_LADDER = { full: 30, half: 14, none: 0 } as const
  export const DEFAULT_CHECKLIST: readonly { name: string; hint: string }[]  // the 6 defaults
  export function slugify(name: string): string
  export type SpaceInput = { name: string; maxOccupancy: number | null }
  export async function getStudioByClerkUserId(db: Db, clerkUserId: string): Promise<Studio | undefined>
  export async function getSpacesForStudio(db: Db, studioId: string): Promise<Space[]>
  export async function getChecklistForStudio(db: Db, studioId: string): Promise<ChecklistItem[]>  // ordered by position
  export async function createStudio(db: Db, input: { clerkUserId: string; name: string; address: string | null; equipmentList: string | null; spaces: SpaceInput[] }): Promise<Studio>
  ```
  (`Studio`/`Space`/`ChecklistItem` = `$inferSelect` types re-exported from `lib/studio.ts`.)

- [ ] **Step 1: Write the failing money test**

Create `lib/money.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseDollarsToCents } from "@/lib/money";

describe("parseDollarsToCents", () => {
  it("parses plain dollars", () => {
    expect(parseDollarsToCents("165")).toBe(16500);
  });
  it("parses $ prefix and commas and whitespace", () => {
    expect(parseDollarsToCents(" $1,250 ")).toBe(125000);
  });
  it("parses decimals to exact cents", () => {
    expect(parseDollarsToCents("165.50")).toBe(16550);
    expect(parseDollarsToCents("0.99")).toBe(99);
  });
  it("rejects garbage, negatives, zero, and >2 decimals", () => {
    expect(parseDollarsToCents("abc")).toBeNull();
    expect(parseDollarsToCents("-5")).toBeNull();
    expect(parseDollarsToCents("0")).toBeNull();
    expect(parseDollarsToCents("1.234")).toBeNull();
    expect(parseDollarsToCents("")).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `source ~/.nvm/nvm.sh && nvm use 20 && npm test -- lib/money.test.ts`
Expected: FAIL — cannot resolve `@/lib/money`.

- [ ] **Step 3: Implement `lib/money.ts`**

```ts
/** Parse a user-entered dollar amount ("$165", "165.50", "1,250") to positive integer cents. */
export function parseDollarsToCents(input: string): number | null {
  const cleaned = input.trim().replace(/^\$/, "").replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const cents = Math.round(parseFloat(cleaned) * 100);
  return cents > 0 ? cents : null;
}
```

- [ ] **Step 4: Verify money tests pass**

Run: `source ~/.nvm/nvm.sh && nvm use 20 && npm test -- lib/money.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Write the failing studio-creation tests**

Create `lib/studio.test.ts`:

```ts
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
```

- [ ] **Step 6: Run to verify it fails**

Run: `source ~/.nvm/nvm.sh && nvm use 20 && npm test -- lib/studio.test.ts`
Expected: FAIL — cannot resolve `@/lib/studio`.

- [ ] **Step 7: Implement `lib/studio.ts` (creation path)**

```ts
import { asc, eq, like } from "drizzle-orm";
import { studios, spaces, checklistItems } from "@/db/schema";
import type { Db } from "@/lib/domain/transitions";

export type Studio = typeof studios.$inferSelect;
export type Space = typeof spaces.$inferSelect;
export type ChecklistItem = typeof checklistItems.$inferSelect;
export type SpaceInput = { name: string; maxOccupancy: number | null };

export const STANDARD_LADDER = { full: 30, half: 14, none: 0 } as const;

export const DEFAULT_CHECKLIST: readonly { name: string; hint: string }[] = [
  { name: "Cyc wall", hint: "Full-width shot, both corners" },
  { name: "Floors", hint: "Any existing scuffs or marks" },
  { name: "Lighting equipment", hint: "Stands, softboxes, cables" },
  { name: "Furniture & props", hint: "Couch, tables, decor wall" },
  { name: "Bathroom", hint: "Fixtures and counter" },
  { name: "Entryway & door", hint: "Locks, handles, signage" },
];

export function slugify(name: string): string {
  const s = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-+|-+$)/g, "");
  return s || "studio";
}

async function uniqueSlug(db: Db, base: string): Promise<string> {
  const taken = new Set(
    (await db.select({ slug: studios.slug }).from(studios).where(like(studios.slug, `${base}%`)))
      .map((r) => r.slug)
  );
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

export async function getStudioByClerkUserId(db: Db, clerkUserId: string): Promise<Studio | undefined> {
  const [row] = await db.select().from(studios).where(eq(studios.clerkUserId, clerkUserId));
  return row;
}

export async function getSpacesForStudio(db: Db, studioId: string): Promise<Space[]> {
  return db.select().from(spaces).where(eq(spaces.studioId, studioId));
}

export async function getChecklistForStudio(db: Db, studioId: string): Promise<ChecklistItem[]> {
  return db.select().from(checklistItems)
    .where(eq(checklistItems.studioId, studioId))
    .orderBy(asc(checklistItems.position));
}

/** Step 1 first save: studio + slug + standard ladder + default checklist + spaces, atomically. */
export async function createStudio(
  db: Db,
  input: { clerkUserId: string; name: string; address: string | null; equipmentList: string | null; spaces: SpaceInput[] }
): Promise<Studio> {
  return db.transaction(async (tx) => {
    const slug = await uniqueSlug(tx as unknown as Db, slugify(input.name));
    const [studio] = await tx.insert(studios).values({
      clerkUserId: input.clerkUserId,
      name: input.name,
      slug,
      address: input.address,
      equipmentList: input.equipmentList,
      cancellationLadder: STANDARD_LADDER,
    }).returning();

    if (input.spaces.length > 0) {
      await tx.insert(spaces).values(input.spaces.map((s) => ({ ...s, studioId: studio.id })));
    }
    await tx.insert(checklistItems).values(
      DEFAULT_CHECKLIST.map((c, i) => ({ studioId: studio.id, position: i + 1, name: c.name, hint: c.hint }))
    );
    return studio;
  });
}
```

- [ ] **Step 8: Run to verify all pass, then full suite**

Run: `source ~/.nvm/nvm.sh && nvm use 20 && npm test -- lib/money.test.ts lib/studio.test.ts && npm test && npm run typecheck`
Expected: new tests PASS; full suite ≈ 128; typecheck clean.

- [ ] **Step 9: Commit**

```bash
git add lib/money.ts lib/money.test.ts lib/studio.ts lib/studio.test.ts
git commit -m "feat: add money parser and studio creation with slug + defaults (tested)"
```

---

### Task 2: Studio update functions + completion semantics

**Files:**
- Modify: `lib/studio.ts`
- Test: `lib/studio.test.ts` (append a describe block)

**Interfaces:**
- Consumes: Task 1's exports.
- Produces (used by Task 4's actions):
  ```ts
  export async function updateProfile(db: Db, studioId: string, input: { name: string; address: string | null; equipmentList: string | null; spaces: SpaceInput[] }): Promise<void>  // does NOT change slug
  export async function updateHouseRules(db: Db, studioId: string, input: { alcoholPolicy: string; vendorPolicy: string; noiseCurfew: string | null; cleanupWindowMin: number | null }): Promise<void>
  export async function updatePricing(db: Db, studioId: string, input: { hourlyRateCents: number; minHours: number; depositCents: number }): Promise<void>
  export async function replaceChecklistItems(db: Db, studioId: string, items: { name: string; hint: string | null }[]): Promise<void>
  export async function completeOnboarding(db: Db, studioId: string): Promise<void>  // sets timestamp only if currently null
  ```

- [ ] **Step 1: Append the failing tests to `lib/studio.test.ts`**

```ts
import { eq } from "drizzle-orm";
import { studios } from "@/db/schema";
import {
  updateProfile, updateHouseRules, updatePricing, replaceChecklistItems, completeOnboarding,
} from "@/lib/studio";

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
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `source ~/.nvm/nvm.sh && nvm use 20 && npm test -- lib/studio.test.ts`
Expected: FAIL — `updateProfile` etc. not exported.

- [ ] **Step 3: Append implementations to `lib/studio.ts`**

```ts
import { and, isNull } from "drizzle-orm";  // merge into the existing drizzle-orm import

/** Step 1 re-save: update profile fields + replace spaces. Slug never changes. */
export async function updateProfile(
  db: Db,
  studioId: string,
  input: { name: string; address: string | null; equipmentList: string | null; spaces: SpaceInput[] }
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.update(studios)
      .set({ name: input.name, address: input.address, equipmentList: input.equipmentList })
      .where(eq(studios.id, studioId));
    await tx.delete(spaces).where(eq(spaces.studioId, studioId));
    if (input.spaces.length > 0) {
      await tx.insert(spaces).values(input.spaces.map((s) => ({ ...s, studioId })));
    }
  });
}

export async function updateHouseRules(
  db: Db,
  studioId: string,
  input: { alcoholPolicy: string; vendorPolicy: string; noiseCurfew: string | null; cleanupWindowMin: number | null }
): Promise<void> {
  await db.update(studios).set(input).where(eq(studios.id, studioId));
}

export async function updatePricing(
  db: Db,
  studioId: string,
  input: { hourlyRateCents: number; minHours: number; depositCents: number }
): Promise<void> {
  await db.update(studios).set(input).where(eq(studios.id, studioId));
}

export async function replaceChecklistItems(
  db: Db,
  studioId: string,
  items: { name: string; hint: string | null }[]
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(checklistItems).where(eq(checklistItems.studioId, studioId));
    if (items.length > 0) {
      await tx.insert(checklistItems).values(
        items.map((it, i) => ({ studioId, position: i + 1, name: it.name, hint: it.hint }))
      );
    }
  });
}

/** First step-5 save stamps completion; later saves never move it. */
export async function completeOnboarding(db: Db, studioId: string): Promise<void> {
  await db.update(studios)
    .set({ onboardingCompletedAt: new Date() })
    .where(and(eq(studios.id, studioId), isNull(studios.onboardingCompletedAt)));
}
```

- [ ] **Step 4: Verify pass + full suite + commit**

Run: `source ~/.nvm/nvm.sh && nvm use 20 && npm test -- lib/studio.test.ts && npm test && npm run typecheck`
Expected: all pass.

```bash
git add lib/studio.ts lib/studio.test.ts
git commit -m "feat: add per-step studio update functions with completion semantics (tested)"
```

---

### Task 3: Pure FormData parsers for the wizard steps

**Files:**
- Create: `app/(owner)/settings/forms.ts`, `app/(owner)/settings/forms.test.ts`

**Interfaces:**
- Consumes: `parseDollarsToCents` (Task 1), `SpaceInput` type (Task 1).
- Produces (used by Task 4's actions):
  ```ts
  export const ALCOHOL_POLICIES = ["byob_with_acknowledgment", "prohibited", "licensed_bartender_only"] as const
  export const VENDOR_POLICIES = ["pre_approval", "allowed"] as const
  export type ParseResult<T> = { ok: true; data: T } | { ok: false; fieldErrors: Record<string, string> }
  export function parseProfileForm(fd: FormData): ParseResult<{ name: string; address: string | null; equipmentList: string | null; spaces: SpaceInput[] }>
  export function parseRulesForm(fd: FormData): ParseResult<{ alcoholPolicy: string; vendorPolicy: string; noiseCurfew: string | null; cleanupWindowMin: number | null }>
  export function parsePricingForm(fd: FormData): ParseResult<{ hourlyRateCents: number; minHours: number; depositCents: number }>
  export function parseChecklistForm(fd: FormData): ParseResult<{ items: { name: string; hint: string | null }[] }>
  ```
- FormData field names (Tasks 4–5 must match): `name`, `address`, `equipmentList`; repeated `spaceName` / `spaceCap` pairs; `alcoholPolicy`, `vendorPolicy`, `noiseCurfew`, `cleanupWindowMin`; `hourlyRate`, `minHours`, `deposit`; repeated `itemName` / `itemHint` pairs.

- [ ] **Step 1: Write the failing tests**

Create `app/(owner)/settings/forms.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  parseProfileForm, parseRulesForm, parsePricingForm, parseChecklistForm,
} from "@/app/(owner)/settings/forms";

function fd(fields: Record<string, string | string[]>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    for (const item of Array.isArray(v) ? v : [v]) f.append(k, item);
  }
  return f;
}

describe("parseProfileForm", () => {
  it("parses name, optionals, and space rows (skipping blank rows)", () => {
    const r = parseProfileForm(fd({
      name: " Westview Studio ", address: "", equipmentList: "Profoto kit",
      spaceName: ["Main floor", "", "Lounge"], spaceCap: ["40", "", ""],
    }));
    expect(r).toEqual({
      ok: true,
      data: {
        name: "Westview Studio", address: null, equipmentList: "Profoto kit",
        spaces: [{ name: "Main floor", maxOccupancy: 40 }, { name: "Lounge", maxOccupancy: null }],
      },
    });
  });
  it("requires a name and numeric caps", () => {
    const r1 = parseProfileForm(fd({ name: "  " }));
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.fieldErrors.name).toBeTruthy();
    const r2 = parseProfileForm(fd({ name: "S", spaceName: ["Room"], spaceCap: ["lots"] }));
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.fieldErrors.spaces).toBeTruthy();
  });
});

describe("parseRulesForm", () => {
  it("accepts valid enums and bounds", () => {
    const r = parseRulesForm(fd({
      alcoholPolicy: "byob_with_acknowledgment", vendorPolicy: "pre_approval",
      noiseCurfew: "10:00 PM", cleanupWindowMin: "30",
    }));
    expect(r).toEqual({
      ok: true,
      data: { alcoholPolicy: "byob_with_acknowledgment", vendorPolicy: "pre_approval", noiseCurfew: "10:00 PM", cleanupWindowMin: 30 },
    });
  });
  it("rejects unknown enum values and out-of-range cleanup", () => {
    const r1 = parseRulesForm(fd({ alcoholPolicy: "open_bar", vendorPolicy: "allowed" }));
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.fieldErrors.alcoholPolicy).toBeTruthy();
    const r2 = parseRulesForm(fd({ alcoholPolicy: "prohibited", vendorPolicy: "allowed", cleanupWindowMin: "999" }));
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.fieldErrors.cleanupWindowMin).toBeTruthy();
  });
});

describe("parsePricingForm", () => {
  it("parses dollars to cents and bounds minHours", () => {
    const r = parsePricingForm(fd({ hourlyRate: "$165", minHours: "3", deposit: "400" }));
    expect(r).toEqual({ ok: true, data: { hourlyRateCents: 16500, minHours: 3, depositCents: 40000 } });
  });
  it("rejects bad money and minHours out of 1-24", () => {
    const r1 = parsePricingForm(fd({ hourlyRate: "free", minHours: "3", deposit: "400" }));
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.fieldErrors.hourlyRate).toBeTruthy();
    const r2 = parsePricingForm(fd({ hourlyRate: "165", minHours: "25", deposit: "400" }));
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.fieldErrors.minHours).toBeTruthy();
  });
});

describe("parseChecklistForm", () => {
  it("parses ordered items, blank hints become null, blank rows skipped", () => {
    const r = parseChecklistForm(fd({ itemName: ["Cyc wall", "", "Floors"], itemHint: ["Both corners", "", ""] }));
    expect(r).toEqual({
      ok: true,
      data: { items: [{ name: "Cyc wall", hint: "Both corners" }, { name: "Floors", hint: null }] },
    });
  });
  it("requires 1-20 items", () => {
    const none = parseChecklistForm(fd({ itemName: [""], itemHint: [""] }));
    expect(none.ok).toBe(false);
    const many = parseChecklistForm(fd({
      itemName: Array.from({ length: 21 }, (_, i) => `Area ${i}`),
      itemHint: Array.from({ length: 21 }, () => ""),
    }));
    expect(many.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `source ~/.nvm/nvm.sh && nvm use 20 && npm test -- "app/(owner)/settings/forms.test.ts"`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `app/(owner)/settings/forms.ts`**

```ts
import { parseDollarsToCents } from "@/lib/money";
import type { SpaceInput } from "@/lib/studio";

export const ALCOHOL_POLICIES = ["byob_with_acknowledgment", "prohibited", "licensed_bartender_only"] as const;
export const VENDOR_POLICIES = ["pre_approval", "allowed"] as const;

export type ParseResult<T> = { ok: true; data: T } | { ok: false; fieldErrors: Record<string, string> };

const str = (fd: FormData, key: string) => String(fd.get(key) ?? "").trim();
const optional = (s: string) => (s.length > 0 ? s : null);

export function parseProfileForm(fd: FormData): ParseResult<{
  name: string; address: string | null; equipmentList: string | null; spaces: SpaceInput[];
}> {
  const fieldErrors: Record<string, string> = {};
  const name = str(fd, "name");
  if (!name) fieldErrors.name = "Studio name is required.";

  const names = fd.getAll("spaceName").map(String);
  const caps = fd.getAll("spaceCap").map(String);
  const spaces: SpaceInput[] = [];
  for (let i = 0; i < names.length; i++) {
    const n = names[i].trim();
    if (!n) continue; // blank row — ignore
    const capRaw = (caps[i] ?? "").trim();
    if (capRaw && !/^\d+$/.test(capRaw)) {
      fieldErrors.spaces = "Occupancy caps must be whole numbers.";
      break;
    }
    spaces.push({ name: n, maxOccupancy: capRaw ? parseInt(capRaw, 10) : null });
  }

  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };
  return { ok: true, data: { name, address: optional(str(fd, "address")), equipmentList: optional(str(fd, "equipmentList")), spaces } };
}

export function parseRulesForm(fd: FormData): ParseResult<{
  alcoholPolicy: string; vendorPolicy: string; noiseCurfew: string | null; cleanupWindowMin: number | null;
}> {
  const fieldErrors: Record<string, string> = {};
  const alcoholPolicy = str(fd, "alcoholPolicy");
  const vendorPolicy = str(fd, "vendorPolicy");
  if (!(ALCOHOL_POLICIES as readonly string[]).includes(alcoholPolicy)) fieldErrors.alcoholPolicy = "Pick an alcohol policy.";
  if (!(VENDOR_POLICIES as readonly string[]).includes(vendorPolicy)) fieldErrors.vendorPolicy = "Pick a vendor policy.";

  const curfew = str(fd, "noiseCurfew");
  if (curfew.length > 40) fieldErrors.noiseCurfew = "Keep the curfew under 40 characters.";

  const cleanupRaw = str(fd, "cleanupWindowMin");
  let cleanupWindowMin: number | null = null;
  if (cleanupRaw) {
    const n = parseInt(cleanupRaw, 10);
    if (!/^\d+$/.test(cleanupRaw) || n < 1 || n > 720) fieldErrors.cleanupWindowMin = "Cleanup window must be 1-720 minutes.";
    else cleanupWindowMin = n;
  }

  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };
  return { ok: true, data: { alcoholPolicy, vendorPolicy, noiseCurfew: optional(curfew), cleanupWindowMin } };
}

export function parsePricingForm(fd: FormData): ParseResult<{
  hourlyRateCents: number; minHours: number; depositCents: number;
}> {
  const fieldErrors: Record<string, string> = {};
  const hourlyRateCents = parseDollarsToCents(str(fd, "hourlyRate"));
  if (hourlyRateCents === null) fieldErrors.hourlyRate = "Enter an hourly rate like $165.";
  const depositCents = parseDollarsToCents(str(fd, "deposit"));
  if (depositCents === null) fieldErrors.deposit = "Enter a deposit amount like $400.";
  const minHoursRaw = str(fd, "minHours");
  const minHours = parseInt(minHoursRaw, 10);
  if (!/^\d+$/.test(minHoursRaw) || minHours < 1 || minHours > 24) fieldErrors.minHours = "Minimum hours must be 1-24.";

  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };
  return { ok: true, data: { hourlyRateCents: hourlyRateCents!, minHours, depositCents: depositCents! } };
}

export function parseChecklistForm(fd: FormData): ParseResult<{ items: { name: string; hint: string | null }[] }> {
  const names = fd.getAll("itemName").map(String);
  const hints = fd.getAll("itemHint").map(String);
  const items: { name: string; hint: string | null }[] = [];
  for (let i = 0; i < names.length; i++) {
    const name = names[i].trim();
    if (!name) continue;
    if (name.length > 60) return { ok: false, fieldErrors: { items: "Area names must be under 60 characters." } };
    const hint = (hints[i] ?? "").trim();
    if (hint.length > 120) return { ok: false, fieldErrors: { items: "Hints must be under 120 characters." } };
    items.push({ name, hint: hint || null });
  }
  if (items.length < 1 || items.length > 20) {
    return { ok: false, fieldErrors: { items: "Add between 1 and 20 areas." } };
  }
  return { ok: true, data: { items } };
}
```

- [ ] **Step 4: Verify pass + full suite + commit**

Run: `source ~/.nvm/nvm.sh && nvm use 20 && npm test -- "app/(owner)/settings/forms.test.ts" && npm test && npm run typecheck`
Expected: all pass (8 new tests).

```bash
git add "app/(owner)/settings/forms.ts" "app/(owner)/settings/forms.test.ts"
git commit -m "feat: add pure FormData parsers for wizard steps (tested)"
```

---

### Task 4: Server actions, proxy gating, wizard shell + Step 1

**Files:**
- Create: `app/(owner)/settings/actions.ts`, `app/(owner)/settings/page.tsx`, `app/(owner)/settings/_components/WizardDots.tsx`, `app/(owner)/settings/_components/Step1Profile.tsx`
- Modify: `proxy.ts`

**Interfaces:**
- Consumes: parsers (Task 3), `createStudio`/`updateProfile`/`getStudioByClerkUserId`/`getSpacesForStudio`/`getChecklistForStudio` (Tasks 1–2), `getDb` from `@/lib/db`, Clerk `auth` from `@clerk/nextjs/server`.
- Produces (used by Task 5):
  ```ts
  // actions.ts
  export type WizardFormState = { status: "idle" | "error"; fieldErrors: Record<string, string> }
  export const WIZARD_IDLE: WizardFormState
  export async function saveProfile(prev: WizardFormState, fd: FormData): Promise<WizardFormState>    // → redirect /settings?step=2
  export async function saveRules(prev: WizardFormState, fd: FormData): Promise<WizardFormState>      // → redirect /settings?step=3
  export async function savePricing(prev: WizardFormState, fd: FormData): Promise<WizardFormState>    // → redirect /settings?step=4
  export async function saveChecklist(prev: WizardFormState, fd: FormData): Promise<WizardFormState>  // → completeOnboarding + redirect /dashboard
  ```
  Successful saves redirect (throwing NEXT_REDIRECT); only errors return state. Step 4 has no action (read-only): its "Continue" is a link to `?step=5`.

- [ ] **Step 1: Broaden `proxy.ts` protection**

Change the matcher line only:

```ts
const isProtected = createRouteMatcher(["/dashboard(.*)", "/settings(.*)"]);
```

- [ ] **Step 2: Implement `app/(owner)/settings/actions.ts`**

```ts
"use server";

import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { getDb } from "@/lib/db";
import {
  createStudio, updateProfile, updateHouseRules, updatePricing,
  replaceChecklistItems, completeOnboarding, getStudioByClerkUserId,
} from "@/lib/studio";
import { parseProfileForm, parseRulesForm, parsePricingForm, parseChecklistForm } from "./forms";

export type WizardFormState = { status: "idle" | "error"; fieldErrors: Record<string, string> };
export const WIZARD_IDLE: WizardFormState = { status: "idle", fieldErrors: {} };

async function requireUserId(): Promise<string> {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");
  return userId;
}

export async function saveProfile(_prev: WizardFormState, fd: FormData): Promise<WizardFormState> {
  const userId = await requireUserId();
  const parsed = parseProfileForm(fd);
  if (!parsed.ok) return { status: "error", fieldErrors: parsed.fieldErrors };

  const db = getDb();
  const existing = await getStudioByClerkUserId(db, userId);
  if (existing) {
    await updateProfile(db, existing.id, parsed.data);
  } else {
    await createStudio(db, { clerkUserId: userId, ...parsed.data });
  }
  redirect("/settings?step=2");
}

export async function saveRules(_prev: WizardFormState, fd: FormData): Promise<WizardFormState> {
  const userId = await requireUserId();
  const parsed = parseRulesForm(fd);
  if (!parsed.ok) return { status: "error", fieldErrors: parsed.fieldErrors };

  const db = getDb();
  const studio = await getStudioByClerkUserId(db, userId);
  if (!studio) redirect("/settings?step=1");
  await updateHouseRules(db, studio.id, parsed.data);
  redirect("/settings?step=3");
}

export async function savePricing(_prev: WizardFormState, fd: FormData): Promise<WizardFormState> {
  const userId = await requireUserId();
  const parsed = parsePricingForm(fd);
  if (!parsed.ok) return { status: "error", fieldErrors: parsed.fieldErrors };

  const db = getDb();
  const studio = await getStudioByClerkUserId(db, userId);
  if (!studio) redirect("/settings?step=1");
  await updatePricing(db, studio.id, parsed.data);
  redirect("/settings?step=4");
}

export async function saveChecklist(_prev: WizardFormState, fd: FormData): Promise<WizardFormState> {
  const userId = await requireUserId();
  const parsed = parseChecklistForm(fd);
  if (!parsed.ok) return { status: "error", fieldErrors: parsed.fieldErrors };

  const db = getDb();
  const studio = await getStudioByClerkUserId(db, userId);
  if (!studio) redirect("/settings?step=1");
  await replaceChecklistItems(db, studio.id, parsed.data.items);
  await completeOnboarding(db, studio.id);
  redirect("/dashboard");
}
```

- [ ] **Step 3: Create `app/(owner)/settings/_components/WizardDots.tsx`**

```tsx
import Link from "next/link";

export default function WizardDots({ current, unlocked }: { current: number; unlocked: number }) {
  return (
    <div className="mb-7 flex gap-1.5">
      {[1, 2, 3, 4, 5].map((n) => {
        const bar = (
          <div className={`h-1 flex-1 rounded-full ${n <= current ? "bg-owner-accent" : "bg-owner-border"}`} />
        );
        return n <= unlocked ? (
          <Link key={n} href={`/settings?step=${n}`} className="flex-1" aria-label={`Step ${n}`}>
            {bar}
          </Link>
        ) : (
          <div key={n} className="flex-1">{bar}</div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Create `app/(owner)/settings/_components/Step1Profile.tsx`**

```tsx
"use client";

import { useActionState, useState } from "react";
import { saveProfile, WIZARD_IDLE } from "../actions";
import type { Space } from "@/lib/studio";

const inputCls =
  "w-full rounded-[9px] border border-owner-border bg-owner-panel px-3.5 py-3 text-sm text-owner-text placeholder:text-[#5e6070] focus:border-owner-accent focus:outline-none";
const labelCls = "mb-1.5 block text-xs font-semibold text-owner-muted";

export default function Step1Profile({ initial }: {
  initial: { name: string; address: string; equipmentList: string; spaces: Pick<Space, "name" | "maxOccupancy">[] };
}) {
  const [state, formAction, pending] = useActionState(saveProfile, WIZARD_IDLE);
  const [rows, setRows] = useState(
    initial.spaces.length > 0 ? initial.spaces : [{ name: "", maxOccupancy: null }]
  );

  return (
    <form action={formAction}>
      <h2 className="mb-1.5 text-[22px] font-bold tracking-tight">Your studio</h2>
      <p className="mb-6 text-[13px] leading-relaxed text-owner-muted">
        This fills in your contracts and your public booking page.
      </p>
      <div className="flex flex-col gap-3.5">
        <div>
          <label htmlFor="name" className={labelCls}>Studio name</label>
          <input id="name" name="name" defaultValue={initial.name} required className={inputCls} />
          {state.fieldErrors.name && <p className="mt-1 text-xs text-danger">{state.fieldErrors.name}</p>}
        </div>
        <div>
          <label htmlFor="address" className={labelCls}>Address</label>
          <input id="address" name="address" defaultValue={initial.address} className={inputCls} />
        </div>
        <div>
          <span className={labelCls}>Spaces &amp; areas renters can access</span>
          <div className="flex flex-col gap-2">
            {rows.map((row, i) => (
              <div key={i} className="flex gap-2">
                <input
                  name="spaceName" defaultValue={row.name} placeholder="e.g. Main floor + cyc wall"
                  aria-label={`Space ${i + 1} name`} className={`${inputCls} flex-1`}
                />
                <input
                  name="spaceCap" defaultValue={row.maxOccupancy ?? ""} placeholder="Cap"
                  aria-label={`Space ${i + 1} occupancy cap`} className={`${inputCls} w-[90px]`}
                />
              </div>
            ))}
            <button
              type="button"
              onClick={() => setRows((r) => [...r, { name: "", maxOccupancy: null }])}
              className="self-start p-0.5 text-xs font-semibold text-owner-accent"
            >
              + Add another space
            </button>
          </div>
          {state.fieldErrors.spaces && <p className="mt-1 text-xs text-danger">{state.fieldErrors.spaces}</p>}
        </div>
        <div>
          <label htmlFor="equipmentList" className={labelCls}>Equipment on-site (renters agree hands-off)</label>
          <input id="equipmentList" name="equipmentList" defaultValue={initial.equipmentList} className={inputCls} />
        </div>
      </div>
      <button
        type="submit" disabled={pending}
        className="mt-7 rounded-[9px] bg-owner-accent px-5 py-3 text-sm font-bold text-[#0d0e14] disabled:opacity-60"
      >
        {pending ? "Saving…" : "Save & continue"}
      </button>
    </form>
  );
}
```

- [ ] **Step 5: Create `app/(owner)/settings/page.tsx` (shell; steps 2–5 slots filled in Task 5)**

```tsx
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { getDb } from "@/lib/db";
import { getStudioByClerkUserId, getSpacesForStudio, getChecklistForStudio } from "@/lib/studio";
import WizardDots from "./_components/WizardDots";
import Step1Profile from "./_components/Step1Profile";

export default async function SettingsPage({ searchParams }: {
  searchParams: Promise<{ step?: string }>;
}) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const db = getDb();
  const studio = await getStudioByClerkUserId(db, userId);

  const requested = parseInt((await searchParams).step ?? "1", 10) || 1;
  // Without a studio only step 1 exists; with one, all steps are reachable.
  const unlocked = studio ? 5 : 1;
  const step = Math.min(Math.max(requested, 1), unlocked);

  const spaces = studio ? await getSpacesForStudio(db, studio.id) : [];
  const checklist = studio ? await getChecklistForStudio(db, studio.id) : [];
  void checklist; // consumed by Step5 in the next task

  return (
    <main className="mx-auto max-w-[620px] px-4 pb-16 pt-8">
      <h1 className="mb-1 font-serif text-2xl">{studio?.onboardingCompletedAt ? "Settings & policies" : "Set up your studio"}</h1>
      <p className="mb-5 text-xs text-owner-muted">Step {step} of 5 — each step saves on its own.</p>
      <WizardDots current={step} unlocked={unlocked} />

      {step === 1 && (
        <Step1Profile
          initial={{
            name: studio?.name ?? "",
            address: studio?.address ?? "",
            equipmentList: studio?.equipmentList ?? "",
            spaces: spaces.map((s) => ({ name: s.name, maxOccupancy: s.maxOccupancy })),
          }}
        />
      )}
      {step > 1 && (
        <p className="text-sm text-owner-muted">Step {step} arrives in the next task.</p>
      )}
    </main>
  );
}
```

- [ ] **Step 6: Verify behavior with the dev server**

Run: `source ~/.nvm/nvm.sh && nvm use 20 && npm run dev` (background), then:
- `curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" http://localhost:3000/settings` → expect `307` to a Clerk sign-in URL (proxy now protects /settings).
- Stop the server. (Signed-in flow is exercised on the preview deploy.)

- [ ] **Step 7: Gates + commit**

Run: `source ~/.nvm/nvm.sh && nvm use 20 && npm run lint && npm run typecheck && npm test && npm run build`
Expected: all pass; `/settings` appears in the route table as `ƒ` (dynamic — it reads auth) and that's correct.

```bash
git add proxy.ts "app/(owner)/settings"
git commit -m "feat: add wizard shell, server actions, step 1, and /settings gating"
```

---

### Task 5: Steps 2–5 UI (pills, pricing, contract summary, checklist + You're live)

**Files:**
- Create: `app/(owner)/settings/_components/Step2Rules.tsx`, `Step3Pricing.tsx`, `Step4Contract.tsx`, `Step5Checklist.tsx`, `app/(owner)/_components/CopyLinkButton.tsx`
- Modify: `app/(owner)/settings/page.tsx` (render steps 2–5)

**Interfaces:**
- Consumes: actions + `WizardFormState` (Task 4), parser field names (Task 3), studio/spaces/checklist data (Tasks 1–2).
- Produces: `CopyLinkButton({ slug }: { slug: string })` client component (reused by Task 6's dashboard).

- [ ] **Step 1: Create `app/(owner)/_components/CopyLinkButton.tsx`**

```tsx
"use client";

import { useState } from "react";

export default function CopyLinkButton({ slug }: { slug: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(`${window.location.origin}/book/${slug}`);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className="rounded-[9px] bg-owner-accent px-4 py-2 text-xs font-bold text-[#0d0e14]"
    >
      {copied ? "Copied!" : "Copy link"}
    </button>
  );
}
```

- [ ] **Step 2: Create `Step2Rules.tsx`**

```tsx
"use client";

import { useActionState, useState } from "react";
import { saveRules, WIZARD_IDLE } from "../actions";

const labelCls = "mb-2 block text-xs font-semibold text-owner-muted";
const inputCls =
  "w-full rounded-[9px] border border-owner-border bg-owner-panel px-3.5 py-3 text-sm text-owner-text focus:border-owner-accent focus:outline-none";

function Pills({ name, options, initial }: {
  name: string; options: { value: string; label: string }[]; initial: string;
}) {
  const [selected, setSelected] = useState(initial);
  return (
    <div className="flex flex-wrap gap-2">
      <input type="hidden" name={name} value={selected} />
      {options.map((o) => (
        <button
          key={o.value} type="button" onClick={() => setSelected(o.value)}
          className={`rounded-[9px] px-3.5 py-2 text-[12.5px] font-semibold ${
            selected === o.value
              ? "border border-owner-accent bg-[rgba(122,134,255,.14)] text-[#aab2ff]"
              : "border border-owner-border bg-owner-panel text-owner-muted"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export default function Step2Rules({ initial }: {
  initial: { alcoholPolicy: string; vendorPolicy: string; noiseCurfew: string; cleanupWindowMin: string };
}) {
  const [state, formAction, pending] = useActionState(saveRules, WIZARD_IDLE);
  return (
    <form action={formAction}>
      <h2 className="mb-1.5 text-[22px] font-bold tracking-tight">House rules</h2>
      <p className="mb-6 text-[13px] leading-relaxed text-owner-muted">
        These become enforceable clauses in every contract.
      </p>
      <div className="flex flex-col gap-4">
        <div>
          <span className={labelCls}>Alcohol policy</span>
          <Pills
            name="alcoholPolicy" initial={initial.alcoholPolicy}
            options={[
              { value: "byob_with_acknowledgment", label: "BYOB allowed with acknowledgment" },
              { value: "prohibited", label: "Prohibited" },
              { value: "licensed_bartender_only", label: "Licensed bartender only" },
            ]}
          />
          {state.fieldErrors.alcoholPolicy && <p className="mt-1 text-xs text-danger">{state.fieldErrors.alcoholPolicy}</p>}
        </div>
        <div>
          <span className={labelCls}>Outside vendors</span>
          <Pills
            name="vendorPolicy" initial={initial.vendorPolicy}
            options={[
              { value: "pre_approval", label: "Pre-approval required" },
              { value: "allowed", label: "Allowed freely" },
            ]}
          />
          {state.fieldErrors.vendorPolicy && <p className="mt-1 text-xs text-danger">{state.fieldErrors.vendorPolicy}</p>}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="noiseCurfew" className={labelCls}>Noise curfew</label>
            <input id="noiseCurfew" name="noiseCurfew" defaultValue={initial.noiseCurfew} placeholder="10:00 PM" className={inputCls} />
            <p className="mt-1.5 text-[10.5px] leading-normal text-[#5e6070]">
              Contract cites Atlanta Code § 74-133 (noise ordinance).
            </p>
            {state.fieldErrors.noiseCurfew && <p className="mt-1 text-xs text-danger">{state.fieldErrors.noiseCurfew}</p>}
          </div>
          <div>
            <label htmlFor="cleanupWindowMin" className={labelCls}>Cleanup window (minutes)</label>
            <input id="cleanupWindowMin" name="cleanupWindowMin" defaultValue={initial.cleanupWindowMin} placeholder="30" className={inputCls} />
            {state.fieldErrors.cleanupWindowMin && <p className="mt-1 text-xs text-danger">{state.fieldErrors.cleanupWindowMin}</p>}
          </div>
        </div>
      </div>
      <button type="submit" disabled={pending} className="mt-7 rounded-[9px] bg-owner-accent px-5 py-3 text-sm font-bold text-[#0d0e14] disabled:opacity-60">
        {pending ? "Saving…" : "Save & continue"}
      </button>
    </form>
  );
}
```

- [ ] **Step 3: Create `Step3Pricing.tsx`**

```tsx
"use client";

import { useActionState } from "react";
import { savePricing, WIZARD_IDLE } from "../actions";

const labelCls = "mb-1.5 block text-xs font-semibold text-owner-muted";
const inputCls =
  "w-full rounded-[9px] border border-owner-border bg-owner-panel px-3.5 py-3 text-sm text-owner-text focus:border-owner-accent focus:outline-none";

export default function Step3Pricing({ initial }: {
  initial: { hourlyRate: string; minHours: string; deposit: string };
}) {
  const [state, formAction, pending] = useActionState(savePricing, WIZARD_IDLE);
  return (
    <form action={formAction}>
      <h2 className="mb-1.5 text-[22px] font-bold tracking-tight">Pricing &amp; deposit</h2>
      <p className="mb-6 text-[13px] leading-relaxed text-owner-muted">
        The deposit is a term in your contract — you collect and return it the way you already do.
      </p>
      <div className="mb-4 grid grid-cols-3 gap-3">
        <div>
          <label htmlFor="hourlyRate" className={labelCls}>Hourly rate</label>
          <input id="hourlyRate" name="hourlyRate" defaultValue={initial.hourlyRate} placeholder="$165" className={inputCls} />
          {state.fieldErrors.hourlyRate && <p className="mt-1 text-xs text-danger">{state.fieldErrors.hourlyRate}</p>}
        </div>
        <div>
          <label htmlFor="minHours" className={labelCls}>Minimum hours</label>
          <input id="minHours" name="minHours" defaultValue={initial.minHours} placeholder="3" className={inputCls} />
          {state.fieldErrors.minHours && <p className="mt-1 text-xs text-danger">{state.fieldErrors.minHours}</p>}
        </div>
        <div>
          <label htmlFor="deposit" className={labelCls}>Damage deposit</label>
          <input id="deposit" name="deposit" defaultValue={initial.deposit} placeholder="$400" className={inputCls} />
          {state.fieldErrors.deposit && <p className="mt-1 text-xs text-danger">{state.fieldErrors.deposit}</p>}
        </div>
      </div>
      <div className="rounded-[11px] border border-owner-border bg-owner-panel p-4">
        <div className="mb-2.5 font-mono text-[9.5px] uppercase tracking-[.1em] text-[#5e6070]">
          Cancellation ladder · standard template
        </div>
        <div className="text-[12.5px] leading-8 text-[#c9cad2]">
          30+ days out — full refund<br />14–29 days — 50% refund<br />Under 14 days — no refund
        </div>
      </div>
      <button type="submit" disabled={pending} className="mt-7 rounded-[9px] bg-owner-accent px-5 py-3 text-sm font-bold text-[#0d0e14] disabled:opacity-60">
        {pending ? "Saving…" : "Save & continue"}
      </button>
    </form>
  );
}
```

- [ ] **Step 4: Create `Step4Contract.tsx` (server component, read-only)**

```tsx
import Link from "next/link";
import type { Space, Studio } from "@/lib/studio";

const POLICY_LABELS: Record<string, string> = {
  byob_with_acknowledgment: "BYOB with acknowledgment",
  prohibited: "Alcohol prohibited",
  licensed_bartender_only: "Licensed bartender only",
};

function dollars(cents: number | null): string {
  return cents === null ? "—" : `$${(cents / 100).toLocaleString()}`;
}

export default function Step4Contract({ studio, spaces }: { studio: Studio; spaces: Space[] }) {
  const maxCap = spaces.reduce((m, s) => Math.max(m, s.maxOccupancy ?? 0), 0);
  const lines = [
    studio.equipmentList ? `Equipment hands-off clause (${studio.equipmentList})` : "Equipment hands-off clause",
    `${maxCap > 0 ? `Max occupancy ${maxCap} · ` : ""}${POLICY_LABELS[studio.alcoholPolicy ?? ""] ?? "Alcohol policy from step 2"}`,
    `${studio.noiseCurfew ? `${studio.noiseCurfew} curfew · ` : ""}Atlanta Code § 74-133 referenced`,
    `${dollars(studio.depositCents)} deposit stated as a contract term — collected by you`,
    "Cancellation ladder · Georgia jurisdiction",
  ];
  return (
    <div>
      <h2 className="mb-1.5 text-[22px] font-bold tracking-tight">Your contract</h2>
      <p className="mb-6 text-[13px] leading-relaxed text-owner-muted">
        Generated from your answers. Georgia jurisdiction, ready to send with every booking.
      </p>
      <div className="mb-3.5 rounded-[11px] border border-owner-border bg-owner-panel p-[18px]">
        <div className="mb-3 text-[13.5px] font-bold">Standard Event Rental Agreement</div>
        <div className="text-[12.5px] leading-[1.9] text-owner-muted">
          {lines.map((l) => (
            <div key={l}>✓ {l}</div>
          ))}
        </div>
      </div>
      <p className="mb-6 text-[11px] leading-relaxed text-[#5e6070]">
        VenueDash is not a law firm and does not provide legal advice. This template will be
        reviewed by a Georgia attorney before launch; have your own attorney review anything you sign.
      </p>
      <Link
        href="/settings?step=5"
        className="inline-block rounded-[9px] bg-owner-accent px-5 py-3 text-sm font-bold text-[#0d0e14]"
      >
        Continue
      </Link>
    </div>
  );
}
```

- [ ] **Step 5: Create `Step5Checklist.tsx`**

```tsx
"use client";

import { useActionState, useState } from "react";
import { saveChecklist, WIZARD_IDLE } from "../actions";
import CopyLinkButton from "@/app/(owner)/_components/CopyLinkButton";

const inputCls =
  "rounded-[9px] border border-owner-border bg-owner-panel px-3.5 py-2.5 text-[13px] text-owner-text placeholder:text-[#5e6070] focus:border-owner-accent focus:outline-none";

export default function Step5Checklist({ initial, slug }: {
  initial: { name: string; hint: string }[]; slug: string;
}) {
  const [state, formAction, pending] = useActionState(saveChecklist, WIZARD_IDLE);
  const [rows, setRows] = useState(initial.length > 0 ? initial : [{ name: "", hint: "" }]);

  return (
    <form action={formAction}>
      <h2 className="mb-1.5 text-[22px] font-bold tracking-tight">Photo checklist</h2>
      <p className="mb-6 text-[13px] leading-relaxed text-owner-muted">
        Name every area you&apos;ll photograph before and after each event — this is your
        timestamped documentation of the space.
      </p>
      <div className="mb-4 flex flex-col gap-2">
        {rows.map((row, i) => (
          <div key={i} className="flex items-center gap-2.5 rounded-[9px] border border-owner-border bg-owner-panel px-3.5 py-2">
            <div className="w-[18px] font-mono text-[10px] text-[#5e6070]">{String(i + 1).padStart(2, "0")}</div>
            <input name="itemName" defaultValue={row.name} placeholder="Area name" aria-label={`Area ${i + 1} name`} className={`${inputCls} flex-1 border-0 bg-transparent px-0`} />
            <input name="itemHint" defaultValue={row.hint} placeholder="Hint (optional)" aria-label={`Area ${i + 1} hint`} className={`${inputCls} flex-1 border-0 bg-transparent px-0 text-owner-muted`} />
            <button
              type="button" aria-label={`Remove area ${i + 1}`}
              onClick={() => setRows((r) => r.filter((_, j) => j !== i))}
              className="text-[11px] text-[#5e6070] hover:text-danger"
            >
              Remove
            </button>
          </div>
        ))}
        <button
          type="button" onClick={() => setRows((r) => [...r, { name: "", hint: "" }])}
          className="self-start p-0.5 text-xs font-semibold text-owner-accent"
        >
          + Add an area
        </button>
        {state.fieldErrors.items && <p className="text-xs text-danger">{state.fieldErrors.items}</p>}
      </div>

      <div className="mb-6 rounded-[11px] border border-[#1e4a2c] bg-[#101a12] p-[18px] text-center">
        <div className="mb-2 font-mono text-[9.5px] uppercase tracking-[.12em] text-success">You&apos;re live</div>
        <div className="mb-2.5 text-[15px] font-bold">/book/{slug}</div>
        <div className="mb-3.5 text-xs text-owner-muted">
          Drop this link in your Instagram bio, Peerspace profile, anywhere.
        </div>
        <CopyLinkButton slug={slug} />
      </div>

      <button type="submit" disabled={pending} className="rounded-[9px] bg-owner-accent px-5 py-3 text-sm font-bold text-[#0d0e14] disabled:opacity-60">
        {pending ? "Saving…" : "Save checklist & finish"}
      </button>
    </form>
  );
}
```

- [ ] **Step 6: Wire steps 2–5 into `app/(owner)/settings/page.tsx`**

Replace the `{step > 1 && ...}` placeholder block with:

```tsx
      {step === 2 && studio && (
        <Step2Rules
          initial={{
            alcoholPolicy: studio.alcoholPolicy ?? "byob_with_acknowledgment",
            vendorPolicy: studio.vendorPolicy ?? "pre_approval",
            noiseCurfew: studio.noiseCurfew ?? "",
            cleanupWindowMin: studio.cleanupWindowMin?.toString() ?? "",
          }}
        />
      )}
      {step === 3 && studio && (
        <Step3Pricing
          initial={{
            hourlyRate: studio.hourlyRateCents ? (studio.hourlyRateCents / 100).toString() : "",
            minHours: studio.minHours?.toString() ?? "",
            deposit: studio.depositCents ? (studio.depositCents / 100).toString() : "",
          }}
        />
      )}
      {step === 4 && studio && <Step4Contract studio={studio} spaces={spaces} />}
      {step === 5 && studio && (
        <Step5Checklist
          initial={checklist.map((c) => ({ name: c.name, hint: c.hint ?? "" }))}
          slug={studio.slug}
        />
      )}
```

Add the imports and delete the `void checklist;` line:

```tsx
import Step2Rules from "./_components/Step2Rules";
import Step3Pricing from "./_components/Step3Pricing";
import Step4Contract from "./_components/Step4Contract";
import Step5Checklist from "./_components/Step5Checklist";
```

- [ ] **Step 7: Gates + commit**

Run: `source ~/.nvm/nvm.sh && nvm use 20 && npm run lint && npm run typecheck && npm test && npm run build`
Expected: all pass.

```bash
git add "app/(owner)/settings" "app/(owner)/_components/CopyLinkButton.tsx"
git commit -m "feat: add wizard steps 2-5 — rules, pricing, contract summary, checklist + live card"
```

---

### Task 6: Dashboard empty state + landing CTA re-point

**Files:**
- Modify: `app/(owner)/dashboard/page.tsx`, `app/(marketing)/_components/Header.tsx`, `app/(marketing)/_components/Hero.tsx`, `app/(marketing)/_components/PricingCta.tsx`

**Interfaces:**
- Consumes: `getStudioByClerkUserId` (Task 1), `CopyLinkButton` (Task 5), Clerk `auth`.
- Produces: nothing new.

- [ ] **Step 1: Replace `app/(owner)/dashboard/page.tsx`**

```tsx
import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { getDb } from "@/lib/db";
import { getStudioByClerkUserId } from "@/lib/studio";
import CopyLinkButton from "@/app/(owner)/_components/CopyLinkButton";

export default async function Dashboard() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const studio = await getStudioByClerkUserId(getDb(), userId);
  if (!studio) redirect("/settings");

  return (
    <main className="mx-auto max-w-3xl">
      <h1 className="font-serif text-3xl">Dashboard</h1>
      <p className="mt-2 font-mono text-sm text-owner-muted">{studio.name}</p>

      <div className="mt-8 rounded-[11px] border border-[#1e4a2c] bg-[#101a12] p-8 text-center">
        <div className="mb-2 font-mono text-[9.5px] uppercase tracking-[.12em] text-success">
          Share your booking link
        </div>
        <div className="mb-2.5 text-lg font-bold">/book/{studio.slug}</div>
        <p className="mx-auto mb-4 max-w-sm text-xs leading-relaxed text-owner-muted">
          Booking requests will appear here when renters use your link. Drop it in your
          Instagram bio, Peerspace profile, anywhere.
        </p>
        <CopyLinkButton slug={studio.slug} />
      </div>

      <p className="mt-6 text-xs text-owner-muted">
        Rates, rules, or checklist changed?{" "}
        <Link href="/settings" className="text-owner-accent">Edit settings &amp; policies</Link>
      </p>
    </main>
  );
}
```

- [ ] **Step 2: Re-point the Header CTA (`Header.tsx`)**

Replace the `<a href="#waitlist">…</a>` element with:

```tsx
      <a
        href="/sign-up"
        className="rounded-lg bg-owner-text px-4 py-[9px] text-[12.5px] font-semibold text-owner-bg"
      >
        Get started free
      </a>
```

- [ ] **Step 3: Restore the Hero button pair (`Hero.tsx`)**

Remove the `WaitlistForm` import and replace `<WaitlistForm id="waitlist" />` with:

```tsx
      <div className="flex items-center gap-3">
        <a
          href="/sign-up"
          className="rounded-[9px] bg-owner-accent px-[22px] py-[13px] text-sm font-bold text-[#0d0e14]"
        >
          Get started free
        </a>
        <a
          href="#waitlist"
          className="rounded-[9px] border border-[#2c2d35] px-[22px] py-[13px] text-sm font-semibold text-owner-muted"
        >
          Join the waitlist
        </a>
      </div>
```

- [ ] **Step 4: Demote the waitlist in `PricingCta.tsx`**

Replace the file:

```tsx
import WaitlistForm from "./WaitlistForm";

export default function PricingCta() {
  return (
    <section className="mx-auto max-w-[520px] border-t border-[#1d1e24] pb-20 pt-14 text-center">
      <div className="mb-[10px] text-[32px] font-bold tracking-[-.02em]">$60/month. Flat.</div>
      <div className="mb-7 text-sm leading-[1.7] text-owner-muted">
        Cheaper than one undocumented damage dispute. First 60 days free for the first 10
        Atlanta studios — no card required.
      </div>
      <div className="mb-8 flex justify-center">
        <a
          href="/sign-up"
          className="rounded-[9px] bg-owner-accent px-8 py-[15px] text-[15px] font-bold text-[#0d0e14]"
        >
          Get started free
        </a>
      </div>
      <div className="border-t border-[#1d1e24] pt-6">
        <p className="mb-3 text-xs text-owner-muted">
          Not ready yet? Join the list and we&apos;ll check in.
        </p>
        <div className="flex justify-center">
          <WaitlistForm id="waitlist" />
        </div>
      </div>
    </section>
  );
}
```

(The Hero's secondary "Join the waitlist" button anchors to `#waitlist`, which now lives here.)

- [ ] **Step 5: Verify with the dev server**

Run dev server in background; then:
- `curl -s http://localhost:3000 | grep -c "/sign-up"` → expect ≥ 3 (header, hero, pricing).
- `curl -s http://localhost:3000 | grep -c 'id="waitlist"'` → expect 1 (pricing section only).
- `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/dashboard` → expect 307 (still gated).
Stop the server.

- [ ] **Step 6: Gates + commit**

Run: `source ~/.nvm/nvm.sh && nvm use 20 && npm run lint && npm run typecheck && npm test && npm run build`
Expected: all pass. Note: `/` stays static (`○`) — the landing has no new dynamic reads; `/dashboard` is `ƒ`.

```bash
git add "app/(owner)/dashboard/page.tsx" "app/(marketing)/_components/Header.tsx" "app/(marketing)/_components/Hero.tsx" "app/(marketing)/_components/PricingCta.tsx"
git commit -m "feat: dashboard share-link empty state; landing CTAs point to sign-up"
```

---

### Task 7: Final verification + PR

**Files:** none.

**Interfaces:** consumes everything above; produces the open PR.

- [ ] **Step 1: All four gates**

Run: `source ~/.nvm/nvm.sh && nvm use 20 && npm run lint && npm run typecheck && npm test && npm run build`
Expected: all pass; test count ≈ 119 + 27 new ≈ 146.

- [ ] **Step 2: Discipline checks**

```bash
grep -rn "update(bookings)\|insert(bookings)" --include="*.ts" --include="*.tsx" app lib | grep -v "lib/domain/transitions.ts"
git diff main --stat -- prototype/ "app/(public)" db/ drizzle/ lib/domain/ lib/tokens.ts scripts/seed.ts
```
Expected: no output from either.

- [ ] **Step 3: Push + PR**

```bash
git push -u origin feat/phase-3-onboarding-wizard
gh pr create --title "Phase 3: onboarding wizard, dashboard empty state, CTA re-point" --body "$(cat <<'EOF'
## Summary
- 5-step wizard at `/settings` (doubles as Settings & policies): profile+spaces, house rules, pricing & deposit-as-contract-term, computed contract clause summary + disclaimer, checklist editor + "You're live" card
- Per-step server actions over pure FormData parsers and PGlite-tested `lib/studio.ts` persistence (slug generated once, immutable; `onboarding_completed_at` set once)
- `proxy.ts` now protects `/settings(.*)` (closes the Phase 0 review carry-forward)
- Dashboard: no studio → redirect to wizard; studio → share-your-link empty state with copy button
- Landing CTAs → "Get started free" → `/sign-up`; waitlist demoted to secondary capture in pricing section
- Spec: `docs/specs/2026-07-05-venuedash-phase-3-onboarding-wizard-design.md` · Plan: `docs/plans/2026-07-05-venuedash-phase-3-onboarding-wizard.md`

## Test plan
- [ ] CI green (lint / typecheck / test / build)
- [ ] Preview: sign up fresh → redirected into wizard → walk all 5 steps → dashboard shows /book/[slug] card; copy button works
- [ ] Preview: revisit /settings — values pre-filled, steps navigable via dots
- [ ] Preview: /settings and /dashboard gated signed-out; landing CTAs land on sign-up; waitlist form still works in pricing section

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4: Exit criteria (spec §10)**

- [ ] Fresh owner: sign-up → wizard steps 1–5 → studio row complete, spaces, checklist, unique slug, `onboarding_completed_at` set.
- [ ] Wizard revisitable with pre-filled values; steps save independently.
- [ ] Dashboard empty state / redirect behavior correct.
- [ ] Landing CTAs re-pointed; waitlist still capturable.
- [ ] CI green with no secrets; protected paths untouched.

---

## Self-Review

**1. Spec coverage** (Phase 3 spec §3–§10):
- §3 routes/gating/data flow: `/settings` + `?step` clamp → Task 4; proxy matcher → Task 4 Step 1; one-studio-per-owner via `auth()` + `clerk_user_id` → actions (Task 4); per-step actions returning form state → Task 4; persistence DI in `lib/studio.ts` → Tasks 1–2; client islands only (Step1/2/5 forms + CopyLinkButton; Step 4 is a server component) → Tasks 4–5. ✓
- §4 five steps incl. copy rewrite (Task 5 Step 3 text), § 74-133 helper (Step2), no COI toggle / no claim-window line / no full-text link (Step4Contract has none), defaults seeded at creation (Task 1), "You're live" card + copy (Task 5). ✓
- §5 slug/completion semantics → Tasks 1–2 (tested: collision suffix, immutability on rename, set-once timestamp). ✓
- §6 dashboard + CTA re-point → Task 6. ✓
- §7 validation rules → Task 3 (bounds and enums exactly as spec'd; curfew ≤40, cleanup ≤720, minHours 1–24, items 1–20/60/120). ✓
- §8 testing → Tasks 1–3 (PGlite + pure); manual preview list → Task 7 PR body. ✓
- §9 out of scope: no `/book` page, no contract text, no COI, no availability, no booking list — nothing in the plan builds them. ✓
- §10 exit criteria → Task 7 Step 4. ✓

**2. Placeholder scan:** all code steps contain complete code; commands have expected outputs. The Task 4 page's `{step > 1}` placeholder text is explicitly temporary and replaced in Task 5 Step 6 (an intra-plan handoff, not a TBD). ✓

**3. Type consistency:** `WizardFormState`/`WIZARD_IDLE` (Task 4) used by Step components (Task 5); FormData field names in Task 5 markup match Task 3 parsers (`spaceName`/`spaceCap`, `alcoholPolicy`, `vendorPolicy`, `noiseCurfew`, `cleanupWindowMin`, `hourlyRate`/`minHours`/`deposit`, `itemName`/`itemHint`); `createStudio`/`updateProfile`/etc. signatures match between Tasks 1–2 impl/tests and Task 4 actions; `CopyLinkButton({ slug })` matches uses in Tasks 5–6; `Space`/`Studio` types re-exported from `lib/studio.ts` and consumed by Step1/Step4. `deriveEffectiveState`/domain modules untouched. ✓

**Known judgment calls:** (a) actions are deliberately untested glue (auth+parse+persist+redirect) — every branch inside them is covered at the parser or persistence layer; (b) `uniqueSlug` passes the transaction handle with an `as unknown as Db` cast (tx is structurally compatible for the builder methods used); if typecheck rejects it, query the slugs before opening the transaction instead — behavior is identical at this concurrency level; (c) step-4 "Continue" is a plain link (no action) since the step persists nothing.
