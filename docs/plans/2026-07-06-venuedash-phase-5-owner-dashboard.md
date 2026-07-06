# VenueDash Phase 5 — Owner Dashboard + Booking Detail — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the studio owner the in-app surface to act on bookings — a grouped dashboard and a state-derived booking-detail screen that drive the owner-facing transitions (approve / decline / cancel / mark-signed) and the manual deposit-status toggle through the existing domain spine.

**Architecture:** A pure, DB-free view-model (`lib/domain/booking-view.ts`) turns a raw `Booking` + `now` into everything the UI renders — effective state, dashboard group, legal owner actions, deposit-control flag, and a status chip. Server components under `(owner)` fetch bookings (studio-scoped) and map them through the view-model; thin `"use server"` actions call `transitionBooking` / column-update helpers and `revalidatePath`. All bookings.state writes still go through `transitionBooking`; deposit/contract-signed are plain column updates. Pure logic is TDD'd with vitest; DB helpers are PGlite-tested; the two screens are verified by rendering.

**Tech Stack:** Next.js 16 (App Router) · React 19 · Tailwind v4 (`@theme` tokens) · Drizzle + Neon (websocket Pool) · Clerk 7 (owner auth) · vitest + PGlite.

**Source spec:** `docs/specs/2026-07-06-venuedash-phase-5-owner-dashboard-design.md`

## Global Constraints

Every task's requirements implicitly include these (verbatim from spec + CLAUDE.md):

- **Node 20 only** — run all `npm`/`npx` commands under `nvm use 20` (default shell Node is 24; engine-strict rejects it).
- **DB handle first param** — every DB-touching function takes the Drizzle `Db` (`import type { Db } from "@/lib/domain/transitions"`) as its first parameter; PGlite tests inject `createTestDb()` from `@/lib/domain/test-db`, which applies the real generated migrations in `drizzle/`.
- **State discipline** — no code writes `bookings.state` except `transitionBooking`. Owner actions call it with `actor = { type: "owner", id: userId }`. `deposit_status` / `contract_signed_at` are plain column updates (not transitions) and write **no** `booking_events` row.
- **Effective state** — clock-driven sections derive via `deriveEffectiveState(booking, now)` (`@/lib/domain/effective-state`); never branch on raw `booking.state` for `confirmed`/`event_day`/`post_event`.
- **`"use server"` files export only async functions** — constants/types/parsers live in the plain colocated `forms.ts`, or a `const` reaches client components as a broken server-reference and crashes at render.
- **Ownership is the security boundary** — every owner read/action resolves the studio from the authenticated Clerk `userId` and fetches the booking studio-scoped (`getBookingForOwner`); a foreign booking id → `notFound()`. Never trust an id from the client as authorization.
- **Owner surface** — dark tokens only: `owner-bg #0b0c0f`, `owner-panel #16171c`, `owner-panel-2 #16181e`, `owner-border #26272e`, `owner-text #e9eaee`, `owner-muted #9a9ca8`, `owner-accent #7a86ff`, `success #5fd68b`, `warning #e6b054`, `danger #ef6f54`. `font-serif` (Instrument Serif) for `h1`/display, `font-mono` (IBM Plex Mono) for uppercase metadata/eyebrow labels. Where a prototype hex has no token, use an arbitrary Tailwind value matching the prototype exactly.
- **Copy discipline (v0.5 truth)** — no "held by VenueDash / secured / released on schedule"; no COI card or "$1M per occurrence"; no claim window / countdown / "auto-refunds"; no "sends the contract and COI automatically" / "pay the deposit". Deposit is off-platform and owner-arranged; VenueDash only records `deposit_status`. **"timestamped documentation," never "immutable evidence."**
- **Shared input class** — never put a width utility (`w-full`) in a class reused by flex-row items (it overrides `flex-1`/fixed widths — shipped as a bug once).
- **Commits** — end every commit message with:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

## File Structure

**New (created by this plan):**
- `lib/domain/booking-view.ts` — pure view-model: effective state, group, legal actions, deposit-control flag, chip.
- `app/(owner)/_components/Sidebar.tsx` — client: studio badge + slug + nav with active highlighting.
- `app/(owner)/_components/StateChip.tsx` — shared status chip (label + tone → owner colors).
- `app/(owner)/dashboard/_components/MetricStrip.tsx` — 3 summary cards.
- `app/(owner)/dashboard/_components/BookingRow.tsx` — one booking list row (a `Link`).
- `app/(owner)/dashboard/bookings/[id]/page.tsx` — booking detail server component.
- `app/(owner)/dashboard/bookings/[id]/forms.ts` — deposit-status parser + form-state constants.
- `app/(owner)/dashboard/bookings/[id]/actions.ts` — `"use server"` owner actions.
- `app/(owner)/dashboard/bookings/[id]/_components/LifecycleRail.tsx` — 9-state vertical timeline.
- `app/(owner)/dashboard/bookings/[id]/_components/DepositControl.tsx` — client segmented deposit control.
- `app/(owner)/dashboard/bookings/[id]/_components/ActionButtons.tsx` — client approve/decline/cancel/mark-signed buttons (useActionState).
- Tests: `lib/domain/booking-view.test.ts`, `app/(owner)/dashboard/bookings/[id]/forms.test.ts`; extend `lib/booking.test.ts`.

**Modified:**
- `lib/booking.ts` — add `listBookingsForStudio`, `getBookingForOwner`, `getBookingEvents`, `setDepositStatus`, `setContractSignedAt`, and `type DepositStatus`.
- `app/(owner)/layout.tsx` — wrap children in the two-pane sidebar shell.
- `app/(owner)/dashboard/page.tsx` — replace empty-only page with metric strip + grouped list (keeping the empty state).
- `scripts/seed.ts` — widen `rateSnapshot` to the full 8-field `TermsSnapshot`; fix two policy-enum values.

**Unchanged (no edit needed):**
- `proxy.ts` — `/dashboard(.*)` already gates the new detail route. Do **not** add `middleware.ts`.
- `lib/domain/transitions.ts`, `lib/domain/states.ts`, `lib/domain/effective-state.ts`, `app/(owner)/_components/CopyLinkButton.tsx` — reused as-is.

---

## Task 1: Align the seed's terms snapshot (dev data)

The detail screen's "Agreed terms" panel reads the full `rateSnapshot`; the seed currently writes only 3 of the 8 fields and uses two policy strings that don't match the wizard enums. Fix the dev data so seeded rows render correctly.

**Files:**
- Modify: `scripts/seed.ts`

- [ ] **Step 1: Read the current snapshot + studio-policy lines**

Run: `nvm use 20 && grep -n "rateSnapshot\|alcoholPolicy\|vendorPolicy\|byob_with_agreement\|approved_in_advance" scripts/seed.ts`
Expected: shows the narrow `rateSnapshot: { hourlyRateCents, minHours, cancellationLadder }` object and the studio's `alcoholPolicy: "byob_with_agreement"` / `vendorPolicy: "approved_in_advance"`.

- [ ] **Step 2: Fix the two studio policy enum values**

In the studio insert, change the policy values to the wizard's canonical enums (from `app/(owner)/settings/forms.ts`):

```ts
// scripts/seed.ts — in the studios insert values
alcoholPolicy: "byob_with_acknowledgment",
vendorPolicy: "pre_approval",
```

- [ ] **Step 3: Widen the booking rateSnapshot to the full TermsSnapshot**

Replace the narrow `rateSnapshot` object built per booking with the full 8-field shape (matching `TermsSnapshot` in `lib/booking.ts`). Use the studio's values + the max space occupancy:

```ts
// scripts/seed.ts — where each booking's rateSnapshot is built
rateSnapshot: {
  hourlyRateCents: studio.hourlyRateCents,
  minHours: studio.minHours,
  cancellationLadder: studio.cancellationLadder,
  alcoholPolicy: studio.alcoholPolicy,
  vendorPolicy: studio.vendorPolicy,
  noiseCurfew: studio.noiseCurfew,
  cleanupWindowMin: studio.cleanupWindowMin,
  maxOccupancy: 40, // Main studio cap; matches the seeded spaces
},
```

> If the seed builds `rateSnapshot` once in a shared constant rather than per-row, update that constant. Keep whatever variable names the file already uses for the studio row.

- [ ] **Step 4: Verify typecheck + lint**

Run: `nvm use 20 && npm run typecheck && npm run lint`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add scripts/seed.ts
git commit -m "chore: align seed rateSnapshot to full TermsSnapshot + fix policy enums

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

> Note: re-running `npm run db:seed` against the dev Neon DB is a human/preview step (needs `DATABASE_URL`); it is exercised in Task 10's verification, not here.

---

## Task 2: `lib/domain/booking-view.ts` — the pure view-model

**Files:**
- Create: `lib/domain/booking-view.ts`
- Test: `lib/domain/booking-view.test.ts`

**Interfaces:**
- Consumes: `deriveEffectiveState` (`./effective-state`), `LEGAL_TRANSITIONS`, `type BookingState` (`./states`), `type Booking` (`@/db/schema`).
- Produces:
  - `type DashboardGroup = "needs_action" | "in_progress" | "past"`
  - `type OwnerAction = "approve" | "decline" | "cancel" | "mark_signed"`
  - `type ChipTone = "success" | "warning" | "danger" | "muted"`
  - `type BookingView = { id: string; storedState: BookingState; effectiveState: BookingState; group: DashboardGroup; legalActions: OwnerAction[]; depositControlActive: boolean; chip: { label: string; tone: ChipTone } }`
  - `toBookingView(booking: Booking, now: Date): BookingView`

- [ ] **Step 1: Write the failing test**

```ts
// lib/domain/booking-view.test.ts
import { describe, it, expect } from "vitest";
import type { Booking } from "@/db/schema";
import type { BookingState } from "@/lib/domain/states";
import { toBookingView } from "@/lib/domain/booking-view";

// Minimal Booking factory — toBookingView reads only id/state/startsAt/endsAt.
function bk(state: BookingState, startsAt: Date, endsAt: Date): Booking {
  return { id: "b1", state, startsAt, endsAt } as unknown as Booking;
}
const FAR = new Date("2026-12-01T00:00:00Z");
const START = new Date("2026-12-01T18:00:00Z");
const END = new Date("2026-12-01T22:00:00Z");
const BEFORE = new Date("2026-11-01T00:00:00Z"); // now < start  -> confirmed stays confirmed
const DURING = new Date("2026-12-01T20:00:00Z"); // start <= now <= end -> event_day
const AFTER = new Date("2026-12-02T00:00:00Z");  // now > end -> post_event

describe("toBookingView — group", () => {
  const cases: [BookingState, string][] = [
    ["pending", "needs_action"],
    ["awaiting_signature", "needs_action"],
    ["awaiting_contract", "in_progress"],
    ["confirmed", "in_progress"],
    ["post_event", "past"],
    ["closed", "past"],
    ["declined", "past"],
    ["canceled", "past"],
  ];
  it.each(cases)("%s -> %s", (state, group) => {
    expect(toBookingView(bk(state, START, END), FAR).group).toBe(group);
  });
  it("confirmed during the event is effectively event_day -> in_progress", () => {
    expect(toBookingView(bk("confirmed", START, END), DURING).effectiveState).toBe("event_day");
    expect(toBookingView(bk("confirmed", START, END), DURING).group).toBe("in_progress");
  });
  it("confirmed after the event is effectively post_event -> past", () => {
    const v = toBookingView(bk("confirmed", START, END), AFTER);
    expect(v.effectiveState).toBe("post_event");
    expect(v.group).toBe("past");
  });
});

describe("toBookingView — legalActions", () => {
  it("pending offers approve, decline, cancel", () => {
    expect(toBookingView(bk("pending", START, END), BEFORE).legalActions).toEqual(["approve", "decline", "cancel"]);
  });
  it("awaiting_contract offers only cancel (contract-gen is Phase 6)", () => {
    expect(toBookingView(bk("awaiting_contract", START, END), BEFORE).legalActions).toEqual(["cancel"]);
  });
  it("awaiting_signature offers mark_signed and cancel", () => {
    expect(toBookingView(bk("awaiting_signature", START, END), BEFORE).legalActions).toEqual(["mark_signed", "cancel"]);
  });
  it("confirmed before the event offers cancel", () => {
    expect(toBookingView(bk("confirmed", START, END), BEFORE).legalActions).toEqual(["cancel"]);
  });
  it("cancel is suppressed once the event is effectively event_day", () => {
    expect(toBookingView(bk("confirmed", START, END), DURING).legalActions).toEqual([]);
  });
  it("cancel is suppressed once the event is effectively post_event", () => {
    expect(toBookingView(bk("confirmed", START, END), AFTER).legalActions).toEqual([]);
  });
  it("terminal states offer nothing", () => {
    for (const s of ["closed", "declined", "canceled"] as BookingState[]) {
      expect(toBookingView(bk(s, START, END), FAR).legalActions).toEqual([]);
    }
  });
});

describe("toBookingView — depositControlActive", () => {
  it("is active for confirmed/event_day/post_event and inactive otherwise", () => {
    expect(toBookingView(bk("confirmed", START, END), BEFORE).depositControlActive).toBe(true);
    expect(toBookingView(bk("confirmed", START, END), DURING).depositControlActive).toBe(true);
    expect(toBookingView(bk("confirmed", START, END), AFTER).depositControlActive).toBe(true);
    expect(toBookingView(bk("pending", START, END), FAR).depositControlActive).toBe(false);
    expect(toBookingView(bk("awaiting_signature", START, END), FAR).depositControlActive).toBe(false);
    expect(toBookingView(bk("closed", START, END), FAR).depositControlActive).toBe(false);
  });
});

describe("toBookingView — chip", () => {
  it("uses effective state for the label and tone", () => {
    expect(toBookingView(bk("confirmed", START, END), BEFORE).chip).toEqual({ label: "Confirmed", tone: "success" });
    expect(toBookingView(bk("confirmed", START, END), DURING).chip).toEqual({ label: "Event today", tone: "success" });
    expect(toBookingView(bk("declined", START, END), FAR).chip.tone).toBe("danger");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `nvm use 20 && npx vitest run lib/domain/booking-view.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/domain/booking-view"`.

- [ ] **Step 3: Write the implementation**

```ts
// lib/domain/booking-view.ts
import type { Booking } from "@/db/schema";
import { deriveEffectiveState } from "./effective-state";
import { LEGAL_TRANSITIONS, type BookingState } from "./states";

export type DashboardGroup = "needs_action" | "in_progress" | "past";
export type OwnerAction = "approve" | "decline" | "cancel" | "mark_signed";
export type ChipTone = "success" | "warning" | "danger" | "muted";

export type BookingView = {
  id: string;
  storedState: BookingState;
  effectiveState: BookingState;
  group: DashboardGroup;
  legalActions: OwnerAction[];
  depositControlActive: boolean;
  chip: { label: string; tone: ChipTone };
};

// Group is keyed on EFFECTIVE state (so a confirmed booking whose clock has
// passed lands in "past", not "in_progress").
const GROUP: Record<BookingState, DashboardGroup> = {
  pending: "needs_action",
  awaiting_signature: "needs_action",
  awaiting_contract: "in_progress",
  confirmed: "in_progress",
  event_day: "in_progress",
  post_event: "past",
  closed: "past",
  declined: "past",
  canceled: "past",
};

// Which owner action a legal transition target maps to. Targets with no entry
// are not owner-driven in Phase 5: awaiting_signature (contract-gen = Phase 6),
// event_day/post_event (clock), closed (close-out = deferred).
const TARGET_TO_ACTION: Partial<Record<BookingState, OwnerAction>> = {
  awaiting_contract: "approve",
  declined: "decline",
  canceled: "cancel",
  confirmed: "mark_signed",
};

// Stable button order regardless of LEGAL_TRANSITIONS ordering.
const ACTION_ORDER: OwnerAction[] = ["approve", "decline", "mark_signed", "cancel"];

const CHIP: Record<BookingState, { label: string; tone: ChipTone }> = {
  pending: { label: "Pending review", tone: "warning" },
  awaiting_contract: { label: "Approved", tone: "muted" },
  awaiting_signature: { label: "Awaiting signature", tone: "warning" },
  confirmed: { label: "Confirmed", tone: "success" },
  event_day: { label: "Event today", tone: "success" },
  post_event: { label: "Wrap-up", tone: "warning" },
  closed: { label: "Closed", tone: "muted" },
  declined: { label: "Declined", tone: "danger" },
  canceled: { label: "Canceled", tone: "danger" },
};

const DEPOSIT_ACTIVE_STATES: BookingState[] = ["confirmed", "event_day", "post_event"];

export function toBookingView(booking: Booking, now: Date): BookingView {
  const storedState = booking.state;
  const effectiveState = deriveEffectiveState(booking, now);

  // Legality comes from the STORED state (that's what transitionBooking checks),
  // but an action is only OFFERED when the effective state agrees.
  let legalActions = LEGAL_TRANSITIONS[storedState]
    .map((target) => TARGET_TO_ACTION[target])
    .filter((a): a is OwnerAction => a !== undefined);

  // Safety rule: never offer cancel on an event that is effectively underway or over.
  if (effectiveState === "event_day" || effectiveState === "post_event") {
    legalActions = legalActions.filter((a) => a !== "cancel");
  }
  legalActions = ACTION_ORDER.filter((a) => legalActions.includes(a));

  return {
    id: booking.id,
    storedState,
    effectiveState,
    group: GROUP[effectiveState],
    legalActions,
    depositControlActive: DEPOSIT_ACTIVE_STATES.includes(effectiveState),
    chip: CHIP[effectiveState],
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `nvm use 20 && npx vitest run lib/domain/booking-view.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/domain/booking-view.ts lib/domain/booking-view.test.ts
git commit -m "feat: pure booking view-model (effective state, group, legal actions, chip)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: `lib/booking.ts` — owner read/write helpers

**Files:**
- Modify: `lib/booking.ts`
- Test: `lib/booking.test.ts` (extend)

**Interfaces:**
- Consumes: `Db` (`@/lib/domain/transitions`), `and`/`eq`/`asc` (`drizzle-orm`), `bookings`/`bookingEvents`/`type Booking`/`type BookingEvent` (`@/db/schema`).
- Produces:
  - `type DepositStatus = "uncollected" | "collected" | "returned"`
  - `listBookingsForStudio(db: Db, studioId: string): Promise<Booking[]>` — the studio's bookings, ascending by `startsAt`.
  - `getBookingForOwner(db: Db, bookingId: string, studioId: string): Promise<Booking | null>` — studio-scoped; `null` if absent or owned by another studio.
  - `getBookingEvents(db: Db, bookingId: string): Promise<BookingEvent[]>` — ascending by `createdAt`.
  - `setDepositStatus(db: Db, bookingId: string, status: DepositStatus): Promise<Booking>` — updates `depositStatus` + `depositStatusAt = new Date()`.
  - `setContractSignedAt(db: Db, bookingId: string, at: Date): Promise<void>` — stamps `contractSignedAt`.

- [ ] **Step 1: Write the failing test**

Append to `lib/booking.test.ts` (reuse the file's existing `createTestDb`/`studios`/`bookings` imports; add any missing ones — `bookingEvents`, and the new fns):

```ts
import {
  listBookingsForStudio, getBookingForOwner, getBookingEvents,
  setDepositStatus, setContractSignedAt,
} from "@/lib/booking";
import { transitionBooking } from "@/lib/domain/transitions";

describe("owner booking helpers", () => {
  it("listBookingsForStudio returns only that studio's bookings, ascending by start", async () => {
    const { db, close } = await createTestDb();
    const a = await seedStudio(db); // existing helper in this file
    const [b2] = await db.insert(studios).values({
      clerkUserId: "other-u", name: "Other", slug: "other-studio",
    }).returning();

    const { booking: later } = await createBooking(db, {
      ...input(a), startsAt: new Date("2026-07-20T22:00:00Z"), endsAt: new Date("2026-07-21T02:00:00Z"),
    });
    const { booking: earlier } = await createBooking(db, input(a)); // 2026-07-18
    await createBooking(db, { ...input(b2.id) });

    const rows = await listBookingsForStudio(db, a);
    expect(rows.map((r) => r.id)).toEqual([earlier.id, later.id]); // ascending, other studio excluded
    await close();
  });

  it("getBookingForOwner returns the booking only for its own studio", async () => {
    const { db, close } = await createTestDb();
    const a = await seedStudio(db);
    const [b2] = await db.insert(studios).values({
      clerkUserId: "o2", name: "O2", slug: "o2",
    }).returning();
    const { booking } = await createBooking(db, input(a));

    expect((await getBookingForOwner(db, booking.id, a))?.id).toBe(booking.id);
    expect(await getBookingForOwner(db, booking.id, b2.id)).toBeNull(); // foreign studio
    await close();
  });

  it("getBookingEvents returns the transition history ascending", async () => {
    const { db, close } = await createTestDb();
    const a = await seedStudio(db);
    const { booking } = await createBooking(db, input(a));
    await transitionBooking(db, booking.id, "awaiting_contract", { type: "owner", id: "u" });
    await transitionBooking(db, booking.id, "canceled", { type: "owner", id: "u" });

    const events = await getBookingEvents(db, booking.id);
    expect(events.map((e) => e.toState)).toEqual(["awaiting_contract", "canceled"]);
    await close();
  });

  it("setDepositStatus updates status and stamps depositStatusAt", async () => {
    const { db, close } = await createTestDb();
    const a = await seedStudio(db);
    const { booking } = await createBooking(db, input(a));
    expect(booking.depositStatus).toBe("uncollected");
    expect(booking.depositStatusAt).toBeNull();

    const updated = await setDepositStatus(db, booking.id, "collected");
    expect(updated.depositStatus).toBe("collected");
    expect(updated.depositStatusAt).toBeInstanceOf(Date);
    await close();
  });

  it("setContractSignedAt stamps the timestamp", async () => {
    const { db, close } = await createTestDb();
    const a = await seedStudio(db);
    const { booking } = await createBooking(db, input(a));
    const at = new Date("2026-07-10T12:00:00Z");
    await setContractSignedAt(db, booking.id, at);
    const [row] = await db.select().from(bookings).where(eq(bookings.id, booking.id));
    expect(row.contractSignedAt?.toISOString()).toBe(at.toISOString());
    await close();
  });
});
```

> If `seedStudio`/`input` in this file return/accept a studio **id** vs a **row**, match the existing signatures — the calls above assume `seedStudio` returns the studio id (as in the Phase 4 tests) and `input(studioId)` builds a `CreateBookingInput`. Adjust the two `studios.insert(...).returning()` destructures if the file already exposes a multi-studio helper.

- [ ] **Step 2: Run test to verify it fails**

Run: `nvm use 20 && npx vitest run lib/booking.test.ts`
Expected: FAIL — the new helpers are not exported.

- [ ] **Step 3: Write the implementation**

Append to `lib/booking.ts` (add `asc` to the existing `drizzle-orm` import, and `bookingEvents`, `type BookingEvent` to the `@/db/schema` import):

```ts
export type DepositStatus = "uncollected" | "collected" | "returned";

/** All bookings for a studio, oldest event first. Grouping/effective-state derivation happens in the view-model, not SQL. */
export async function listBookingsForStudio(db: Db, studioId: string): Promise<Booking[]> {
  return db.select().from(bookings)
    .where(eq(bookings.studioId, studioId))
    .orderBy(asc(bookings.startsAt));
}

/** A single booking scoped to its owning studio. null if absent or owned elsewhere — the ownership boundary. */
export async function getBookingForOwner(
  db: Db, bookingId: string, studioId: string
): Promise<Booking | null> {
  const [row] = await db.select().from(bookings)
    .where(and(eq(bookings.id, bookingId), eq(bookings.studioId, studioId)));
  return row ?? null;
}

/** Append-only transition history for the lifecycle rail, oldest first. */
export async function getBookingEvents(db: Db, bookingId: string): Promise<BookingEvent[]> {
  return db.select().from(bookingEvents)
    .where(eq(bookingEvents.bookingId, bookingId))
    .orderBy(asc(bookingEvents.createdAt));
}

/** Manual deposit toggle — a plain column update (not a state transition), stamps the change time. */
export async function setDepositStatus(
  db: Db, bookingId: string, status: DepositStatus
): Promise<Booking> {
  const [row] = await db.update(bookings)
    .set({ depositStatus: status, depositStatusAt: new Date() })
    .where(eq(bookings.id, bookingId))
    .returning();
  return row;
}

/** Records when the contract was marked signed. The confirmed transition is done separately via transitionBooking. */
export async function setContractSignedAt(db: Db, bookingId: string, at: Date): Promise<void> {
  await db.update(bookings).set({ contractSignedAt: at }).where(eq(bookings.id, bookingId));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `nvm use 20 && npx vitest run lib/booking.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/booking.ts lib/booking.test.ts
git commit -m "feat: owner booking helpers (list/detail/events + deposit & contract-signed writes)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: `bookings/[id]/forms.ts` — deposit parser + form-state constants

**Files:**
- Create: `app/(owner)/dashboard/bookings/[id]/forms.ts`
- Test: `app/(owner)/dashboard/bookings/[id]/forms.test.ts`

**Interfaces:**
- Consumes: `type DepositStatus` (`@/lib/booking`).
- Produces:
  - `DEPOSIT_STATUSES: readonly DepositStatus[]` — `["uncollected", "collected", "returned"]` (segmented-control order).
  - `DEPOSIT_LABELS: Record<DepositStatus, string>` — display labels.
  - `type BookingActionState = { status: "idle" | "error"; error: string }` and `BOOKING_ACTION_IDLE: BookingActionState`.
  - `parseDepositStatus(fd: FormData): { ok: true; status: DepositStatus } | { ok: false; error: string }`.

- [ ] **Step 1: Write the failing test**

```ts
// app/(owner)/dashboard/bookings/[id]/forms.test.ts
import { describe, it, expect } from "vitest";
import { parseDepositStatus, DEPOSIT_STATUSES } from "./forms";

function fd(status: string): FormData {
  const f = new FormData();
  f.set("status", status);
  return f;
}

describe("parseDepositStatus", () => {
  it("accepts each known status", () => {
    for (const s of DEPOSIT_STATUSES) {
      expect(parseDepositStatus(fd(s))).toEqual({ ok: true, status: s });
    }
  });
  it("rejects an unknown status", () => {
    expect(parseDepositStatus(fd("refunded")).ok).toBe(false);
  });
  it("rejects a missing status", () => {
    expect(parseDepositStatus(new FormData()).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `nvm use 20 && npx vitest run "app/(owner)/dashboard/bookings/[id]/forms.test.ts"`
Expected: FAIL — cannot resolve `./forms`.

- [ ] **Step 3: Write the implementation**

```ts
// app/(owner)/dashboard/bookings/[id]/forms.ts
import type { DepositStatus } from "@/lib/booking";

export const DEPOSIT_STATUSES: readonly DepositStatus[] = ["uncollected", "collected", "returned"];

export const DEPOSIT_LABELS: Record<DepositStatus, string> = {
  uncollected: "Uncollected",
  collected: "Collected",
  returned: "Returned",
};

export type BookingActionState = { status: "idle" | "error"; error: string };
export const BOOKING_ACTION_IDLE: BookingActionState = { status: "idle", error: "" };

export function parseDepositStatus(
  fd: FormData
): { ok: true; status: DepositStatus } | { ok: false; error: string } {
  const s = String(fd.get("status") ?? "");
  if (!(DEPOSIT_STATUSES as readonly string[]).includes(s)) {
    return { ok: false, error: "Unknown deposit status." };
  }
  return { ok: true, status: s as DepositStatus };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `nvm use 20 && npx vitest run "app/(owner)/dashboard/bookings/[id]/forms.test.ts"`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add "app/(owner)/dashboard/bookings/[id]/forms.ts" "app/(owner)/dashboard/bookings/[id]/forms.test.ts"
git commit -m "feat: booking-action form-state + deposit-status parser

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: `bookings/[id]/actions.ts` — owner server actions

**Files:**
- Create: `app/(owner)/dashboard/bookings/[id]/actions.ts`

**Interfaces:**
- Consumes: `auth` (`@clerk/nextjs/server`); `redirect`/`notFound` (`next/navigation`); `revalidatePath` (`next/cache`); `getDb` (`@/lib/db`); `getStudioByClerkUserId` (`@/lib/studio`); `getBookingForOwner`, `setDepositStatus`, `setContractSignedAt` (`@/lib/booking`); `transitionBooking`, `IllegalTransitionError`, `ConcurrentTransitionError`, `BookingNotFoundError`, `type BookingState` (`@/lib/domain/transitions`, `@/lib/domain/states`); `deriveEffectiveState` (`@/lib/domain/effective-state`); `parseDepositStatus`, `type BookingActionState` (`./forms`).
- Produces (each bound in the client via `.bind(null, bookingId)`, `useActionState` signature):
  - `approveBooking(bookingId: string, _prev: BookingActionState, _fd: FormData): Promise<BookingActionState>`
  - `declineBooking(bookingId, _prev, _fd): Promise<BookingActionState>`
  - `cancelBooking(bookingId, _prev, _fd): Promise<BookingActionState>`
  - `markSigned(bookingId, _prev, _fd): Promise<BookingActionState>`
  - `setDeposit(bookingId, _prev, fd): Promise<BookingActionState>`

**Notes for the implementer:**
- Every action re-resolves the owner + booking server-side (`ownerContext`) — the bound `bookingId` is not trusted for authorization; ownership is enforced by `getBookingForOwner`.
- `transitionBooking` failures (`Illegal`/`Concurrent`/`NotFound`) are caught → friendly error state; any other error rethrows. On success, `revalidatePath` both the detail route and `/dashboard`, then return idle.
- `cancelBooking` re-checks the effective-state gate server-side (defense in depth beyond the UI hiding the button).
- `markSigned` transitions first (guarded), then stamps `contract_signed_at`; the timestamp also rides in the transition `meta`.

- [ ] **Step 1: Write the action file**

```ts
// app/(owner)/dashboard/bookings/[id]/actions.ts
"use server";

import { auth } from "@clerk/nextjs/server";
import { redirect, notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import { getStudioByClerkUserId } from "@/lib/studio";
import {
  getBookingForOwner, setDepositStatus, setContractSignedAt,
} from "@/lib/booking";
import {
  transitionBooking, IllegalTransitionError, ConcurrentTransitionError,
  BookingNotFoundError, type Db,
} from "@/lib/domain/transitions";
import type { BookingState } from "@/lib/domain/states";
import type { Booking } from "@/db/schema";
import { deriveEffectiveState } from "@/lib/domain/effective-state";
import { parseDepositStatus, type BookingActionState } from "./forms";

async function ownerContext(
  bookingId: string
): Promise<{ db: Db; userId: string; booking: Booking }> {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");
  const db = getDb();
  const studio = await getStudioByClerkUserId(db, userId);
  if (!studio) redirect("/settings");
  const booking = await getBookingForOwner(db, bookingId, studio.id);
  if (!booking) notFound();
  return { db, userId, booking };
}

function revalidate(bookingId: string): void {
  revalidatePath(`/dashboard/bookings/${bookingId}`);
  revalidatePath("/dashboard");
}

async function runTransition(
  db: Db, bookingId: string, to: BookingState, userId: string,
  meta?: Record<string, unknown>
): Promise<BookingActionState> {
  try {
    await transitionBooking(db, bookingId, to, { type: "owner", id: userId }, meta ? { meta } : undefined);
  } catch (e) {
    if (
      e instanceof IllegalTransitionError ||
      e instanceof ConcurrentTransitionError ||
      e instanceof BookingNotFoundError
    ) {
      return { status: "error", error: "This booking just changed — refresh and try again." };
    }
    throw e;
  }
  revalidate(bookingId);
  return { status: "idle", error: "" };
}

export async function approveBooking(
  bookingId: string, _prev: BookingActionState, _fd: FormData
): Promise<BookingActionState> {
  const { db, userId } = await ownerContext(bookingId);
  return runTransition(db, bookingId, "awaiting_contract", userId);
}

export async function declineBooking(
  bookingId: string, _prev: BookingActionState, _fd: FormData
): Promise<BookingActionState> {
  const { db, userId } = await ownerContext(bookingId);
  return runTransition(db, bookingId, "declined", userId);
}

export async function cancelBooking(
  bookingId: string, _prev: BookingActionState, _fd: FormData
): Promise<BookingActionState> {
  const { db, userId, booking } = await ownerContext(bookingId);
  const eff = deriveEffectiveState(booking, new Date());
  if (eff === "event_day" || eff === "post_event") {
    return { status: "error", error: "This event has already started or passed and can't be canceled." };
  }
  return runTransition(db, bookingId, "canceled", userId);
}

export async function markSigned(
  bookingId: string, _prev: BookingActionState, _fd: FormData
): Promise<BookingActionState> {
  const { db, userId } = await ownerContext(bookingId);
  const signedAt = new Date();
  const result = await runTransition(
    db, bookingId, "confirmed", userId, { contractSignedAt: signedAt.toISOString() }
  );
  if (result.status === "error") return result;
  await setContractSignedAt(db, bookingId, signedAt); // stamp after the guarded transition
  revalidate(bookingId);
  return result;
}

export async function setDeposit(
  bookingId: string, _prev: BookingActionState, fd: FormData
): Promise<BookingActionState> {
  const { db } = await ownerContext(bookingId);
  const parsed = parseDepositStatus(fd);
  if (!parsed.ok) return { status: "error", error: parsed.error };
  await setDepositStatus(db, bookingId, parsed.status);
  revalidate(bookingId);
  return { status: "idle", error: "" };
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `nvm use 20 && npm run typecheck`
Expected: no errors. (If `transitionBooking`'s options arg differs, match its actual signature in `lib/domain/transitions.ts` — it takes `opts?: { meta?; expectedFrom? }`.)

- [ ] **Step 3: Verify lint**

Run: `nvm use 20 && npm run lint`
Expected: no errors — confirm the `"use server"` file exports only async functions.

- [ ] **Step 4: Commit**

```bash
git add "app/(owner)/dashboard/bookings/[id]/actions.ts"
git commit -m "feat: owner booking actions (approve/decline/cancel/mark-signed/set-deposit)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Owner shell — `layout.tsx` + `Sidebar.tsx`

**Files:**
- Modify: `app/(owner)/layout.tsx`
- Create: `app/(owner)/_components/Sidebar.tsx`

**Interfaces:**
- `layout.tsx` (server) resolves the studio (may be null mid-onboarding) and renders `<Sidebar studioName={...} slug={...} />` beside `{children}` in a two-pane flex shell.
- `Sidebar` (client) uses `usePathname()` to highlight the active nav item.

**Prototype fidelity:** port the sidebar from `prototype/VenueDash_Prototype.dc.html` lines 134–169 (studio badge, slug, nav). **Drop** the "This week" summary cards (held-deposit + claim-window are v1.0). The "Day-of checklist" item renders present-but-disabled (Phase 7). This shell now wraps the whole `(owner)` group, including `/settings` — verify the wizard still renders acceptably (Step 4).

- [ ] **Step 1: Write the Sidebar client component**

```tsx
// app/(owner)/_components/Sidebar.tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { label: "Dashboard", href: "/dashboard", enabled: true },
  { label: "Day-of checklist", href: null, enabled: false }, // Phase 7
  { label: "Settings & policies", href: "/settings", enabled: true },
] as const;

export default function Sidebar({ studioName, slug }: { studioName: string | null; slug: string | null }) {
  const pathname = usePathname();
  return (
    <aside className="hidden w-60 shrink-0 flex-col gap-6 border-r border-owner-border bg-[#0e0f13] p-5 md:flex">
      <div className="flex items-center gap-3">
        <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-owner-accent to-[#4954d6]" />
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-owner-text">{studioName ?? "Your studio"}</div>
          {slug ? <div className="truncate font-mono text-[11px] text-owner-muted">/book/{slug}</div> : null}
        </div>
      </div>
      <nav className="flex flex-col gap-1">
        {NAV.map((item) => {
          const active = item.href != null && pathname.startsWith(item.href);
          const base = "rounded-lg px-3 py-2 text-sm";
          if (!item.enabled || item.href == null) {
            return (
              <span key={item.label} className={`${base} cursor-not-allowed text-owner-muted/50`} title="Coming in a later release">
                {item.label}
              </span>
            );
          }
          return (
            <Link
              key={item.label}
              href={item.href}
              className={`${base} ${active ? "bg-owner-panel text-owner-text" : "text-owner-muted hover:text-owner-text"}`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
```

- [ ] **Step 2: Rewrite the owner layout to the two-pane shell**

```tsx
// app/(owner)/layout.tsx
import { auth } from "@clerk/nextjs/server";
import { UserButton } from "@clerk/nextjs";
import { getDb } from "@/lib/db";
import { getStudioByClerkUserId } from "@/lib/studio";
import Sidebar from "./_components/Sidebar";

export default async function OwnerLayout({ children }: { children: React.ReactNode }) {
  const { userId } = await auth();
  const studio = userId ? await getStudioByClerkUserId(getDb(), userId) : null;

  return (
    <div className="flex min-h-screen bg-owner-bg text-owner-text">
      <Sidebar studioName={studio?.name ?? null} slug={studio?.slug ?? null} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-owner-border px-6 py-3">
          <span className="font-mono text-xs tracking-widest text-owner-muted">VENUEDASH</span>
          <UserButton />
        </header>
        <div className="flex-1 p-6">{children}</div>
      </div>
    </div>
  );
}
```

> Keep whatever imports the current `layout.tsx` already uses for `UserButton`/tokens; the above matches the file's existing Clerk import style.

- [ ] **Step 3: Verify build**

Run: `nvm use 20 && npm run typecheck && npm run lint && npm run build`
Expected: build succeeds; `/dashboard` and `/settings` compile.

- [ ] **Step 4: Render check (settings + dashboard shell)**

Run: `nvm use 20 && npm run dev` and open `/settings` and `/dashboard` (signed in), OR do an unauthenticated local render of the layout with a stubbed studio.
Expected: sidebar shows studio name + `/book/{slug}`, "Dashboard"/"Settings" navigate and highlight, "Day-of checklist" is visibly disabled, and the Phase-3 onboarding wizard at `/settings` still renders correctly inside the main pane (no clipped/overlapping fields).

- [ ] **Step 5: Commit**

```bash
git add "app/(owner)/layout.tsx" "app/(owner)/_components/Sidebar.tsx"
git commit -m "feat: owner two-pane sidebar shell (badge, slug, nav)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Dashboard — `page.tsx` + `MetricStrip` + `BookingRow` + `StateChip`

**Files:**
- Modify: `app/(owner)/dashboard/page.tsx`
- Create: `app/(owner)/_components/StateChip.tsx`
- Create: `app/(owner)/dashboard/_components/MetricStrip.tsx`
- Create: `app/(owner)/dashboard/_components/BookingRow.tsx`

**Interfaces:**
- Consumes: `auth` (`@clerk/nextjs/server`), `redirect` (`next/navigation`); `getDb`; `getStudioByClerkUserId`; `listBookingsForStudio`; `toBookingView`, `type BookingView`, `type DashboardGroup`, `type ChipTone` (`@/lib/domain/booking-view`); `formatAtlantaRange` (`@/lib/tz`); `CopyLinkButton` (`../_components/CopyLinkButton`).
- `StateChip({ label, tone }: { label: string; tone: ChipTone })` — shared chip, reused by the detail header (Task 8).
- The page builds `rows: { booking: Booking; view: BookingView }[]`, renders `MetricStrip` + three grouped sections, and preserves the Phase-3 empty state when there are zero bookings.

**Prototype fidelity:** grouped list + metric strip from `prototype/VenueDash_Prototype.dc.html` lines 177–285, adapted to the three v0.5 groups and money-free metrics (Global Constraints).

- [ ] **Step 1: Write the shared StateChip**

```tsx
// app/(owner)/_components/StateChip.tsx
import type { ChipTone } from "@/lib/domain/booking-view";

const TONE: Record<ChipTone, string> = {
  success: "border-[#1e6b3f] bg-[#0b1a10] text-success",
  warning: "border-[#5a4718] bg-[#1b1710] text-warning",
  danger: "border-[#5a2822] bg-[#1a0f0d] text-danger",
  muted: "border-owner-border bg-owner-panel-2 text-owner-muted",
};

export default function StateChip({ label, tone }: { label: string; tone: ChipTone }) {
  return (
    <span className={`inline-block rounded-full border px-2.5 py-1 text-[11px] font-medium ${TONE[tone]}`}>
      {label}
    </span>
  );
}
```

- [ ] **Step 2: Write MetricStrip**

```tsx
// app/(owner)/dashboard/_components/MetricStrip.tsx
import type { Booking } from "@/db/schema";
import type { BookingView } from "@/lib/domain/booking-view";

type Row = { booking: Booking; view: BookingView };

export default function MetricStrip({ rows }: { rows: Row[] }) {
  const needsAction = rows.filter((r) => r.view.group === "needs_action").length;
  const upcoming = rows.filter(
    (r) => r.view.effectiveState === "confirmed" || r.view.effectiveState === "event_day"
  ).length;
  const depositsToActOn = rows.filter(
    (r) => r.view.depositControlActive && r.booking.depositStatus !== "returned"
  ).length;

  const cards = [
    { label: "Needs action", value: needsAction },
    { label: "Upcoming", value: upcoming },
    { label: "Deposits to act on", value: depositsToActOn },
  ];
  return (
    <div className="mb-8 grid grid-cols-3 gap-3">
      {cards.map((c) => (
        <div key={c.label} className="rounded-xl border border-owner-border bg-owner-panel p-4">
          <div className="text-2xl font-semibold text-owner-text">{c.value}</div>
          <div className="mt-1 font-mono text-[11px] uppercase tracking-wider text-owner-muted">{c.label}</div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Write BookingRow**

```tsx
// app/(owner)/dashboard/_components/BookingRow.tsx
import Link from "next/link";
import type { Booking } from "@/db/schema";
import type { BookingView } from "@/lib/domain/booking-view";
import { formatAtlantaRange } from "@/lib/tz";
import StateChip from "../../_components/StateChip";

const ACTION_HINT: Record<string, string> = {
  approve: "Review request",
  mark_signed: "Mark signed",
};

export default function BookingRow({ booking, view }: { booking: Booking; view: BookingView }) {
  const title = booking.eventType ?? "Event request";
  const hint = view.legalActions.map((a) => ACTION_HINT[a]).find(Boolean);
  return (
    <Link
      href={`/dashboard/bookings/${booking.id}`}
      className="flex items-center gap-3 rounded-lg border border-owner-border bg-owner-panel px-4 py-3 hover:border-[#3a3d4a] hover:bg-[#1a1c23]"
    >
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-owner-text">{title}</div>
        <div className="truncate text-xs text-owner-muted">
          {booking.renterName} · {formatAtlantaRange(booking.startsAt, booking.endsAt)}
        </div>
      </div>
      <StateChip label={view.chip.label} tone={view.chip.tone} />
      {hint ? <span className="hidden text-xs text-owner-muted sm:inline">{hint}</span> : null}
      <span className="text-owner-muted">›</span>
    </Link>
  );
}
```

- [ ] **Step 4: Rewrite the dashboard page**

```tsx
// app/(owner)/dashboard/page.tsx
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getDb } from "@/lib/db";
import { getStudioByClerkUserId } from "@/lib/studio";
import { listBookingsForStudio } from "@/lib/booking";
import { toBookingView, type DashboardGroup } from "@/lib/domain/booking-view";
import CopyLinkButton from "../_components/CopyLinkButton";
import MetricStrip from "./_components/MetricStrip";
import BookingRow from "./_components/BookingRow";

const GROUPS: { key: DashboardGroup; title: string }[] = [
  { key: "needs_action", title: "Needs your action" },
  { key: "in_progress", title: "In progress" },
  { key: "past", title: "Past" },
];

export default async function DashboardPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");
  const db = getDb();
  const studio = await getStudioByClerkUserId(db, userId);
  if (!studio) redirect("/settings");

  const bookings = await listBookingsForStudio(db, studio.id);
  const now = new Date();
  const rows = bookings.map((b) => ({ booking: b, view: toBookingView(b, now) }));

  const today = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", weekday: "long", month: "long", day: "numeric",
  }).format(now);

  return (
    <main className="mx-auto max-w-3xl">
      <header className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="font-serif text-3xl text-owner-text">Dashboard</h1>
          <p className="mt-1 text-sm text-owner-muted">{today} · Atlanta</p>
        </div>
        <CopyLinkButton slug={studio.slug} />
      </header>

      {rows.length === 0 ? (
        <section className="rounded-xl border border-[#1e4a2c] bg-[#101a12] p-6">
          <div className="text-xs font-semibold uppercase tracking-wider text-success">Share your booking link</div>
          <p className="mt-2 text-sm text-owner-muted">
            Send renters to <span className="font-mono text-owner-text">/book/{studio.slug}</span>. Requests land here.
          </p>
          <div className="mt-4"><CopyLinkButton slug={studio.slug} /></div>
          <Link href="/settings" className="mt-4 inline-block text-sm text-owner-accent">Edit studio settings →</Link>
        </section>
      ) : (
        <>
          <MetricStrip rows={rows} />
          {GROUPS.map(({ key, title }) => {
            let items = rows.filter((r) => r.view.group === key);
            if (items.length === 0) return null;
            // Needs-action & in-progress: soonest first (already asc). Past: most recent first.
            if (key === "past") items = [...items].reverse();
            return (
              <section key={key} className="mb-8">
                <div className="mb-3 flex items-center gap-2">
                  <h2 className="font-mono text-[11px] uppercase tracking-wider text-owner-muted">{title}</h2>
                  <span className="rounded-full bg-owner-panel-2 px-2 py-0.5 text-[11px] text-owner-muted">{items.length}</span>
                </div>
                <div className="flex flex-col gap-2">
                  {items.map((r) => <BookingRow key={r.booking.id} booking={r.booking} view={r.view} />)}
                </div>
              </section>
            );
          })}
        </>
      )}
    </main>
  );
}
```

- [ ] **Step 5: Verify build + render**

Run: `nvm use 20 && npm run typecheck && npm run lint && npm run build`
Expected: build succeeds.
Then render `/dashboard` against the seeded DB (signed in as the Westview owner): three sections populate from the 10 seeded bookings, metric counts are non-zero, rows link to `/dashboard/bookings/[id]`.

- [ ] **Step 6: Commit**

```bash
git add "app/(owner)/dashboard/page.tsx" "app/(owner)/_components/StateChip.tsx" "app/(owner)/dashboard/_components/MetricStrip.tsx" "app/(owner)/dashboard/_components/BookingRow.tsx"
git commit -m "feat: owner dashboard — metric strip + grouped booking list

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Booking detail — server page (`page.tsx` + `LifecycleRail`)

**Files:**
- Create: `app/(owner)/dashboard/bookings/[id]/page.tsx`
- Create: `app/(owner)/dashboard/bookings/[id]/_components/LifecycleRail.tsx`

**Interfaces:**
- Consumes: `auth` (`@clerk/nextjs/server`), `redirect`/`notFound` (`next/navigation`), `Link`; `getDb`; `getStudioByClerkUserId`; `getBookingForOwner`, `getBookingEvents` (`@/lib/booking`); `toBookingView` (`@/lib/domain/booking-view`); `BOOKING_STATES`, `type BookingState` (`@/lib/domain/states`); `formatAtlantaRange` (`@/lib/tz`); `formatCents` (`@/lib/money`); `StateChip`; the client action components from Task 9 (`ActionButtons`, `DepositControl`) — imported here but authored next task.
- `LifecycleRail({ current, events }: { current: BookingState; events: { toState: BookingState }[] })` — renders the linear spine with `current` highlighted; off-spine terminals (`declined`/`canceled`) shown as the endpoint.

**Prototype fidelity:** header + two-column body + lifecycle rail + status grid from `prototype/VenueDash_Prototype.dc.html` lines 289–426. **Drop** the COI card and any claim/held-deposit copy (Global Constraints). This task builds the read-only presentation and wires the rail; the interactive controls (Task 9) are placed as `<ActionButtons>` / `<DepositControl>` slots.

- [ ] **Step 1: Write LifecycleRail**

```tsx
// app/(owner)/dashboard/bookings/[id]/_components/LifecycleRail.tsx
import { BOOKING_STATES, type BookingState } from "@/lib/domain/states";

const SPINE: BookingState[] = [
  "pending", "awaiting_contract", "awaiting_signature",
  "confirmed", "event_day", "post_event", "closed",
];
const LABEL: Record<BookingState, string> = {
  pending: "Requested",
  awaiting_contract: "Approved",
  awaiting_signature: "Contract sent",
  confirmed: "Confirmed",
  event_day: "Event day",
  post_event: "Wrap-up",
  closed: "Closed",
  declined: "Declined",
  canceled: "Canceled",
};

export default function LifecycleRail({
  current, events,
}: { current: BookingState; events: { toState: BookingState }[] }) {
  const terminalOffSpine = current === "declined" || current === "canceled";
  const reached = new Set<BookingState>(events.map((e) => e.toState));
  reached.add(current);
  const currentIdx = SPINE.indexOf(current);

  return (
    <div className="rounded-xl border border-[#1d1e24] bg-[#121317] p-4">
      <div className="mb-3 font-mono text-[10px] uppercase tracking-wider text-owner-muted">Booking lifecycle</div>
      <ol className="flex flex-col gap-3">
        {SPINE.map((state, i) => {
          const isPast = currentIdx >= 0 && i < currentIdx;
          const isCurrent = state === current;
          const dot = isCurrent
            ? "bg-owner-accent ring-2 ring-owner-accent/40"
            : isPast || reached.has(state) ? "bg-success" : "bg-[#2a2b31]";
          const text = isCurrent ? "text-owner-text font-semibold"
            : isPast || reached.has(state) ? "text-owner-muted" : "text-[#5e6070]";
          return (
            <li key={state} className="flex items-center gap-3">
              <span className={`h-2.5 w-2.5 rounded-full ${dot}`} />
              <span className={`text-xs ${text}`}>{LABEL[state]}</span>
            </li>
          );
        })}
        {terminalOffSpine ? (
          <li className="mt-1 flex items-center gap-3 border-t border-[#1d1e24] pt-3">
            <span className="h-2.5 w-2.5 rounded-full bg-danger ring-2 ring-danger/40" />
            <span className="text-xs font-semibold text-danger">{LABEL[current]}</span>
          </li>
        ) : null}
      </ol>
    </div>
  );
}
```

> `BOOKING_STATES` is imported for the exhaustiveness of `LABEL` (every state keyed); if lint flags it as unused, drop the import and keep `LABEL` as the exhaustive `Record`.

- [ ] **Step 2: Write the detail page**

```tsx
// app/(owner)/dashboard/bookings/[id]/page.tsx
import { auth } from "@clerk/nextjs/server";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getDb } from "@/lib/db";
import { getStudioByClerkUserId } from "@/lib/studio";
import { getBookingForOwner, getBookingEvents } from "@/lib/booking";
import { toBookingView } from "@/lib/domain/booking-view";
import { formatAtlantaRange } from "@/lib/tz";
import { formatCents } from "@/lib/money";
import StateChip from "../../../_components/StateChip";
import LifecycleRail from "./_components/LifecycleRail";
import ActionButtons from "./_components/ActionButtons";
import DepositControl from "./_components/DepositControl";
import { DEPOSIT_LABELS } from "./forms";

export default async function BookingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");
  const db = getDb();
  const studio = await getStudioByClerkUserId(db, userId);
  if (!studio) redirect("/settings");

  const booking = await getBookingForOwner(db, id, studio.id);
  if (!booking) notFound();
  const events = await getBookingEvents(db, id);
  const view = toBookingView(booking, new Date());
  const snap = (booking.rateSnapshot ?? {}) as Record<string, unknown>;

  return (
    <main className="mx-auto max-w-4xl">
      <Link href="/dashboard" className="text-sm text-owner-muted hover:text-owner-text">← Dashboard</Link>

      <header className="mt-3 flex items-start justify-between">
        <div>
          <h1 className="font-serif text-3xl text-owner-text">{booking.eventType ?? "Event request"}</h1>
          <p className="mt-1 text-sm text-owner-muted">
            {booking.renterName} · {booking.renterEmail}{booking.renterPhone ? ` · ${booking.renterPhone}` : ""}
          </p>
        </div>
        <StateChip label={view.chip.label} tone={view.chip.tone} />
      </header>

      <div className="mt-3 flex flex-wrap gap-2 font-mono text-[11px] text-owner-muted">
        <span className="rounded border border-owner-border px-2 py-1">{formatAtlantaRange(booking.startsAt, booking.endsAt)}</span>
        {booking.headcount != null ? <span className="rounded border border-owner-border px-2 py-1">{booking.headcount} guests</span> : null}
        <span className="rounded border border-owner-border px-2 py-1">{booking.byob ? "BYOB" : "No BYOB"}</span>
        <span className="rounded border border-owner-border px-2 py-1">{booking.outsideVendors ? "Outside vendors" : "In-house only"}</span>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-[240px_1fr]">
        <LifecycleRail current={view.effectiveState} events={events} />

        <div className="flex flex-col gap-4">
          {/* Primary action card, by effective state */}
          {view.effectiveState === "pending" ? (
            <div className="rounded-xl border border-[#4a3a1a] bg-[#1b1710] p-4">
              <div className="font-mono text-[10px] uppercase tracking-wider text-warning">New booking request</div>
              <p className="mt-2 text-sm text-owner-text">
                {booking.renterName} requested this date. Approving moves it toward the contract step.
              </p>
              <div className="mt-4"><ActionButtons bookingId={booking.id} actions={view.legalActions} /></div>
            </div>
          ) : null}

          {view.effectiveState === "awaiting_contract" ? (
            <div className="rounded-xl border border-owner-border bg-owner-panel p-4">
              <div className="font-mono text-[10px] uppercase tracking-wider text-owner-muted">Contract</div>
              <p className="mt-2 text-sm text-owner-muted">Contract generation arrives in the next release. Approved and waiting.</p>
              <div className="mt-4"><ActionButtons bookingId={booking.id} actions={view.legalActions} /></div>
            </div>
          ) : null}

          {view.effectiveState === "awaiting_signature" ? (
            <div className="rounded-xl border border-owner-border bg-owner-panel p-4">
              <div className="font-mono text-[10px] uppercase tracking-wider text-owner-muted">Signature</div>
              <p className="mt-2 text-sm text-owner-text">Once the renter has signed the rental agreement, mark it signed to confirm.</p>
              <div className="mt-4"><ActionButtons bookingId={booking.id} actions={view.legalActions} /></div>
            </div>
          ) : null}

          {view.effectiveState === "confirmed" ? (
            <div className="rounded-xl border border-[#1e6b3f] bg-[#0b1a10] p-4">
              <div className="font-mono text-[10px] uppercase tracking-wider text-success">Confirmed</div>
              <p className="mt-2 text-sm text-owner-text">This booking is confirmed. Cancel below if plans change before the event.</p>
              <div className="mt-4"><ActionButtons bookingId={booking.id} actions={view.legalActions} /></div>
            </div>
          ) : null}

          {view.effectiveState === "event_day" ? (
            <div className="rounded-xl border border-[#4a3a1a] bg-[#1b1710] p-4">
              <div className="font-mono text-[10px] uppercase tracking-wider text-warning">Event today</div>
              <p className="mt-2 text-sm text-owner-text">The walkthrough checklist arrives in a later release.</p>
            </div>
          ) : null}

          {view.effectiveState === "post_event" ? (
            <div className="rounded-xl border border-owner-border bg-owner-panel p-4">
              <div className="font-mono text-[10px] uppercase tracking-wider text-owner-muted">Event finished</div>
              <p className="mt-2 text-sm text-owner-text">If everything checked out, return the renter&rsquo;s deposit and update its status below.</p>
            </div>
          ) : null}

          {/* Intake + agreed terms (always useful for the owner) */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-owner-border bg-owner-panel p-4">
              <div className="font-mono text-[10px] uppercase tracking-wider text-owner-muted">Intake details</div>
              <dl className="mt-2 space-y-1 text-sm text-owner-text">
                <div>Event type — {booking.eventType ?? "—"}</div>
                <div>Estimated headcount — {booking.headcount ?? "—"}</div>
                <div>{booking.byob ? "BYOB" : "No BYOB"} · {booking.outsideVendors ? "Outside vendors" : "In-house only"}</div>
                {booking.notes ? <div className="text-owner-muted">&ldquo;{booking.notes}&rdquo;</div> : null}
              </dl>
            </div>
            <div className="rounded-xl border border-owner-border bg-owner-panel p-4">
              <div className="font-mono text-[10px] uppercase tracking-wider text-owner-muted">Agreed terms</div>
              <dl className="mt-2 space-y-1 text-sm text-owner-text">
                <div>Rate — {snap.hourlyRateCents != null ? `${formatCents(Number(snap.hourlyRateCents))}/hr` : "—"}</div>
                <div>Minimum — {snap.minHours != null ? `${snap.minHours} hrs` : "—"}</div>
                <div>Deposit — {booking.depositCents != null ? formatCents(booking.depositCents) : "—"}</div>
                <div>Alcohol — {(snap.alcoholPolicy as string) ?? "—"}</div>
                <div>Vendors — {(snap.vendorPolicy as string) ?? "—"}</div>
              </dl>
            </div>
          </div>

          {/* Status grid — Contract / Deposit / Documentation (COI dropped for v0.5) */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="rounded-xl border border-owner-border bg-owner-panel p-4">
              <div className="font-mono text-[10px] uppercase tracking-wider text-owner-muted">Contract</div>
              <p className="mt-2 text-sm text-owner-muted">Standard Event Rental · GA jurisdiction · generated next release.</p>
            </div>
            <div className="rounded-xl border border-owner-border bg-owner-panel p-4">
              <div className="font-mono text-[10px] uppercase tracking-wider text-owner-muted">Damage deposit</div>
              <p className="mt-2 text-sm text-owner-text">
                {booking.depositCents != null ? formatCents(booking.depositCents) : "—"} · arranged with the studio directly
              </p>
              {view.depositControlActive ? (
                <div className="mt-3"><DepositControl bookingId={booking.id} current={booking.depositStatus} /></div>
              ) : (
                <p className="mt-2 text-xs text-owner-muted">Status: {DEPOSIT_LABELS[booking.depositStatus]}</p>
              )}
            </div>
            <div className="rounded-xl border border-owner-border bg-owner-panel p-4">
              <div className="font-mono text-[10px] uppercase tracking-wider text-owner-muted">Documentation</div>
              <p className="mt-2 text-sm text-owner-muted">Pre/post walkthrough — timestamped documentation, in a later release.</p>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
```

> The `../../../_components/StateChip` import depth assumes `app/(owner)/dashboard/bookings/[id]/page.tsx` → `app/(owner)/_components/StateChip.tsx`. Verify the relative depth when the file lands (typecheck will catch a wrong path).

- [ ] **Step 3: Verify build**

Run: `nvm use 20 && npm run typecheck && npm run lint`
Expected: no errors. (`ActionButtons`/`DepositControl` are created in Task 9 — if implementing strictly task-by-task, add minimal stub components first, or implement Task 9 before running the full build. Recommended: implement Task 9 immediately, then build once at the end of Task 9.)

- [ ] **Step 4: Commit**

```bash
git add "app/(owner)/dashboard/bookings/[id]/page.tsx" "app/(owner)/dashboard/bookings/[id]/_components/LifecycleRail.tsx"
git commit -m "feat: booking detail — lifecycle rail, intake/terms panels, status grid

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Booking detail — interactive controls (`ActionButtons` + `DepositControl`)

**Files:**
- Create: `app/(owner)/dashboard/bookings/[id]/_components/ActionButtons.tsx`
- Create: `app/(owner)/dashboard/bookings/[id]/_components/DepositControl.tsx`

**Interfaces:**
- Consumes: `useActionState` (`react`); the actions from `../actions`; `BOOKING_ACTION_IDLE`, `DEPOSIT_STATUSES`, `DEPOSIT_LABELS` (`../forms`); `type DepositStatus` (`@/lib/booking`); `type OwnerAction` (`@/lib/domain/booking-view`).
- `ActionButtons({ bookingId, actions }: { bookingId: string; actions: OwnerAction[] })` — renders one button per legal action, each its own `<form>` bound to the matching action; shows inline error + pending state.
- `DepositControl({ bookingId, current }: { bookingId: string; current: DepositStatus })` — three-way segmented control; posts `setDeposit` with a hidden `status`.

- [ ] **Step 1: Write ActionButtons**

```tsx
// app/(owner)/dashboard/bookings/[id]/_components/ActionButtons.tsx
"use client";

import { useActionState } from "react";
import type { OwnerAction } from "@/lib/domain/booking-view";
import {
  approveBooking, declineBooking, cancelBooking, markSigned,
} from "../actions";
import { BOOKING_ACTION_IDLE, type BookingActionState } from "../forms";

type Bound = (prev: BookingActionState, fd: FormData) => Promise<BookingActionState>;

const META: Record<OwnerAction, { label: string; className: string; fn: (id: string) => Bound }> = {
  approve: { label: "Approve request", className: "bg-success text-[#08130c]", fn: (id) => approveBooking.bind(null, id) },
  mark_signed: { label: "Mark contract signed", className: "bg-owner-accent text-[#0d0e14]", fn: (id) => markSigned.bind(null, id) },
  decline: { label: "Decline", className: "border border-owner-border text-owner-muted", fn: (id) => declineBooking.bind(null, id) },
  cancel: { label: "Cancel booking", className: "border border-[#5a2822] text-danger", fn: (id) => cancelBooking.bind(null, id) },
};

function OneButton({ bookingId, action }: { bookingId: string; action: OwnerAction }) {
  const meta = META[action];
  const [state, formAction, pending] = useActionState<BookingActionState, FormData>(
    meta.fn(bookingId), BOOKING_ACTION_IDLE
  );
  return (
    <form action={formAction} className="inline-flex flex-col">
      <button
        type="submit"
        disabled={pending}
        className={`rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50 ${meta.className}`}
      >
        {pending ? "Working…" : meta.label}
      </button>
      {state.status === "error" ? <span className="mt-1 text-xs text-danger">{state.error}</span> : null}
    </form>
  );
}

export default function ActionButtons({ bookingId, actions }: { bookingId: string; actions: OwnerAction[] }) {
  if (actions.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {actions.map((a) => <OneButton key={a} bookingId={bookingId} action={a} />)}
    </div>
  );
}
```

- [ ] **Step 2: Write DepositControl**

```tsx
// app/(owner)/dashboard/bookings/[id]/_components/DepositControl.tsx
"use client";

import { useActionState } from "react";
import type { DepositStatus } from "@/lib/booking";
import { setDeposit } from "../actions";
import { BOOKING_ACTION_IDLE, DEPOSIT_STATUSES, DEPOSIT_LABELS, type BookingActionState } from "../forms";

export default function DepositControl({
  bookingId, current,
}: { bookingId: string; current: DepositStatus }) {
  const [state, formAction, pending] = useActionState<BookingActionState, FormData>(
    setDeposit.bind(null, bookingId), BOOKING_ACTION_IDLE
  );
  return (
    <div>
      <div className="inline-flex overflow-hidden rounded-lg border border-owner-border">
        {DEPOSIT_STATUSES.map((s) => (
          <form key={s} action={formAction}>
            <input type="hidden" name="status" value={s} />
            <button
              type="submit"
              disabled={pending || s === current}
              className={`px-3 py-1.5 text-xs ${s === current ? "bg-owner-accent text-[#0d0e14]" : "text-owner-muted hover:text-owner-text"} disabled:opacity-60`}
            >
              {DEPOSIT_LABELS[s]}
            </button>
          </form>
        ))}
      </div>
      {state.status === "error" ? <p className="mt-1 text-xs text-danger">{state.error}</p> : null}
    </div>
  );
}
```

> The three `<form>`s share one `formAction`; the disabled state on the current value prevents a no-op submit. If side-by-side forms cause layout gaps, wrap the buttons in a single flex row (the shared-input width rule still applies — don't add `w-full`).

- [ ] **Step 3: Verify build**

Run: `nvm use 20 && npm run typecheck && npm run lint && npm run build`
Expected: build succeeds; the detail route and both client components compile.

- [ ] **Step 4: Render + interaction check**

Render `/dashboard/bookings/[id]` for representative seeded bookings (signed in as the Westview owner):
- **pending** (Maya Reeves) → Approve/Decline present; approving moves it to the awaiting-contract presentation.
- **awaiting_signature** (Kelvin Odom) → "Mark contract signed" present; marking it lands `confirmed` with the deposit control now active.
- **confirmed** (Dana Nguyen) → Cancel present; deposit segmented control switches `uncollected/collected/returned`.
- **event_day** (Jordan Carter) / **post_event** (Andre Brooks) → no cancel; deposit control active; no held-deposit/claim copy.
- **declined/canceled/closed** → terminal presentation, rail shows the terminal marker.

Expected: each action updates state on the same page (revalidated); no console errors; copy is v0.5-truthful throughout.

- [ ] **Step 5: Commit**

```bash
git add "app/(owner)/dashboard/bookings/[id]/_components/ActionButtons.tsx" "app/(owner)/dashboard/bookings/[id]/_components/DepositControl.tsx"
git commit -m "feat: booking-detail interactive controls (action buttons + deposit segmented control)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Final verification + PR

**Files:** none (verification + docs).

- [ ] **Step 1: Full gate suite**

Run: `nvm use 20 && npm run lint && npm run typecheck && npm run test && npm run build`
Expected: all green. Note the total test count (Phase 4 ended at 167; Phase 5 adds the booking-view, forms, and booking-helper suites).

- [ ] **Step 2: Discipline greps**

Run:
```bash
grep -rn "bookings.state" app lib --include=*.ts --include=*.tsx | grep -v "transitionBooking\|eq(bookings.state\|notInArray(bookings.state"
grep -rni "held by venuedash\|immutable evidence\|per occurrence\|auto-refund\|escrow" app emails
```
Expected: first grep shows no direct `bookings.state` writes outside `transitionBooking`; second shows no forbidden copy.

- [ ] **Step 3: Re-seed + authenticated preview walk**

Run: `nvm use 20 && npm run db:seed` (against dev Neon), then on the preview/dev deploy signed in as the Westview owner, walk: dashboard groups render → open a `pending` booking → Approve → open Kelvin's `awaiting_signature` → Mark signed → confirm deposit control cycles → confirm a foreign booking id 404s (`/dashboard/bookings/<random-uuid>`). This is the "render, don't curl" gate.

- [ ] **Step 4: Update the progress ledger**

Append a Phase 5 section to `.superpowers/sdd/progress.md` (plan path, branch `feat/phase-5-owner-dashboard`, task log, review outcomes).

- [ ] **Step 5: Open the PR**

```bash
git push -u origin feat/phase-5-owner-dashboard
gh pr create --title "Phase 5 — Owner dashboard + booking detail" --body "$(cat <<'EOF'
Implements v0.5 spec §5 Phase 5: the owner's side of the state machine.

- Grouped dashboard (Needs action / In progress / Past) + money-free metric strip
- Booking detail: lifecycle rail, state-derived action cards, agreed-terms/intake panels, status grid
- Owner actions via transitionBooking (approve/decline/cancel/mark-signed) + manual deposit-status control
- Two-pane owner sidebar shell
- Pure booking view-model (effective state, group, legal actions) — unit-tested; DB helpers PGlite-tested
- Seed rateSnapshot aligned to full TermsSnapshot

Deferred (documented in spec §8): "Waiting on renter" group (v1.0 renter-side signing), clock-state persistence + close-out, deposit audit history.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 6: Whole-branch review**

Dispatch the final whole-branch review (opus) per the SDD process; fix any Critical/Important before merge. Confirm preview-deploy checks green.

---

## Self-review notes (author)

- **Spec coverage:** §3 routes → Tasks 7–8; §4 view-model → Task 2; §5a dashboard → Tasks 6–7; §5b detail → Tasks 8–9; §6 actions/errors → Task 5; §7 helpers + seed → Tasks 1, 3; §8 deferred → PR body + not built; §9 testing → Tasks 2–4 (unit/PGlite) + 6–9 (render) + 10 (gates/discipline). ✅
- **Type consistency:** `BookingView`/`OwnerAction`/`DashboardGroup`/`ChipTone` defined in Task 2 and consumed unchanged in Tasks 5–9; `DepositStatus` defined in Task 3, consumed in Tasks 4/5/9; `BookingActionState`/`BOOKING_ACTION_IDLE` defined in Task 4, consumed in Tasks 5/9. ✅
- **Known cross-task build ordering:** Task 8's page imports Task 9's client components — flagged in Task 8 Step 3 (implement 9 before the full build). ✅
