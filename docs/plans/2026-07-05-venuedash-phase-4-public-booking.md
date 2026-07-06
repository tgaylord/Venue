# VenueDash Phase 4 — Public Booking Page + Intake — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the live `/book/[slug]` link into a working, account-free renter mini-site that creates a `pending` booking with snapshotted terms, emails the owner + a durable status link to the renter, and shows that status at `/status/[token]`.

**Architecture:** Server components under the `(public)` route group load a studio by slug (gated on `onboarding_completed_at`) and its availability, then hand a serializable view-model to one client component that owns the page → intake → review step state. Only the final submit calls a `"use server"` action → `createBooking` (plain insert; `pending` is the genesis state) → `redirect("/status/<token>")`. Pure helpers (`lib/tz`, `lib/availability`, `lib/money`) are TDD'd with vitest; DB functions are PGlite-tested; the two surfaces are verified by rendering.

**Tech Stack:** Next.js 16 (App Router) · React 19 · Tailwind v4 (`@theme` tokens) · Drizzle + Neon (websocket Pool) · Clerk 7 (owner-email lookup) · Resend + React Email · vitest + PGlite.

**Source spec:** `docs/specs/2026-07-05-venuedash-phase-4-public-booking-design.md`

## Global Constraints

Every task's requirements implicitly include these (verbatim from spec + CLAUDE.md):

- **Node 20 only** — run all `npm`/`npx` commands under `nvm use 20` (default shell Node is 24; engine-strict rejects it).
- **DB handle first param** — every DB-touching function takes the Drizzle `Db` (`import type { Db } from "@/lib/domain/transitions"`) as its first parameter; PGlite tests inject `createTestDb()` from `@/lib/domain/test-db`, which applies the real generated migrations in `drizzle/`.
- **State discipline** — no code writes `bookings.state` except `transitionBooking`. `createBooking` inserts with the schema default (`pending`); this genesis insert is the sanctioned creation path and writes **no** `booking_events` row.
- **Snapshot discipline** — copy rate/deposit/policies onto the booking at request time; never re-join studio settings for legal fields later.
- **`"use server"` files export only async functions** — constants/types live in a plain module (`forms.ts`), or a `const` reaches client components as a broken server-reference and crashes at render.
- **Timezone** — America/New_York hardcoded (Atlanta-only market).
- **Renter surface** — warm-light tokens only (`renter-bg #f7f5f0`, `renter-ink #211f1a`, `renter-border #ddd7c6`, `renter-ok #4d7c4a`); `font-serif` (Instrument Serif) for display, `font-mono` (IBM Plex Mono) for metadata labels; mobile-first. Where a prototype hex has no token, use an arbitrary Tailwind value matching the prototype.
- **Copy discipline (v0.5 truth)** — deposit is *"a refundable damage deposit you arrange directly with the studio"*; never "held securely / escrow / auto-refunded / upload insurance / pay deposit". "Timestamped documentation," never "immutable evidence."
- **Shared input class** — never put a width utility (`w-full`) in a class reused by flex-row items (it overrides `flex-1`/fixed widths — shipped as a bug once).
- **Commits** — end every commit message with:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

## File Structure

**New (created by this plan):**
- `lib/tz.ts` — Atlanta wall-clock ↔ UTC + Atlanta display formatting.
- `lib/availability.ts` — pure interval math (overlap, conflict, selectable start hours).
- `lib/booking.ts` — `createBooking` (insert + snapshot + token) and `getBusyIntervals` query.
- `app/(public)/book/[slug]/page.tsx` — server component: load + gate + build view-model.
- `app/(public)/book/[slug]/forms.ts` — pure intake FormData parser + shared constants/types.
- `app/(public)/book/[slug]/actions.ts` — `"use server"` submit.
- `app/(public)/book/[slug]/_components/BookingFlow.tsx` — client step component.
- `app/(public)/status/[token]/page.tsx` — renter status page.
- `emails/OwnerBookingRequest.tsx`, `emails/RenterRequestReceived.tsx` — React Email templates.
- Tests: `lib/tz.test.ts`, `lib/availability.test.ts`, `lib/booking.test.ts`, `lib/money.test.ts` (extend), `lib/studio.test.ts` (extend), `app/(public)/book/[slug]/forms.test.ts`, `lib/email.test.ts` (extend).

**Modified:**
- `lib/money.ts` — add `formatCents`.
- `lib/studio.ts` — add `getStudioBySlug`.
- `lib/email.ts` — add `renderOwnerBookingRequest`, `renderRenterRequestReceived`.

**Deleted:**
- `app/(public)/status/page.tsx` — placeholder replaced by the `[token]` route.

---

## Task 1: `lib/tz.ts` — Atlanta wall-clock ↔ UTC + display

**Files:**
- Create: `lib/tz.ts`
- Test: `lib/tz.test.ts`

**Interfaces:**
- Consumes: nothing (pure, `Intl` only).
- Produces:
  - `atlantaSlotToUtc(dateISO: string, startHour: number, durationHours: number): { startsAt: Date; endsAt: Date }` — `dateISO` is `"YYYY-MM-DD"`; interprets `startHour`..`startHour+durationHours` as Atlanta wall-clock, returns UTC `Date`s.
  - `formatAtlantaRange(startsAt: Date, endsAt: Date): string` — e.g. `"Sat, Jul 18, 6:00 PM – 10:00 PM"`.

- [ ] **Step 1: Write the failing test**

```ts
// lib/tz.test.ts
import { describe, it, expect } from "vitest";
import { atlantaSlotToUtc, formatAtlantaRange } from "@/lib/tz";

describe("atlantaSlotToUtc", () => {
  it("converts a summer (EDT, UTC-4) evening slot to UTC", () => {
    const { startsAt, endsAt } = atlantaSlotToUtc("2026-07-18", 18, 4);
    expect(startsAt.toISOString()).toBe("2026-07-18T22:00:00.000Z"); // 6 PM EDT
    expect(endsAt.toISOString()).toBe("2026-07-19T02:00:00.000Z"); // 10 PM EDT
  });

  it("converts a winter (EST, UTC-5) evening slot to UTC", () => {
    const { startsAt, endsAt } = atlantaSlotToUtc("2026-01-10", 18, 3);
    expect(startsAt.toISOString()).toBe("2026-01-10T23:00:00.000Z"); // 6 PM EST
    expect(endsAt.toISOString()).toBe("2026-01-11T02:00:00.000Z"); // 9 PM EST
  });
});

describe("formatAtlantaRange", () => {
  it("renders the stored UTC instants back as Atlanta wall-clock", () => {
    const s = new Date("2026-07-18T22:00:00.000Z");
    const e = new Date("2026-07-19T02:00:00.000Z");
    expect(formatAtlantaRange(s, e)).toBe("Sat, Jul 18, 6:00 PM – 10:00 PM");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `nvm use 20 && npx vitest run lib/tz.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/tz"`.

- [ ] **Step 3: Write the implementation**

```ts
// lib/tz.ts
const TZ = "America/New_York";

/** Timezone offset (minutes east of UTC, negative for the Americas) at a UTC instant. */
function offsetMinutes(utc: Date): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const p = Object.fromEntries(dtf.formatToParts(utc).map((x) => [x.type, x.value]));
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return (asUTC - utc.getTime()) / 60000;
}

/** Interpret y-mo-d-h-min as America/New_York wall-clock; return the matching UTC Date. */
function atlantaWallClockToUtc(y: number, mo: number, d: number, h: number, min: number): Date {
  const guess = Date.UTC(y, mo - 1, d, h, min); // pretend wall-clock is UTC
  const off = offsetMinutes(new Date(guess)); // offset near that instant
  return new Date(guess - off * 60000); // utc = wallclock - offset
}

export function atlantaSlotToUtc(
  dateISO: string, startHour: number, durationHours: number
): { startsAt: Date; endsAt: Date } {
  const [y, mo, d] = dateISO.split("-").map(Number);
  // Hour overflow (e.g. 20 + 6 = 26) rolls into the next day via Date.UTC.
  return {
    startsAt: atlantaWallClockToUtc(y, mo, d, startHour, 0),
    endsAt: atlantaWallClockToUtc(y, mo, d, startHour + durationHours, 0),
  };
}

export function formatAtlantaRange(startsAt: Date, endsAt: Date): string {
  const day = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, weekday: "short", month: "short", day: "numeric",
  }).format(startsAt);
  const t = (dt: Date) =>
    new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" }).format(dt);
  return `${day}, ${t(startsAt)} – ${t(endsAt)}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `nvm use 20 && npx vitest run lib/tz.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/tz.ts lib/tz.test.ts
git commit -m "feat: Atlanta wall-clock <-> UTC tz helper (DST-aware)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `lib/availability.ts` — pure interval math

**Files:**
- Create: `lib/availability.ts`
- Test: `lib/availability.test.ts`

**Interfaces:**
- Consumes: `atlantaSlotToUtc` from `@/lib/tz` (Task 1).
- Produces:
  - `type Interval = { startsAt: Date; endsAt: Date }`
  - `overlaps(a: Interval, b: Interval): boolean`
  - `hasConflict(candidate: Interval, busy: Interval[]): boolean`
  - `availableStartHours(dateISO: string, startHours: number[], minHours: number, busy: Interval[]): number[]` — the start hours where a `minHours`-long booking would not overlap any busy interval.

- [ ] **Step 1: Write the failing test**

```ts
// lib/availability.test.ts
import { describe, it, expect } from "vitest";
import { overlaps, hasConflict, availableStartHours, type Interval } from "@/lib/availability";

const iv = (s: string, e: string): Interval => ({ startsAt: new Date(s), endsAt: new Date(e) });

describe("overlaps", () => {
  it("is true for touching-in-the-middle intervals", () => {
    expect(overlaps(iv("2026-07-18T22:00Z", "2026-07-19T02:00Z"), iv("2026-07-19T00:00Z", "2026-07-19T03:00Z"))).toBe(true);
  });
  it("is false for back-to-back intervals (end == start)", () => {
    expect(overlaps(iv("2026-07-18T22:00Z", "2026-07-19T00:00Z"), iv("2026-07-19T00:00Z", "2026-07-19T02:00Z"))).toBe(false);
  });
});

describe("hasConflict", () => {
  it("detects a candidate overlapping any busy interval", () => {
    const busy = [iv("2026-07-18T22:00Z", "2026-07-19T02:00Z")];
    expect(hasConflict(iv("2026-07-19T01:00Z", "2026-07-19T04:00Z"), busy)).toBe(true);
    expect(hasConflict(iv("2026-07-19T02:00Z", "2026-07-19T05:00Z"), busy)).toBe(false);
  });
});

describe("availableStartHours", () => {
  it("removes start hours whose minHours booking would collide with a busy interval", () => {
    // Existing booking 6-10 PM EDT on 2026-07-18 => 22:00Z..02:00Z next day.
    const busy = [iv("2026-07-18T22:00Z", "2026-07-19T02:00Z")];
    const hours = availableStartHours("2026-07-18", [16, 17, 18, 19, 20, 21], 3, busy);
    // 3-hr bookings starting 16,17,18,19,20 all touch the 18-22(local) window; 21 (9 PM+3h) is after end? 21..24 local = 01:00Z..04:00Z, overlaps until 02:00Z -> still conflicts.
    expect(hours).toEqual([]); // every 3h slot in this range overlaps the evening booking
  });
  it("keeps all hours when there is no busy interval", () => {
    expect(availableStartHours("2026-07-18", [10, 14, 18], 3, [])).toEqual([10, 14, 18]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `nvm use 20 && npx vitest run lib/availability.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/availability"`.

- [ ] **Step 3: Write the implementation**

```ts
// lib/availability.ts
import { atlantaSlotToUtc } from "@/lib/tz";

export type Interval = { startsAt: Date; endsAt: Date };

/** Half-open overlap: shared interior time, but back-to-back (end == start) does not count. */
export function overlaps(a: Interval, b: Interval): boolean {
  return a.startsAt.getTime() < b.endsAt.getTime() && b.startsAt.getTime() < a.endsAt.getTime();
}

export function hasConflict(candidate: Interval, busy: Interval[]): boolean {
  return busy.some((b) => overlaps(candidate, b));
}

export function availableStartHours(
  dateISO: string, startHours: number[], minHours: number, busy: Interval[]
): number[] {
  return startHours.filter((h) => !hasConflict(atlantaSlotToUtc(dateISO, h, minHours), busy));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `nvm use 20 && npx vitest run lib/availability.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/availability.ts lib/availability.test.ts
git commit -m "feat: pure availability interval math (overlap/conflict/start-hours)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: `formatCents` + `getStudioBySlug`

**Files:**
- Modify: `lib/money.ts`
- Modify: `lib/studio.ts`
- Test: `lib/money.test.ts` (extend), `lib/studio.test.ts` (extend)

**Interfaces:**
- Produces:
  - `formatCents(cents: number): string` — `66000 → "$660"`, `66050 → "$660.50"`.
  - `getStudioBySlug(db: Db, slug: string): Promise<Studio | undefined>`

- [ ] **Step 1: Write the failing tests**

Append to `lib/money.test.ts`:

```ts
import { formatCents } from "@/lib/money";

describe("formatCents", () => {
  it("drops cents when whole dollars", () => {
    expect(formatCents(66000)).toBe("$660");
  });
  it("shows two decimals when needed", () => {
    expect(formatCents(66050)).toBe("$660.50");
  });
});
```

Append to `lib/studio.test.ts` (follow the existing `createTestDb` setup in that file):

```ts
import { getStudioBySlug } from "@/lib/studio";

describe("getStudioBySlug", () => {
  it("returns the studio for a known slug and undefined otherwise", async () => {
    const { db, close } = await createTestDb();
    await db.insert(studios).values({ clerkUserId: "slug-u", name: "Slug Studio", slug: "slug-studio" });
    expect((await getStudioBySlug(db, "slug-studio"))?.name).toBe("Slug Studio");
    expect(await getStudioBySlug(db, "nope")).toBeUndefined();
    await close();
  });
});
```

> Note: if `lib/studio.test.ts` does not already import `createTestDb`/`studios`, add those imports at the top.

- [ ] **Step 2: Run tests to verify they fail**

Run: `nvm use 20 && npx vitest run lib/money.test.ts lib/studio.test.ts`
Expected: FAIL — `formatCents`/`getStudioBySlug` not exported.

- [ ] **Step 3: Write the implementations**

Append to `lib/money.ts`:

```ts
/** Format integer cents as USD for display: 66000 -> "$660", 66050 -> "$660.50". */
export function formatCents(cents: number): string {
  const dollars = cents / 100;
  return Number.isInteger(dollars) ? `$${dollars}` : `$${dollars.toFixed(2)}`;
}
```

Add to `lib/studio.ts` (next to `getStudioByClerkUserId`):

```ts
export async function getStudioBySlug(db: Db, slug: string): Promise<Studio | undefined> {
  const [row] = await db.select().from(studios).where(eq(studios.slug, slug));
  return row;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `nvm use 20 && npx vitest run lib/money.test.ts lib/studio.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/money.ts lib/money.test.ts lib/studio.ts lib/studio.test.ts
git commit -m "feat: formatCents display helper + getStudioBySlug

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: `lib/booking.ts` — `createBooking` + `getBusyIntervals`

**Files:**
- Create: `lib/booking.ts`
- Test: `lib/booking.test.ts`

**Interfaces:**
- Consumes: `Db` (`@/lib/domain/transitions`), `mintRenterToken` (`@/lib/tokens`), `TERMINAL_STATES` (`@/lib/domain/states`), `Interval` (`@/lib/availability`), schema tables.
- Produces:
  - `type TermsSnapshot = { hourlyRateCents: number | null; minHours: number | null; cancellationLadder: unknown; alcoholPolicy: string | null; vendorPolicy: string | null; noiseCurfew: string | null; cleanupWindowMin: number | null; maxOccupancy: number | null }`
  - `type CreateBookingInput = { studioId: string; renterName: string; renterEmail: string; renterPhone: string | null; eventType: string; headcount: number; byob: boolean; outsideVendors: boolean; notes: string | null; startsAt: Date; endsAt: Date; depositCents: number | null; termsSnapshot: TermsSnapshot }`
  - `createBooking(db: Db, input: CreateBookingInput): Promise<{ booking: Booking; statusToken: string }>` — inserts a `pending` booking, snapshots terms into `rateSnapshot`, mints a `purpose="status"` token (120-day expiry), writes NO `booking_events` row. Returns the raw token.
  - `getBusyIntervals(db: Db, studioId: string, from: Date, to: Date): Promise<Interval[]>` — non-terminal bookings + all availability blocks overlapping `[from, to)`.

- [ ] **Step 1: Write the failing test**

```ts
// lib/booking.test.ts
import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "@/lib/domain/test-db";
import { studios, bookings, bookingEvents, renterTokens } from "@/db/schema";
import { createBooking, getBusyIntervals, type TermsSnapshot } from "@/lib/booking";
import { verifyRenterToken } from "@/lib/tokens";
import { transitionBooking } from "@/lib/domain/transitions";

const TERMS: TermsSnapshot = {
  hourlyRateCents: 16500, minHours: 3, cancellationLadder: { full: 30, half: 14, none: 0 },
  alcoholPolicy: "byob_with_acknowledgment", vendorPolicy: "pre_approval",
  noiseCurfew: "22:00", cleanupWindowMin: 60, maxOccupancy: 40,
};

async function seedStudio(db: TestDb): Promise<string> {
  const [s] = await db.insert(studios).values({
    clerkUserId: "book-u", name: "Book Studio", slug: "book-studio", depositCents: 40000,
    onboardingCompletedAt: new Date(),
  }).returning();
  return s.id;
}

const input = (studioId: string) => ({
  studioId, renterName: "Maya Reeves", renterEmail: "maya@x.com", renterPhone: null,
  eventType: "Birthday celebration", headcount: 25, byob: true, outsideVendors: false, notes: "Balloon arch",
  startsAt: new Date("2026-07-18T22:00:00Z"), endsAt: new Date("2026-07-19T02:00:00Z"),
  depositCents: 40000, termsSnapshot: TERMS,
});

describe("createBooking", () => {
  it("inserts a pending booking with the terms snapshot and a status token", async () => {
    const { db, close } = await createTestDb();
    const studioId = await seedStudio(db);
    const { booking, statusToken } = await createBooking(db, input(studioId));

    expect(booking.state).toBe("pending");
    expect(booking.depositCents).toBe(40000);
    expect(booking.rateSnapshot).toEqual(TERMS);
    expect(await verifyRenterToken(db, statusToken, "status")).toBe(booking.id);
    await close();
  });

  it("writes NO booking_events row on creation (pending is genesis)", async () => {
    const { db, close } = await createTestDb();
    const studioId = await seedStudio(db);
    const { booking } = await createBooking(db, input(studioId));
    const events = await db.select().from(bookingEvents).where(eq(bookingEvents.bookingId, booking.id));
    expect(events).toHaveLength(0);
    await close();
  });
});

describe("getBusyIntervals", () => {
  it("includes non-terminal bookings and excludes declined/canceled", async () => {
    const { db, close } = await createTestDb();
    const studioId = await seedStudio(db);
    const { booking: live } = await createBooking(db, input(studioId));
    const { booking: dead } = await createBooking(db, {
      ...input(studioId),
      startsAt: new Date("2026-07-20T22:00:00Z"), endsAt: new Date("2026-07-21T02:00:00Z"),
    });
    await transitionBooking(db, dead.id, "declined", { type: "owner" });

    const busy = await getBusyIntervals(db, studioId, new Date("2026-07-01T00:00Z"), new Date("2026-08-01T00:00Z"));
    expect(busy).toHaveLength(1);
    expect(busy[0].startsAt.toISOString()).toBe(live.startsAt.toISOString());
    await close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `nvm use 20 && npx vitest run lib/booking.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/booking"`.

- [ ] **Step 3: Write the implementation**

```ts
// lib/booking.ts
import { and, eq, gt, lt, notInArray } from "drizzle-orm";
import { bookings, availabilityBlocks, type Booking } from "@/db/schema";
import type { Db } from "@/lib/domain/transitions";
import { mintRenterToken } from "@/lib/tokens";
import { TERMINAL_STATES } from "@/lib/domain/states";
import type { Interval } from "@/lib/availability";

const STATUS_TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 120; // 120 days

export type TermsSnapshot = {
  hourlyRateCents: number | null;
  minHours: number | null;
  cancellationLadder: unknown;
  alcoholPolicy: string | null;
  vendorPolicy: string | null;
  noiseCurfew: string | null;
  cleanupWindowMin: number | null;
  maxOccupancy: number | null;
};

export type CreateBookingInput = {
  studioId: string;
  renterName: string;
  renterEmail: string;
  renterPhone: string | null;
  eventType: string;
  headcount: number;
  byob: boolean;
  outsideVendors: boolean;
  notes: string | null;
  startsAt: Date;
  endsAt: Date;
  depositCents: number | null;
  termsSnapshot: TermsSnapshot;
};

/**
 * The sanctioned creation path for a booking. `pending` is the genesis state
 * (schema default) — this is a plain insert, NOT a transition, and writes no
 * booking_events row. Terms are snapshotted onto rateSnapshot at request time.
 */
export async function createBooking(
  db: Db, input: CreateBookingInput
): Promise<{ booking: Booking; statusToken: string }> {
  const [booking] = await db.insert(bookings).values({
    studioId: input.studioId,
    renterName: input.renterName,
    renterEmail: input.renterEmail,
    renterPhone: input.renterPhone,
    eventType: input.eventType,
    headcount: input.headcount,
    byob: input.byob,
    outsideVendors: input.outsideVendors,
    notes: input.notes,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    depositCents: input.depositCents,
    rateSnapshot: input.termsSnapshot,
  }).returning();

  const statusToken = await mintRenterToken(db, booking.id, "status", new Date(Date.now() + STATUS_TOKEN_TTL_MS));
  return { booking, statusToken };
}

/** Non-terminal bookings + all availability blocks overlapping [from, to). */
export async function getBusyIntervals(
  db: Db, studioId: string, from: Date, to: Date
): Promise<Interval[]> {
  const b = await db.select({ startsAt: bookings.startsAt, endsAt: bookings.endsAt })
    .from(bookings)
    .where(and(
      eq(bookings.studioId, studioId),
      notInArray(bookings.state, [...TERMINAL_STATES]),
      lt(bookings.startsAt, to),
      gt(bookings.endsAt, from),
    ));
  const a = await db.select({ startsAt: availabilityBlocks.startsAt, endsAt: availabilityBlocks.endsAt })
    .from(availabilityBlocks)
    .where(and(
      eq(availabilityBlocks.studioId, studioId),
      lt(availabilityBlocks.startsAt, to),
      gt(availabilityBlocks.endsAt, from),
    ));
  return [...b, ...a];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `nvm use 20 && npx vitest run lib/booking.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/booking.ts lib/booking.test.ts
git commit -m "feat: createBooking (genesis insert + snapshot + token) and getBusyIntervals

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: `book/[slug]/forms.ts` — intake parser + shared constants

**Files:**
- Create: `app/(public)/book/[slug]/forms.ts`
- Test: `app/(public)/book/[slug]/forms.test.ts`

**Interfaces:**
- Produces:
  - `EVENT_TYPES: readonly string[]` — the intake `<select>` options.
  - `START_HOURS: number[]` (`[10..21]`) and `DURATION_OPTIONS: number[]` (`[2..12]`) — picker ranges (the action floors duration at studio `minHours`).
  - `type BookFormState = { status: "idle" | "error"; error: string }` and `BOOK_IDLE: BookFormState`.
  - `type ParsedIntake = { renterName: string; renterEmail: string; renterPhone: string | null; eventType: string; headcount: number; byob: boolean; outsideVendors: boolean; notes: string | null; dateISO: string; startHour: number; durationHours: number }`
  - `parseIntake(fd: FormData): { ok: true; data: ParsedIntake } | { ok: false; error: string }` — structural validation only (business rules — minHours, conflict, onboarding — live in the action).

- [ ] **Step 1: Write the failing test**

```ts
// app/(public)/book/[slug]/forms.test.ts
import { describe, it, expect } from "vitest";
import { parseIntake } from "./forms";

function fd(overrides: Record<string, string> = {}): FormData {
  const base: Record<string, string> = {
    renterName: "Maya Reeves", renterEmail: "maya@x.com", renterPhone: "",
    eventType: "Birthday celebration", headcount: "25",
    byob: "on", outsideVendors: "", notes: "Balloon arch",
    dateISO: "2026-07-18", startHour: "18", durationHours: "4",
  };
  const f = new FormData();
  for (const [k, v] of Object.entries({ ...base, ...overrides })) f.set(k, v);
  return f;
}

describe("parseIntake", () => {
  it("parses a valid submission", () => {
    const r = parseIntake(fd());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data).toMatchObject({
        renterName: "Maya Reeves", renterEmail: "maya@x.com", renterPhone: null,
        eventType: "Birthday celebration", headcount: 25, byob: true, outsideVendors: false,
        notes: "Balloon arch", dateISO: "2026-07-18", startHour: 18, durationHours: 4,
      });
    }
  });
  it("rejects a missing name", () => {
    const r = parseIntake(fd({ renterName: "  " }));
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/name/i) });
  });
  it("rejects a malformed email", () => {
    expect(parseIntake(fd({ renterEmail: "nope" })).ok).toBe(false);
  });
  it("rejects a non-positive headcount", () => {
    expect(parseIntake(fd({ headcount: "0" })).ok).toBe(false);
  });
  it("rejects an unknown event type", () => {
    expect(parseIntake(fd({ eventType: "Wedding at the beach" })).ok).toBe(false);
  });
  it("rejects a malformed date", () => {
    expect(parseIntake(fd({ dateISO: "07/18/2026" })).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `nvm use 20 && npx vitest run "app/(public)/book/[slug]/forms.test.ts"`
Expected: FAIL — cannot resolve `./forms`.

- [ ] **Step 3: Write the implementation**

```ts
// app/(public)/book/[slug]/forms.ts
export const EVENT_TYPES = [
  "Birthday celebration",
  "Baby or bridal shower",
  "Listening session / release party",
  "Brand event / pop-up",
  "Creative production with guests",
  "Other private event",
] as const;

export const START_HOURS = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21];
export const DURATION_OPTIONS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

export type BookFormState = { status: "idle" | "error"; error: string };
export const BOOK_IDLE: BookFormState = { status: "idle", error: "" };

export type ParsedIntake = {
  renterName: string;
  renterEmail: string;
  renterPhone: string | null;
  eventType: string;
  headcount: number;
  byob: boolean;
  outsideVendors: boolean;
  notes: string | null;
  dateISO: string;
  startHour: number;
  durationHours: number;
};

const str = (fd: FormData, key: string) => String(fd.get(key) ?? "").trim();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function parseIntake(
  fd: FormData
): { ok: true; data: ParsedIntake } | { ok: false; error: string } {
  const renterName = str(fd, "renterName");
  if (!renterName) return { ok: false, error: "Please add your name." };

  const renterEmail = str(fd, "renterEmail").toLowerCase();
  if (!EMAIL_RE.test(renterEmail)) return { ok: false, error: "That doesn't look like an email address." };

  const eventType = str(fd, "eventType");
  if (!(EVENT_TYPES as readonly string[]).includes(eventType)) return { ok: false, error: "Pick an event type." };

  const headRaw = str(fd, "headcount");
  const headcount = parseInt(headRaw, 10);
  if (!/^\d+$/.test(headRaw) || headcount < 1) return { ok: false, error: "Enter an estimated headcount." };

  const dateISO = str(fd, "dateISO");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateISO)) return { ok: false, error: "Pick a date." };

  const startRaw = str(fd, "startHour");
  const startHour = parseInt(startRaw, 10);
  if (!(START_HOURS as number[]).includes(startHour)) return { ok: false, error: "Pick a start time." };

  const durRaw = str(fd, "durationHours");
  const durationHours = parseInt(durRaw, 10);
  if (!(DURATION_OPTIONS as number[]).includes(durationHours)) return { ok: false, error: "Pick a duration." };

  const phone = str(fd, "renterPhone");
  const notes = str(fd, "notes");
  return {
    ok: true,
    data: {
      renterName, renterEmail, renterPhone: phone || null,
      eventType, headcount,
      byob: str(fd, "byob") === "on",
      outsideVendors: str(fd, "outsideVendors") === "on",
      notes: notes || null,
      dateISO, startHour, durationHours,
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `nvm use 20 && npx vitest run "app/(public)/book/[slug]/forms.test.ts"`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add "app/(public)/book/[slug]/forms.ts" "app/(public)/book/[slug]/forms.test.ts"
git commit -m "feat: renter intake FormData parser + picker constants

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Email templates + render helpers

**Files:**
- Create: `emails/OwnerBookingRequest.tsx`, `emails/RenterRequestReceived.tsx`
- Modify: `lib/email.ts`
- Test: `lib/email.test.ts` (extend)

**Interfaces:**
- Consumes: `formatAtlantaRange` (`@/lib/tz`), `render` (`@react-email/render`).
- Produces (in `lib/email.ts`):
  - `type OwnerBookingEmail = { studioName: string; renterName: string; eventType: string; when: string; headcount: number; byob: boolean; outsideVendors: boolean; notes: string | null; dashboardUrl: string }`
  - `renderOwnerBookingRequest(props: OwnerBookingEmail): Promise<string>`
  - `type RenterReceivedEmail = { studioName: string; when: string; statusUrl: string }`
  - `renderRenterRequestReceived(props: RenterReceivedEmail): Promise<string>`

- [ ] **Step 1: Write the failing test**

Append to `lib/email.test.ts` (follow existing imports/structure):

```ts
import { renderOwnerBookingRequest, renderRenterRequestReceived } from "@/lib/email";

describe("booking emails", () => {
  it("owner email includes renter, event, and dashboard link", async () => {
    const html = await renderOwnerBookingRequest({
      studioName: "Westview Studio", renterName: "Maya Reeves", eventType: "Birthday celebration",
      when: "Sat, Jul 18, 6:00 PM – 10:00 PM", headcount: 25, byob: true, outsideVendors: false,
      notes: "Balloon arch", dashboardUrl: "https://venuedash.example/dashboard",
    });
    expect(html).toContain("Maya Reeves");
    expect(html).toContain("Birthday celebration");
    expect(html).toContain("https://venuedash.example/dashboard");
  });

  it("renter email includes the status link and studio name", async () => {
    const html = await renderRenterRequestReceived({
      studioName: "Westview Studio", when: "Sat, Jul 18, 6:00 PM – 10:00 PM",
      statusUrl: "https://venuedash.example/status/abc",
    });
    expect(html).toContain("Westview Studio");
    expect(html).toContain("https://venuedash.example/status/abc");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `nvm use 20 && npx vitest run lib/email.test.ts`
Expected: FAIL — render helpers not exported.

- [ ] **Step 3: Write the templates and helpers**

```tsx
// emails/OwnerBookingRequest.tsx
import { Html, Body, Container, Heading, Text, Link, Hr } from "@react-email/components";

export type OwnerBookingEmailProps = {
  studioName: string; renterName: string; eventType: string; when: string;
  headcount: number; byob: boolean; outsideVendors: boolean; notes: string | null; dashboardUrl: string;
};

export default function OwnerBookingRequest(p: OwnerBookingEmailProps) {
  return (
    <Html>
      <Body style={{ fontFamily: "sans-serif", backgroundColor: "#0b0c0f", color: "#e9eaee" }}>
        <Container style={{ padding: 24, maxWidth: 520 }}>
          <Heading style={{ fontSize: 20 }}>New booking request</Heading>
          <Text style={{ color: "#9a9ca8", marginTop: 0 }}>
            {p.renterName} wants to book {p.studioName}.
          </Text>
          <Hr style={{ borderColor: "#26272e" }} />
          <Text style={{ lineHeight: 1.8 }}>
            <strong>{p.when}</strong><br />
            {p.eventType} · {p.headcount} guests<br />
            BYOB: {p.byob ? "yes" : "no"} · Outside vendors: {p.outsideVendors ? "yes" : "no"}
          </Text>
          {p.notes ? <Text style={{ color: "#9a9ca8" }}>“{p.notes}”</Text> : null}
          <Link
            href={p.dashboardUrl}
            style={{ display: "inline-block", background: "#7a86ff", color: "#0d0e14", fontWeight: 700, padding: "10px 18px", borderRadius: 8, textDecoration: "none" }}
          >
            Open your dashboard
          </Link>
        </Container>
      </Body>
    </Html>
  );
}
```

```tsx
// emails/RenterRequestReceived.tsx
import { Html, Body, Container, Heading, Text, Link } from "@react-email/components";

export type RenterReceivedEmailProps = { studioName: string; when: string; statusUrl: string };

export default function RenterRequestReceived(p: RenterReceivedEmailProps) {
  return (
    <Html>
      <Body style={{ fontFamily: "sans-serif", backgroundColor: "#f7f5f0", color: "#211f1a" }}>
        <Container style={{ padding: 24, maxWidth: 520 }}>
          <Heading style={{ fontSize: 22, fontFamily: "Georgia, serif" }}>Request sent</Heading>
          <Text style={{ lineHeight: 1.7 }}>
            Thanks — {p.studioName} usually responds within 24 hours. We’ll email you the moment they do; no account needed.
          </Text>
          <Text style={{ color: "#8a867c" }}>Your event: {p.when}</Text>
          <Link
            href={p.statusUrl}
            style={{ display: "inline-block", background: "#211f1a", color: "#f7f5f0", fontWeight: 700, padding: "12px 20px", borderRadius: 10, textDecoration: "none" }}
          >
            View your request status
          </Link>
        </Container>
      </Body>
    </Html>
  );
}
```

Append to `lib/email.ts`:

```ts
import OwnerBookingRequest, { type OwnerBookingEmailProps } from "@/emails/OwnerBookingRequest";
import RenterRequestReceived, { type RenterReceivedEmailProps } from "@/emails/RenterRequestReceived";

export type OwnerBookingEmail = OwnerBookingEmailProps;
export type RenterReceivedEmail = RenterReceivedEmailProps;

export async function renderOwnerBookingRequest(props: OwnerBookingEmail): Promise<string> {
  return render(OwnerBookingRequest(props));
}

export async function renderRenterRequestReceived(props: RenterReceivedEmail): Promise<string> {
  return render(RenterRequestReceived(props));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `nvm use 20 && npx vitest run lib/email.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add emails/OwnerBookingRequest.tsx emails/RenterRequestReceived.tsx lib/email.ts lib/email.test.ts
git commit -m "feat: owner-notification + renter-status React Email templates

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: `book/[slug]/actions.ts` — submit action

**Files:**
- Create: `app/(public)/book/[slug]/actions.ts`

**Interfaces:**
- Consumes: `parseIntake`, `BookFormState` (`./forms`); `getStudioBySlug` (`@/lib/studio`); `getSpacesForStudio` (`@/lib/studio`); `createBooking`, `getBusyIntervals`, `TermsSnapshot` (`@/lib/booking`); `hasConflict` (`@/lib/availability`); `atlantaSlotToUtc`, `formatAtlantaRange` (`@/lib/tz`); `sendEmail`, `renderOwnerBookingRequest`, `renderRenterRequestReceived` (`@/lib/email`); `clerkClient` (`@clerk/nextjs/server`); `getDb` (`@/lib/db`); `redirect` (`next/navigation`).
- Produces: `submitBooking(slug: string, _prev: BookFormState, fd: FormData): Promise<BookFormState>` — bound to the slug in the client via `.bind(null, slug)`.

**Notes for the implementer:**
- Honeypot field is `contact_preference_x` (same name as the waitlist) — if non-empty, redirect to a neutral path without creating anything.
- Business validation lives here (not the parser): studio exists + onboarded; `durationHours >= studio.minHours`; recomputed conflict check via `getBusyIntervals` + `hasConflict`.
- Emails are best-effort: wrap each in try/catch so a send failure never fails the booking (mirror the transition-hook philosophy). `redirect()` throws control-flow — call it OUTSIDE any try/catch.
- Owner email address comes from Clerk; if it can't be resolved, skip the owner email (still create the booking + send the renter email).

- [ ] **Step 1: Write the action**

```ts
// app/(public)/book/[slug]/actions.ts
"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { clerkClient } from "@clerk/nextjs/server";
import { getDb } from "@/lib/db";
import { getStudioBySlug, getSpacesForStudio } from "@/lib/studio";
import { createBooking, getBusyIntervals, type TermsSnapshot } from "@/lib/booking";
import { hasConflict } from "@/lib/availability";
import { atlantaSlotToUtc, formatAtlantaRange } from "@/lib/tz";
import {
  sendEmail, renderOwnerBookingRequest, renderRenterRequestReceived,
} from "@/lib/email";
import { parseIntake, type BookFormState } from "./forms";

async function baseUrl(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? "https";
  return `${proto}://${host}`;
}

async function ownerEmail(clerkUserId: string): Promise<string | null> {
  try {
    const client = await clerkClient();
    const user = await client.users.getUser(clerkUserId);
    return user.emailAddresses.find((e) => e.id === user.primaryEmailAddressId)?.emailAddress ?? null;
  } catch {
    return null;
  }
}

export async function submitBooking(
  slug: string, _prev: BookFormState, fd: FormData
): Promise<BookFormState> {
  // Honeypot — real users never fill this; bounce silently to the studio page.
  if (String(fd.get("contact_preference_x") ?? "").length > 0) redirect(`/book/${slug}`);

  const parsed = parseIntake(fd);
  if (!parsed.ok) return { status: "error", error: parsed.error };
  const data = parsed.data;

  const db = getDb();
  const studio = await getStudioBySlug(db, slug);
  if (!studio || !studio.onboardingCompletedAt) return { status: "error", error: "This studio isn't taking bookings right now." };

  if (data.durationHours < (studio.minHours ?? 1)) {
    return { status: "error", error: `This studio has a ${studio.minHours}-hour minimum.` };
  }

  const { startsAt, endsAt } = atlantaSlotToUtc(data.dateISO, data.startHour, data.durationHours);

  // Re-validate availability at submit time (slot may have been taken since page load).
  const busy = await getBusyIntervals(db, studio.id, startsAt, endsAt);
  if (hasConflict({ startsAt, endsAt }, busy)) {
    return { status: "error", error: "That time was just taken — please pick another slot." };
  }

  const spaces = await getSpacesForStudio(db, studio.id);
  const maxOccupancy = spaces.reduce<number | null>(
    (m, s) => (s.maxOccupancy != null ? Math.max(m ?? 0, s.maxOccupancy) : m), null
  );
  const termsSnapshot: TermsSnapshot = {
    hourlyRateCents: studio.hourlyRateCents, minHours: studio.minHours,
    cancellationLadder: studio.cancellationLadder,
    alcoholPolicy: studio.alcoholPolicy, vendorPolicy: studio.vendorPolicy,
    noiseCurfew: studio.noiseCurfew, cleanupWindowMin: studio.cleanupWindowMin, maxOccupancy,
  };

  const { statusToken } = await createBooking(db, {
    studioId: studio.id,
    renterName: data.renterName, renterEmail: data.renterEmail, renterPhone: data.renterPhone,
    eventType: data.eventType, headcount: data.headcount,
    byob: data.byob, outsideVendors: data.outsideVendors, notes: data.notes,
    startsAt, endsAt, depositCents: studio.depositCents, termsSnapshot,
  });

  const origin = await baseUrl();
  const when = formatAtlantaRange(startsAt, endsAt);

  // Best-effort notifications — a send failure must not fail the booking.
  try {
    const to = await ownerEmail(studio.clerkUserId);
    if (to) {
      await sendEmail({
        to, subject: `New booking request — ${data.renterName}`,
        html: await renderOwnerBookingRequest({
          studioName: studio.name, renterName: data.renterName, eventType: data.eventType, when,
          headcount: data.headcount, byob: data.byob, outsideVendors: data.outsideVendors,
          notes: data.notes, dashboardUrl: `${origin}/dashboard`,
        }),
      });
    }
  } catch (e) {
    console.error("owner notification failed (booking stands):", e);
  }
  try {
    await sendEmail({
      to: data.renterEmail, subject: `Request sent to ${studio.name}`,
      html: await renderRenterRequestReceived({
        studioName: studio.name, when, statusUrl: `${origin}/status/${statusToken}`,
      }),
    });
  } catch (e) {
    console.error("renter confirmation failed (booking stands):", e);
  }

  redirect(`/status/${statusToken}`);
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `nvm use 20 && npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Verify lint**

Run: `nvm use 20 && npm run lint`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add "app/(public)/book/[slug]/actions.ts"
git commit -m "feat: submit action — validate, snapshot, createBooking, notify, redirect

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: `book/[slug]/page.tsx` + `BookingFlow` client component

**Files:**
- Create: `app/(public)/book/[slug]/page.tsx`
- Create: `app/(public)/book/[slug]/_components/BookingFlow.tsx`

**Interfaces:**
- Consumes: `getStudioBySlug`, `getSpacesForStudio` (`@/lib/studio`); `getBusyIntervals` (`@/lib/booking`); `formatCents` (`@/lib/money`); `START_HOURS`, `DURATION_OPTIONS`, `EVENT_TYPES`, `BOOK_IDLE`, `BookFormState` (`./forms`); `availableStartHours`, `hasConflict`, `type Interval` (`@/lib/availability`); `atlantaSlotToUtc` (`@/lib/tz`); `submitBooking` (`./actions`); `notFound` (`next/navigation`).
- The page builds a serializable `BookViewModel` (all `Date`s as ISO strings) and renders `<BookingFlow vm={...} action={submitBooking.bind(null, slug)} />`.

**Prototype fidelity:** port the three renter screens from `prototype/VenueDash_Prototype.dc.html` lines 723–814 (public page, intake, review). Rewrite all copy to v0.5 truth (Global Constraints). The post-approval contract/COI/payment screens (proto 827+) are OUT — do not port them.

- [ ] **Step 1: Write the server component**

```tsx
// app/(public)/book/[slug]/page.tsx
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { getStudioBySlug, getSpacesForStudio } from "@/lib/studio";
import { getBusyIntervals } from "@/lib/booking";
import { submitBooking } from "./actions";
import BookingFlow, { type BookViewModel } from "./_components/BookingFlow";

const DAYS_AHEAD = 30;

export default async function BookPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const db = getDb();
  const studio = await getStudioBySlug(db, slug);
  if (!studio || !studio.onboardingCompletedAt) notFound();

  const spaces = await getSpacesForStudio(db, studio.id);
  const maxOccupancy = spaces.reduce<number | null>(
    (m, s) => (s.maxOccupancy != null ? Math.max(m ?? 0, s.maxOccupancy) : m), null
  );

  const now = new Date();
  const to = new Date(now.getTime() + DAYS_AHEAD * 24 * 60 * 60 * 1000);
  const busy = await getBusyIntervals(db, studio.id, now, to);

  // Next 30 calendar days as Atlanta-labelled day chips.
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
  const dow = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short" });
  const dnum = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", day: "numeric" });
  const days = Array.from({ length: DAYS_AHEAD }, (_, i) => {
    const d = new Date(now.getTime() + i * 24 * 60 * 60 * 1000);
    return { dateISO: fmt.format(d), dow: dow.format(d).toUpperCase(), num: dnum.format(d) };
  });

  const vm: BookViewModel = {
    slug: studio.slug,
    studioName: studio.name,
    description: studio.description,
    address: studio.address,
    hourlyRateCents: studio.hourlyRateCents ?? 0,
    minHours: studio.minHours ?? 1,
    depositCents: studio.depositCents ?? 0,
    maxOccupancy,
    alcoholPolicy: studio.alcoholPolicy,
    vendorPolicy: studio.vendorPolicy,
    noiseCurfew: studio.noiseCurfew,
    spaces: spaces.map((s) => ({ name: s.name, maxOccupancy: s.maxOccupancy })),
    days,
    busy: busy.map((b) => ({ startsAt: b.startsAt.toISOString(), endsAt: b.endsAt.toISOString() })),
  };

  return <BookingFlow vm={vm} action={submitBooking.bind(null, studio.slug)} />;
}
```

- [ ] **Step 2: Write the client component**

```tsx
// app/(public)/book/[slug]/_components/BookingFlow.tsx
"use client";

import { useMemo, useState } from "react";
import { useActionState } from "react";
import { formatCents } from "@/lib/money";
import { atlantaSlotToUtc } from "@/lib/tz";
import { availableStartHours, hasConflict, type Interval } from "@/lib/availability";
import {
  START_HOURS, DURATION_OPTIONS, EVENT_TYPES, BOOK_IDLE, type BookFormState,
} from "../forms";

export type BookViewModel = {
  slug: string;
  studioName: string;
  description: string | null;
  address: string | null;
  hourlyRateCents: number;
  minHours: number;
  depositCents: number;
  maxOccupancy: number | null;
  alcoholPolicy: string | null;
  vendorPolicy: string | null;
  noiseCurfew: string | null;
  spaces: { name: string; maxOccupancy: number | null }[];
  days: { dateISO: string; dow: string; num: string }[];
  busy: { startsAt: string; endsAt: string }[];
};

const ALCOHOL_LABEL: Record<string, string> = {
  byob_with_acknowledgment: "BYOB ok w/ acknowledgment",
  prohibited: "No alcohol",
  licensed_bartender_only: "Licensed bartender only",
};
const VENDOR_LABEL: Record<string, string> = {
  pre_approval: "Vendors pre-approved",
  allowed: "Outside vendors welcome",
};

const hourLabel = (h: number) => {
  const period = h < 12 ? "AM" : "PM";
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}:00 ${period}`;
};

function labelForDate(days: BookViewModel["days"], dateISO: string): string {
  const d = days.find((x) => x.dateISO === dateISO);
  return d ? `${d.dow} ${d.num}` : dateISO;
}

const CARD = "bg-white border border-renter-border rounded-xl";
const PRIMARY = "w-full bg-renter-ink text-renter-bg font-bold text-[15px] py-4 rounded-xl disabled:opacity-40";

export default function BookingFlow({
  vm, action,
}: { vm: BookViewModel; action: (prev: BookFormState, fd: FormData) => Promise<BookFormState> }) {
  const [step, setStep] = useState<"page" | "form" | "review">("page");
  const [dateISO, setDateISO] = useState<string>("");
  const [startHour, setStartHour] = useState<number | null>(null);
  const [durationHours, setDurationHours] = useState<number>(vm.minHours);

  const [eventType, setEventType] = useState("");
  const [headcount, setHeadcount] = useState("");
  const [byob, setByob] = useState(false);
  const [outsideVendors, setOutsideVendors] = useState(false);
  const [notes, setNotes] = useState("");

  const [state, formAction, pending] = useActionState(action, BOOK_IDLE);

  const busy = useMemo<Interval[]>(
    () => vm.busy.map((b) => ({ startsAt: new Date(b.startsAt), endsAt: new Date(b.endsAt) })),
    [vm.busy]
  );
  const openHours = useMemo(
    () => (dateISO ? availableStartHours(dateISO, START_HOURS, vm.minHours, busy) : []),
    [dateISO, vm.minHours, busy]
  );
  const slotConflict = useMemo(() => {
    if (!dateISO || startHour == null) return false;
    return hasConflict(atlantaSlotToUtc(dateISO, startHour, durationHours), busy);
  }, [dateISO, startHour, durationHours, busy]);

  const overCap = vm.maxOccupancy != null && parseInt(headcount || "0", 10) > vm.maxOccupancy;
  const canRequest = dateISO && startHour != null && !slotConflict;
  const canReview = eventType && parseInt(headcount || "0", 10) >= 1;

  const priceCents = startHour != null ? durationHours * vm.hourlyRateCents : 0;
  const whenLabel = dateISO && startHour != null
    ? `${labelForDate(vm.days, dateISO)} · ${hourLabel(startHour)}–${hourLabel(startHour + durationHours)}`
    : "";

  const chip = "text-[11px] font-semibold bg-[#edeade] border border-renter-border rounded-full px-2.5 py-1 text-[#4c483e]";

  return (
    <main className="mx-auto min-h-screen w-full max-w-[430px] bg-renter-bg">
      {/* ---------- STEP: PUBLIC PAGE ---------- */}
      {step === "page" && (
        <div>
          <div className="flex h-[200px] items-end bg-[repeating-linear-gradient(45deg,#e7e2d6_0_14px,#eee9de_14px_28px)] p-5">
            <span className="font-mono text-[9px] uppercase tracking-[.1em] text-[#8a867c]">Studio</span>
          </div>
          <div className="px-5 pt-5">
            <h1 className="font-serif text-[31px] leading-tight">{vm.studioName}</h1>
            {vm.address && (
              <div className="mb-3.5 font-mono text-[9.5px] uppercase tracking-[.12em] text-[#8a867c]">{vm.address}</div>
            )}
            {vm.description && <p className="mb-4 text-[13.5px] leading-relaxed text-[#4c483e]">{vm.description}</p>}

            <div className="mb-4 flex gap-5 border-y border-[#e2ddd0] py-3.5">
              <div><div className="text-base font-bold">{formatCents(vm.hourlyRateCents)}<span className="text-[11px] font-medium text-[#8a867c]">/hr</span></div><div className="mt-0.5 text-[10px] text-[#8a867c]">{vm.minHours} hr minimum</div></div>
              {vm.maxOccupancy != null && <div><div className="text-base font-bold">{vm.maxOccupancy}</div><div className="mt-0.5 text-[10px] text-[#8a867c]">max guests</div></div>}
              <div><div className="text-base font-bold">{formatCents(vm.depositCents)}</div><div className="mt-0.5 text-[10px] text-[#8a867c]">refundable deposit</div></div>
            </div>

            <div className="mb-2 text-[11px] font-bold uppercase tracking-[.04em] text-[#8a867c]">House rules</div>
            <div className="mb-5 flex flex-wrap gap-1.5">
              {vm.alcoholPolicy && <div className={chip}>{ALCOHOL_LABEL[vm.alcoholPolicy] ?? vm.alcoholPolicy}</div>}
              {vm.vendorPolicy && <div className={chip}>{VENDOR_LABEL[vm.vendorPolicy] ?? vm.vendorPolicy}</div>}
              {vm.noiseCurfew && <div className={chip}>Music until {vm.noiseCurfew}</div>}
              <div className={chip}>Studio gear hands-off</div>
            </div>

            <div className="mb-2 text-[11px] font-bold uppercase tracking-[.04em] text-[#8a867c]">Pick a date</div>
            <div className="mb-3 flex gap-1.5 overflow-x-auto pb-0.5">
              {vm.days.map((d) => {
                const active = d.dateISO === dateISO;
                return (
                  <button
                    key={d.dateISO}
                    onClick={() => { setDateISO(d.dateISO); setStartHour(null); }}
                    className={`min-w-[52px] rounded-[10px] border px-1 py-2 text-center ${active ? "border-renter-ink bg-renter-ink text-renter-bg" : "border-renter-border bg-white"}`}
                  >
                    <div className="font-mono text-[8.5px] tracking-[.06em]">{d.dow}</div>
                    <div className="mt-0.5 text-[15px] font-bold">{d.num}</div>
                  </button>
                );
              })}
            </div>

            {dateISO && (
              <>
                <div className="mb-2 text-[11px] font-bold uppercase tracking-[.04em] text-[#8a867c]">Start time</div>
                <div className="mb-4 flex flex-wrap gap-1.5">
                  {START_HOURS.map((h) => {
                    const open = openHours.includes(h);
                    const active = h === startHour;
                    return (
                      <button
                        key={h}
                        disabled={!open}
                        onClick={() => setStartHour(h)}
                        className={`rounded-full border px-3.5 py-2 text-xs font-semibold ${active ? "border-renter-ink bg-renter-ink text-renter-bg" : "border-renter-border bg-white"} disabled:opacity-30`}
                      >
                        {hourLabel(h)}
                      </button>
                    );
                  })}
                </div>

                <div className="mb-2 text-[11px] font-bold uppercase tracking-[.04em] text-[#8a867c]">Duration</div>
                <div className="mb-4 flex flex-wrap gap-1.5">
                  {DURATION_OPTIONS.filter((n) => n >= vm.minHours).map((n) => (
                    <button
                      key={n}
                      onClick={() => setDurationHours(n)}
                      className={`rounded-full border px-3.5 py-2 text-xs font-semibold ${n === durationHours ? "border-renter-ink bg-renter-ink text-renter-bg" : "border-renter-border bg-white"}`}
                    >
                      {n} hrs
                    </button>
                  ))}
                </div>
              </>
            )}

            {slotConflict && <p className="mb-3 text-xs text-[#b4462f]">That window overlaps another booking — try a different time.</p>}
            <button disabled={!canRequest} onClick={() => setStep("form")} className={`${PRIMARY} mb-3.5`}>Request to book</button>
            <div className="pb-6 text-center font-mono text-[9px] tracking-[.06em] text-[#a8a294]">SECURE BOOKING POWERED BY VENUEDASH</div>
          </div>
        </div>
      )}

      {/* ---------- STEP: INTAKE ---------- */}
      {step === "form" && (
        <div className="px-5 pb-6 pt-4">
          <button onClick={() => setStep("page")} className="mb-3.5 text-xs font-semibold text-[#8a867c]">← Back</button>
          <h2 className="font-serif text-2xl">Tell us about your event</h2>
          <div className="mb-5 text-xs text-[#8a867c]">{whenLabel} · this goes into your contract</div>

          <div className="flex flex-col gap-3.5">
            <label className="text-xs font-semibold text-[#4c483e]">
              Event type
              <select value={eventType} onChange={(e) => setEventType(e.target.value)} className="mt-1.5 block w-full rounded-[10px] border border-renter-border bg-white px-3 py-3 text-sm text-renter-ink">
                <option value="">Choose…</option>
                {EVENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>

            <label className="text-xs font-semibold text-[#4c483e]">
              Estimated headcount
              <input value={headcount} onChange={(e) => setHeadcount(e.target.value)} inputMode="numeric" placeholder="e.g. 25" className="mt-1.5 block w-full rounded-[10px] border border-renter-border bg-white px-3.5 py-3 text-sm text-renter-ink" />
            </label>
            {overCap && <p className="-mt-2 text-[10.5px] text-[#b4462f]">Over the {vm.maxOccupancy}-guest cap — the studio may decline, but you can still ask.</p>}

            <div className="flex gap-2">
              <button onClick={() => setByob(!byob)} className={`flex-1 rounded-[10px] border p-3 text-left text-[12.5px] font-semibold ${byob ? "border-renter-ink bg-renter-ink text-renter-bg" : "border-renter-border bg-white text-[#4c483e]"}`}>
                Bringing alcohol (BYOB)<div className="mt-0.5 text-[10px] font-medium opacity-70">{byob ? "Yes" : "No"}</div>
              </button>
              <button onClick={() => setOutsideVendors(!outsideVendors)} className={`flex-1 rounded-[10px] border p-3 text-left text-[12.5px] font-semibold ${outsideVendors ? "border-renter-ink bg-renter-ink text-renter-bg" : "border-renter-border bg-white text-[#4c483e]"}`}>
                Outside vendors<div className="mt-0.5 text-[10px] font-medium opacity-70">{outsideVendors ? "Yes" : "No"}</div>
              </button>
            </div>

            <label className="text-xs font-semibold text-[#4c483e]">
              Anything else? <span className="font-normal text-[#a8a294]">(optional)</span>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Decor plans, setup needs, questions…" className="mt-1.5 block min-h-[70px] w-full resize-y rounded-[10px] border border-renter-border bg-white px-3.5 py-3 text-[13px] text-renter-ink" />
            </label>

            <button disabled={!canReview} onClick={() => setStep("review")} className={PRIMARY}>Review request</button>
          </div>
        </div>
      )}

      {/* ---------- STEP: REVIEW ---------- */}
      {step === "review" && (
        <div className="px-5 pb-6 pt-4">
          <button onClick={() => setStep("form")} className="mb-3.5 text-xs font-semibold text-[#8a867c]">← Back</button>
          <h2 className="mb-4 font-serif text-2xl">Review your request</h2>

          <div className={`${CARD} mb-3 p-4`}>
            <div className="text-[13px] leading-8 text-renter-ink">
              <strong>{whenLabel}</strong><br />
              {eventType} · {headcount} guests<br />
              <span className="text-[#8a867c]">{byob ? "BYOB" : "No alcohol"} · {outsideVendors ? "Outside vendors" : "No outside vendors"}</span>
            </div>
          </div>

          <div className={`${CARD} mb-3 p-4`}>
            <div className="flex justify-between py-1 text-[13px]"><span className="text-[#4c483e]">Studio rental · {durationHours} hrs × {formatCents(vm.hourlyRateCents)}</span><span className="font-bold">{formatCents(priceCents)}</span></div>
            <div className="border-b border-[#eee9de] pb-2 text-[10.5px] text-[#a8a294]">Paid directly to {vm.studioName} after approval</div>
            <div className="flex justify-between pb-1 pt-2 text-[13px]"><span className="text-[#4c483e]">Refundable damage deposit</span><span className="font-bold">{formatCents(vm.depositCents)}</span></div>
            <div className="text-[10.5px] text-[#a8a294]">Arranged directly with {vm.studioName} — VenueDash never holds your money.</div>
          </div>

          <div className="mb-4 rounded-xl bg-[#edeade] px-4 py-3.5">
            <div className="mb-2 text-[11px] font-bold uppercase tracking-[.04em] text-[#8a867c]">What happens next</div>
            <div className="text-xs leading-8 text-[#4c483e]">1 · {vm.studioName} reviews (usually &lt; 24 hrs)<br />2 · Sign the rental agreement<br />3 · Arrange the deposit — you're booked</div>
          </div>

          <form action={formAction}>
            {/* Honeypot — hidden from real users, tempting to bots */}
            <input type="text" name="contact_preference_x" tabIndex={-1} autoComplete="one-time-code" aria-hidden className="hidden" />
            {/* Hidden fields carry the collected picker/intake values into the action */}
            <HiddenFields
              dateISO={dateISO} startHour={startHour ?? 0} durationHours={durationHours}
              eventType={eventType} headcount={headcount} byob={byob} outsideVendors={outsideVendors} notes={notes}
            />
            <RenterContactFields />
            {state.status === "error" && <p className="mb-2 text-xs text-[#b4462f]" role="alert">{state.error}</p>}
            <button type="submit" disabled={pending} className={`${PRIMARY} mb-2.5`}>{pending ? "Sending…" : "Send booking request"}</button>
          </form>
          <div className="text-center text-[11px] text-[#a8a294]">Nothing is charged here — {vm.studioName} handles payment after approval.</div>
        </div>
      )}
    </main>
  );

  function HiddenFields(p: {
    dateISO: string; startHour: number; durationHours: number; eventType: string; headcount: string;
    byob: boolean; outsideVendors: boolean; notes: string;
  }) {
    return (
      <>
        <input type="hidden" name="dateISO" value={p.dateISO} readOnly />
        <input type="hidden" name="startHour" value={p.startHour} readOnly />
        <input type="hidden" name="durationHours" value={p.durationHours} readOnly />
        <input type="hidden" name="eventType" value={p.eventType} readOnly />
        <input type="hidden" name="headcount" value={p.headcount} readOnly />
        {p.byob && <input type="hidden" name="byob" value="on" readOnly />}
        {p.outsideVendors && <input type="hidden" name="outsideVendors" value="on" readOnly />}
        <input type="hidden" name="notes" value={p.notes} readOnly />
      </>
    );
  }

  function RenterContactFields() {
    return (
      <div className="mb-3 flex flex-col gap-2">
        <input name="renterName" required placeholder="Your name" className="rounded-[10px] border border-renter-border bg-white px-3.5 py-3 text-sm text-renter-ink" />
        <input name="renterEmail" type="email" required placeholder="you@email.com" className="rounded-[10px] border border-renter-border bg-white px-3.5 py-3 text-sm text-renter-ink" />
        <input name="renterPhone" placeholder="Phone (optional)" className="rounded-[10px] border border-renter-border bg-white px-3.5 py-3 text-sm text-renter-ink" />
      </div>
    );
  }
}
```

- [ ] **Step 3: Verify typecheck + lint + build**

Run: `nvm use 20 && npm run typecheck && npm run lint`
Expected: no errors.

- [ ] **Step 4: Render-verify locally**

Seed the dev DB and render the page against a real studio:

Run: `nvm use 20 && npm run db:seed && npm run dev` then open `http://localhost:3000/book/westview-studio`
Expected: the warm-light booking page renders; picking a date reveals start times; times overlapping the seeded bookings are disabled; "Request to book" advances to intake → review. (Do NOT submit yet — submit needs Clerk/Resend and is exercised on preview in Task 10.)

> Note: confirm the seed slug — `scripts/seed.ts` sets `SLUG`; use that exact value in the URL.

- [ ] **Step 5: Commit**

```bash
git add "app/(public)/book/[slug]/page.tsx" "app/(public)/book/[slug]/_components/BookingFlow.tsx"
git commit -m "feat: /book/[slug] renter mini-site (page/intake/review), v0.5 copy

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: `/status/[token]` page + delete placeholder stub

**Files:**
- Create: `app/(public)/status/[token]/page.tsx`
- Delete: `app/(public)/status/page.tsx`

**Interfaces:**
- Consumes: `verifyRenterToken` (`@/lib/tokens`); `getDb` (`@/lib/db`); `formatAtlantaRange` (`@/lib/tz`); `bookings`, `studios` schema; `notFound` (`next/navigation`).

- [ ] **Step 1: Delete the placeholder**

```bash
git rm "app/(public)/status/page.tsx"
```

- [ ] **Step 2: Write the status page**

```tsx
// app/(public)/status/[token]/page.tsx
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { verifyRenterToken } from "@/lib/tokens";
import { formatAtlantaRange } from "@/lib/tz";
import { bookings, studios } from "@/db/schema";
import type { BookingState } from "@/lib/domain/states";

const BADGE: Record<BookingState, { label: string; tone: string }> = {
  pending: { label: "Request sent — waiting on the studio", tone: "#8a867c" },
  awaiting_contract: { label: "Approved — rental agreement next", tone: "#4d7c4a" },
  awaiting_signature: { label: "Approved — rental agreement next", tone: "#4d7c4a" },
  confirmed: { label: "You're booked", tone: "#4d7c4a" },
  event_day: { label: "You're booked", tone: "#4d7c4a" },
  post_event: { label: "You're booked", tone: "#4d7c4a" },
  closed: { label: "This booking is complete", tone: "#8a867c" },
  declined: { label: "This request wasn't accepted", tone: "#b4462f" },
  canceled: { label: "This booking was canceled", tone: "#b4462f" },
};

export default async function StatusPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const db = getDb();
  const bookingId = await verifyRenterToken(db, token, "status");
  if (!bookingId) notFound();

  const [booking] = await db.select().from(bookings).where(eq(bookings.id, bookingId));
  if (!booking) notFound();
  const [studio] = await db.select({ name: studios.name }).from(studios).where(eq(studios.id, booking.studioId));

  const badge = BADGE[booking.state];
  const when = formatAtlantaRange(booking.startsAt, booking.endsAt);

  return (
    <main className="mx-auto min-h-screen w-full max-w-[430px] bg-renter-bg px-6 pt-16">
      <div className="mb-2 font-mono text-[9.5px] uppercase tracking-[.12em] text-[#8a867c]">{studio?.name}</div>
      <h1 className="mb-4 font-serif text-[26px] leading-tight" style={{ color: badge.tone }}>{badge.label}</h1>
      <div className="rounded-xl border border-renter-border bg-white p-4 text-[13px] leading-8 text-renter-ink">
        <strong>{when}</strong><br />
        {booking.eventType} · {booking.headcount} guests
      </div>
      <p className="mt-6 text-xs leading-relaxed text-[#8a867c]">
        Bookmark this page to check your request status anytime — no account needed.
      </p>
    </main>
  );
}
```

- [ ] **Step 3: Verify typecheck + lint**

Run: `nvm use 20 && npm run typecheck && npm run lint`
Expected: no errors.

- [ ] **Step 4: Render-verify locally**

With the seeded DB, mint a status token for a seeded booking and open the page. Quick path: add a throwaway token via `npm run db:seed` already runs; instead verify an invalid token 404s and a valid one renders by temporarily logging a token, OR defer full render to preview (Task 10). Minimum check now: open `http://localhost:3000/status/not-a-real-token` → expect the 404 page.

- [ ] **Step 5: Commit**

```bash
git add "app/(public)/status/[token]/page.tsx"
git commit -m "feat: /status/[token] renter status page; drop phase-0 placeholder

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Final verification + PR

**Files:** none (verification + integration).

- [ ] **Step 1: Full gate suite on Node 20**

Run: `nvm use 20 && npm run lint && npm run typecheck && npm run test && npm run build`
Expected: lint clean, typecheck clean, all tests pass (existing + new tz/availability/booking/forms/money/studio/email), build succeeds.

- [ ] **Step 2: Discipline greps**

Run:
```bash
grep -rn "\.state\s*=" app lib | grep -v "setState\|useState\|\.state ===" ; echo "---"
grep -rin "held securely\|auto-refund\|escrow\|upload.*insurance\|immutable evidence" app emails
```
Expected: first grep shows no direct `bookings.state` assignment outside `transitionBooking`; second grep returns nothing (no v1.0/escrow copy leaked in).

- [ ] **Step 3: Push branch and open PR**

```bash
git push -u origin feat/phase-4-public-booking
gh pr create --title "Phase 4 — Public booking page + intake" --body "$(cat <<'EOF'
Implements v0.5 spec §5 Phase 4. Renter mini-site at /book/[slug]:
availability picker (date + start + duration, conflict-checked), intake,
review, submit → pending booking with terms snapshot, owner + renter
emails, durable /status/[token] link.

Spec: docs/specs/2026-07-05-venuedash-phase-4-public-booking-design.md
Plan: docs/plans/2026-07-05-venuedash-phase-4-public-booking.md

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4: Preview-deploy verification (human-assisted, per the hard-won lesson)**

On the Vercel preview:
- Open `/book/<seed-slug>`; complete page → intake → review → **submit** a real request.
- Confirm redirect to `/status/<token>` shows "Request sent — waiting on the studio" with the correct Atlanta time.
- Confirm the owner notification email arrives (owner email resolved via Clerk) and the renter confirmation email arrives with a working status link.
- Confirm the new booking appears as `pending` in the DB / dashboard.
- Confirm a slot overlapping an existing booking is disabled in the picker, and that submitting a now-taken slot returns the conflict error.

- [ ] **Step 5: Update the ledger**

Append a Phase 4 section to `.superpowers/sdd/progress.md` (tasks, commit ranges, review outcomes, carry-forwards), matching the format of Phases 1–3.

---

## Self-Review

**1. Spec coverage** (each spec section → task):
- §3 routes/gating → Task 8 (`/book` load + `onboardingCompletedAt` 404), Task 9 (`/status/[token]`, stub delete). ✅
- §4 renter flow + copy rewrite → Task 8 (BookingFlow, three screens, v0.5 copy). ✅
- §5 submit action + `createBooking` (genesis insert, snapshot, token, no event row) → Task 4 (createBooking) + Task 7 (action). ✅
- §6 helpers (tz, availability, formatCents, getStudioBySlug) → Tasks 1, 2, 3. ✅
- §7 emails (owner via Clerk, renter status; non-blocking) → Task 6 (templates) + Task 7 (Clerk lookup + best-effort send). ✅
- §8 status page + badge → Task 9. ✅
- §9 validation/errors (404 gate, submit re-validation, honeypot, over-cap warn, invalid token 404) → Tasks 5/7/8/9. ✅
- §10 testing → tests in Tasks 1–6; render/preview verification in Tasks 8–10. ✅
- §11 file list → matches File Structure + task files. ✅
- §12 out-of-scope → nothing in the plan builds Phase 5/6 surfaces. ✅
- §13 exit criteria → Task 10. ✅

**2. Placeholder scan:** No "TBD/TODO/handle appropriately" left. The one intentional call-out (duplicate `renterName` hidden input in Task 8) is flagged with an explicit deletion instruction, not left ambiguous.

**3. Type consistency:** `TermsSnapshot` (Task 4) is consumed identically in Task 7. `BookFormState`/`BOOK_IDLE`/`parseIntake`/`ParsedIntake` (Task 5) match their uses in Tasks 7–8. `Interval` (Task 2) matches `getBusyIntervals` return (Task 4) and `BookingFlow` (Task 8). `atlantaSlotToUtc`/`formatAtlantaRange` signatures (Task 1) match every call site. `availableStartHours`/`hasConflict` (Task 2) match Task 8 usage. Email prop types (Task 6) match Task 7 call sites. ✅
