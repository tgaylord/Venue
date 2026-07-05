# VenueDash Phase 2 — Domain Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the product's spine — full v0.5 schema, the trimmed booking state machine behind a transactional `transitionBooking` with an append-only audit log, renter tokens, effective-state derivation, and a seeded dev database — proven by a full transition-matrix test suite on PGlite.

**Architecture:** `db/schema.ts` gains all 10 v0.5 tables (one generated migration). `lib/db.ts` switches from the Neon HTTP driver to the Neon websocket `Pool` driver so `db.transaction()` works. Domain logic lives in `lib/domain/` (states data table, transition module, effective-state derivation) plus `lib/tokens.ts`; all DB-touching functions take the Drizzle handle as a parameter so tests inject an in-memory PGlite database that runs the real generated migrations.

**Tech Stack:** Drizzle ORM 0.45 (`neon-serverless` + `pglite` adapters, both ship in the installed package) · `@neondatabase/serverless` 1.1 Pool + `ws` · `@electric-sql/pglite` (devDependency) · node:crypto · Vitest · tsx.

## Global Constraints

_Copied from the Phase 2 spec (`docs/specs/2026-07-05-venuedash-phase-2-domain-core-design.md`) and v0.5 spec. Every task's requirements implicitly include this section._

- **Work on branch `feat/phase-2-domain-core`** (already exists, contains the spec). Ships as one PR.
- **Use Node 20:** prefix EVERY npm command with `source ~/.nvm/nvm.sh && nvm use 20 && `. The default shell Node is 24 and engine-strict rejects it.
- **New dependencies allowed (exactly these):** `ws` + `@types/ws` (required by the Neon Pool driver on Node 20) and `@electric-sql/pglite` (devDependency). Nothing else.
- **Do NOT touch** `prototype/`, `app/(marketing)`, `app/(public)`, `app/(owner)`, `proxy.ts`.
- **State discipline:** no code path outside `transitionBooking()` writes `bookings.state`. (Test fixtures may insert rows *with* an initial state; they may not update state afterwards except via `transitionBooking`.)
- **Audit discipline:** `booking_events` is append-only — no exported update/delete path, ever.
- **The 9 v0.5 states (exact strings):** `pending`, `declined`, `awaiting_contract`, `awaiting_signature`, `confirmed`, `event_day`, `post_event`, `closed`, `canceled`.
- **Legal transitions (exact, from the spec §4):** pending→declined|awaiting_contract; awaiting_contract→awaiting_signature; awaiting_signature→confirmed; confirmed→event_day; event_day→post_event; post_event→closed; pending|awaiting_contract|awaiting_signature|confirmed→canceled; declined/closed/canceled terminal.
- **Tables NOT created:** `deposits`, `coi_documents`, `claims` (v1.0). `studios` has **no** `stripe_account_id`; `contracts` has **no** `envelope_id`.
- **Tokens:** 32 random bytes, base64url raw token returned; only SHA-256 hex hash stored; unique active token per `(booking_id, purpose)`; re-mint rotates.
- **Tests must run in CI with no secrets** (PGlite in-memory). The existing 15 tests keep passing.
- **`.env.local` has a real `DATABASE_URL`** for the dev-DB steps (migrate, seed, healthcheck) — those steps run locally, never in CI.

---

## File Structure

```
package.json                       → deps (ws, @types/ws, pglite) + db:seed script
lib/db.ts                          → MODIFY: neon-http → neon-serverless Pool (+ ws)
scripts/db-healthcheck.ts          → MODIFY: query via pool, then pool.end()
db/schema.ts                       → REPLACE: full v0.5 schema (10 tables, 7 enums)
drizzle/0000_*.sql (+meta)         → generated migration
lib/domain/test-db.ts              → PGlite factory applying real migrations (test-only helper)
lib/domain/test-db.test.ts         → schema smoke test
lib/domain/states.ts               → BOOKING_STATES, BookingState, LEGAL_TRANSITIONS
lib/domain/states.test.ts          → transition-table shape tests (pure)
lib/domain/effective-state.ts      → deriveEffectiveState (pure)
lib/domain/effective-state.test.ts → boundary tests (pure)
lib/domain/transitions.ts          → transitionBooking + errors + hook registry
lib/domain/transitions.test.ts     → full 9×9 matrix + CAS + hooks (PGlite)
lib/tokens.ts                      → mintRenterToken / verifyRenterToken
lib/tokens.test.ts                 → mint/verify/rotate/expiry (PGlite)
scripts/seed.ts                    → Westview Studio + 10 bookings, all 9 states
```

---

### Task 1: Switch `lib/db.ts` to the Neon websocket Pool driver

**Files:**
- Modify: `lib/db.ts`, `scripts/db-healthcheck.ts`, `package.json` (deps)

**Interfaces:**
- Consumes: existing `db/schema.ts` (still empty), `.env.local` `DATABASE_URL`.
- Produces (used by every later task): `lib/db.ts` exports `export const db` (a `drizzle-orm/neon-serverless` database with `{ schema }`) and `export const pool` (the Neon `Pool`). The old `sql` export is removed.

- [ ] **Step 1: Install the websocket dependency**

Run:
```bash
source ~/.nvm/nvm.sh && nvm use 20 && npm install ws && npm install -D @types/ws
```

- [ ] **Step 2: Replace `lib/db.ts`**

```ts
import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import ws from "ws";
import * as schema from "@/db/schema";

// Node 20 has no stable global WebSocket; the Neon Pool needs one.
neonConfig.webSocketConstructor = ws;

function requiredUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  return url;
}

// Lazy singletons: nothing connects (or throws) at import time, so builds
// and CI (no DATABASE_URL) stay green until a query actually runs.
let _pool: Pool | undefined;
export function getPool(): Pool {
  return (_pool ??= new Pool({ connectionString: requiredUrl() }));
}

let _db: ReturnType<typeof drizzle<typeof schema>> | undefined;
export function getDb() {
  return (_db ??= drizzle(getPool(), { schema }));
}
```

Note: Phase 0's closeout made `db.ts` lazy for exactly this reason (CI has no `DATABASE_URL`) — preserve that property. Callers use `getDb()` / `getPool()`.

- [ ] **Step 3: Update `scripts/db-healthcheck.ts`**

```ts
import { getDb, getPool } from "@/lib/db";
import { sql } from "drizzle-orm";

async function main() {
  const result = await getDb().execute(sql`SELECT 1 AS ok`);
  const row = result.rows[0] as { ok: number } | undefined;
  if (row?.ok !== 1) throw new Error("Healthcheck failed");
  console.log("DB healthcheck OK:", row);
  await getPool().end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 4: Fix any other importers of the removed exports**

Run: `grep -rn "from \"@/lib/db\"" --include="*.ts" --include="*.tsx" app lib scripts`
Expected: only `scripts/db-healthcheck.ts` (already updated). If anything else imports `db` or `sql` from `@/lib/db`, update it to `getDb()`.

- [ ] **Step 5: Verify healthcheck against the real dev DB**

Run: `source ~/.nvm/nvm.sh && nvm use 20 && npm run db:healthcheck`
Expected: `DB healthcheck OK: { ok: 1 }` and the process exits (no hang — that's what `pool.end()` is for).

- [ ] **Step 6: Verify the four gates**

Run: `source ~/.nvm/nvm.sh && nvm use 20 && npm run lint && npm run typecheck && npm test && npm run build`
Expected: all pass (15 existing tests; build has no page importing db, so lazy init keeps it green).

- [ ] **Step 7: Commit**

```bash
git add lib/db.ts scripts/db-healthcheck.ts package.json package-lock.json
git commit -m "feat: switch db client to Neon websocket Pool driver (transactions)"
```

---

### Task 2: Full v0.5 schema + migration + PGlite test helper

**Files:**
- Replace: `db/schema.ts`
- Create: `lib/domain/test-db.ts`, `lib/domain/test-db.test.ts`
- Create (generated): `drizzle/0000_*.sql`, `drizzle/meta/*`
- Modify: `package.json` (pglite devDependency)

**Interfaces:**
- Consumes: `drizzle.config.ts` (existing, points at `db/schema.ts` → `./drizzle`).
- Produces (used by Tasks 4–6):
  - All table objects from `@/db/schema`: `studios`, `spaces`, `checklistItems`, `availabilityBlocks`, `bookings`, `bookingEvents`, `walkthroughs`, `walkthroughPhotos`, `contracts`, `renterTokens`, plus `bookingStateEnum`.
  - Row types: `type Booking = typeof bookings.$inferSelect`.
  - `createTestDb(): Promise<{ db: TestDb; close: () => Promise<void> }>` from `@/lib/domain/test-db` — an in-memory PGlite drizzle instance with the real migrations applied.

- [ ] **Step 1: Install PGlite**

Run: `source ~/.nvm/nvm.sh && nvm use 20 && npm install -D @electric-sql/pglite`

- [ ] **Step 2: Replace `db/schema.ts` with the full v0.5 schema**

```ts
import {
  pgTable, pgEnum, text, uuid, integer, boolean, timestamp, jsonb,
  doublePrecision, uniqueIndex,
} from "drizzle-orm/pg-core";

// ── Enums ────────────────────────────────────────────────────────────────
export const bookingStateEnum = pgEnum("booking_state", [
  "pending", "declined", "awaiting_contract", "awaiting_signature",
  "confirmed", "event_day", "post_event", "closed", "canceled",
]);
export const actorTypeEnum = pgEnum("actor_type", ["owner", "renter", "system"]);
export const depositStatusEnum = pgEnum("deposit_status", ["uncollected", "collected", "returned"]);
export const availabilitySourceEnum = pgEnum("availability_source", ["booking", "manual", "buffer"]);
export const walkthroughKindEnum = pgEnum("walkthrough_kind", ["pre", "post"]);
export const contractTemplateEnum = pgEnum("contract_template", ["standard"]);
export const contractStatusEnum = pgEnum("contract_status", ["sent", "signed", "voided"]);

// ── Studio & configuration ───────────────────────────────────────────────
export const studios = pgTable("studios", {
  id: uuid("id").primaryKey().defaultRandom(),
  clerkUserId: text("clerk_user_id").notNull().unique(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  address: text("address"),
  description: text("description"),
  equipmentList: text("equipment_list"),
  hourlyRateCents: integer("hourly_rate_cents"),
  minHours: integer("min_hours"),
  depositCents: integer("deposit_cents"),
  coiRequired: boolean("coi_required").notNull().default(false),
  alcoholPolicy: text("alcohol_policy"),
  vendorPolicy: text("vendor_policy"),
  noiseCurfew: text("noise_curfew"),
  cleanupWindowMin: integer("cleanup_window_min"),
  cancellationLadder: jsonb("cancellation_ladder"),
  onboardingCompletedAt: timestamp("onboarding_completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const spaces = pgTable("spaces", {
  id: uuid("id").primaryKey().defaultRandom(),
  studioId: uuid("studio_id").notNull().references(() => studios.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  maxOccupancy: integer("max_occupancy"),
});

export const checklistItems = pgTable("checklist_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  studioId: uuid("studio_id").notNull().references(() => studios.id, { onDelete: "cascade" }),
  position: integer("position").notNull(),
  name: text("name").notNull(),
  hint: text("hint"),
});

export const availabilityBlocks = pgTable("availability_blocks", {
  id: uuid("id").primaryKey().defaultRandom(),
  studioId: uuid("studio_id").notNull().references(() => studios.id, { onDelete: "cascade" }),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  source: availabilitySourceEnum("source").notNull(),
});

// ── Bookings & audit ─────────────────────────────────────────────────────
export const bookings = pgTable("bookings", {
  id: uuid("id").primaryKey().defaultRandom(),
  studioId: uuid("studio_id").notNull().references(() => studios.id, { onDelete: "cascade" }),
  state: bookingStateEnum("state").notNull().default("pending"),
  renterName: text("renter_name").notNull(),
  renterEmail: text("renter_email").notNull(),
  renterPhone: text("renter_phone"),
  eventType: text("event_type"),
  headcount: integer("headcount"),
  byob: boolean("byob").notNull().default(false),
  outsideVendors: boolean("outside_vendors").notNull().default(false),
  notes: text("notes"),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  // Snapshots (copied from studio at request time; never re-joined for terms)
  depositCents: integer("deposit_cents"),
  rateSnapshot: jsonb("rate_snapshot"),
  depositProtected: boolean("deposit_protected").notNull().default(true),
  // v0.5 manual toggles
  depositStatus: depositStatusEnum("deposit_status").notNull().default("uncollected"),
  depositStatusAt: timestamp("deposit_status_at", { withTimezone: true }),
  contractSignedAt: timestamp("contract_signed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const bookingEvents = pgTable("booking_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  bookingId: uuid("booking_id").notNull().references(() => bookings.id, { onDelete: "cascade" }),
  fromState: bookingStateEnum("from_state").notNull(),
  toState: bookingStateEnum("to_state").notNull(),
  actorType: actorTypeEnum("actor_type").notNull(),
  actorId: text("actor_id"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── Walkthroughs & photos ────────────────────────────────────────────────
export const walkthroughs = pgTable("walkthroughs", {
  id: uuid("id").primaryKey().defaultRandom(),
  bookingId: uuid("booking_id").notNull().references(() => bookings.id, { onDelete: "cascade" }),
  kind: walkthroughKindEnum("kind").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  lockedAt: timestamp("locked_at", { withTimezone: true }),
  acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
});

export const walkthroughPhotos = pgTable("walkthrough_photos", {
  id: uuid("id").primaryKey().defaultRandom(),
  walkthroughId: uuid("walkthrough_id").notNull().references(() => walkthroughs.id, { onDelete: "cascade" }),
  checklistItemId: uuid("checklist_item_id").references(() => checklistItems.id),
  r2Key: text("r2_key").notNull(),
  serverCapturedAt: timestamp("server_captured_at", { withTimezone: true }).notNull().defaultNow(),
  lat: doublePrecision("lat"),
  lng: doublePrecision("lng"),
  bytes: integer("bytes"),
  contentType: text("content_type"),
  sha256: text("sha256").notNull(),
});

// ── Contracts (manual signing in v0.5 — no envelope_id) ──────────────────
export const contracts = pgTable("contracts", {
  id: uuid("id").primaryKey().defaultRandom(),
  bookingId: uuid("booking_id").notNull().references(() => bookings.id, { onDelete: "cascade" }),
  template: contractTemplateEnum("template").notNull().default("standard"),
  status: contractStatusEnum("status").notNull().default("sent"),
  signedPdfR2Key: text("signed_pdf_r2_key"),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  signedAt: timestamp("signed_at", { withTimezone: true }),
});

// ── Renter tokens (hashed at rest; one active per booking+purpose) ───────
export const renterTokens = pgTable(
  "renter_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookingId: uuid("booking_id").notNull().references(() => bookings.id, { onDelete: "cascade" }),
    purpose: text("purpose").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("renter_tokens_booking_purpose_idx").on(t.bookingId, t.purpose)]
);

export type Booking = typeof bookings.$inferSelect;
export type BookingEvent = typeof bookingEvents.$inferSelect;
```

- [ ] **Step 3: Generate the migration**

Run: `source ~/.nvm/nvm.sh && nvm use 20 && npm run db:generate`
Expected: a new `drizzle/0000_*.sql` containing `CREATE TYPE "public"."booking_state"...` and 10 `CREATE TABLE` statements; `drizzle/meta/_journal.json` gains one entry. (The journal was empty — Phase 0 never generated a SQL file.)

- [ ] **Step 4: Write the failing schema smoke test**

Create `lib/domain/test-db.test.ts`:

```ts
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
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `source ~/.nvm/nvm.sh && nvm use 20 && npm test -- lib/domain/test-db.test.ts`
Expected: FAIL — cannot resolve `@/lib/domain/test-db`.

- [ ] **Step 6: Implement `lib/domain/test-db.ts`**

```ts
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "@/db/schema";

export type TestDb = ReturnType<typeof drizzle<typeof schema>>;

/**
 * In-memory Postgres with the REAL generated migrations applied —
 * tests exercise the actual schema, not a parallel definition.
 */
export async function createTestDb(): Promise<{ db: TestDb; close: () => Promise<void> }> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: "./drizzle" });
  return { db, close: () => client.close() };
}
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `source ~/.nvm/nvm.sh && nvm use 20 && npm test -- lib/domain/test-db.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 8: Apply the migration to the dev Neon DB**

Run: `source ~/.nvm/nvm.sh && nvm use 20 && npm run db:migrate && npm run db:healthcheck`
Expected: migration applies; healthcheck OK.

- [ ] **Step 9: Full suite + commit**

Run: `source ~/.nvm/nvm.sh && nvm use 20 && npm test && npm run typecheck`
Expected: all pass (15 + 2).

```bash
git add db/schema.ts drizzle/ lib/domain/test-db.ts lib/domain/test-db.test.ts package.json package-lock.json
git commit -m "feat: add full v0.5 schema with migration and PGlite test harness"
```

---

### Task 3: State table + effective-state derivation (pure logic)

**Files:**
- Create: `lib/domain/states.ts`, `lib/domain/states.test.ts`, `lib/domain/effective-state.ts`, `lib/domain/effective-state.test.ts`

**Interfaces:**
- Consumes: nothing (pure).
- Produces (used by Tasks 4 and 6):
  ```ts
  export const BOOKING_STATES: readonly BookingState[]
  export type BookingState = "pending" | "declined" | "awaiting_contract" | "awaiting_signature" | "confirmed" | "event_day" | "post_event" | "closed" | "canceled"
  export const LEGAL_TRANSITIONS: Record<BookingState, readonly BookingState[]>
  export const TERMINAL_STATES: readonly BookingState[]
  // effective-state.ts
  export function deriveEffectiveState(b: { state: BookingState; startsAt: Date; endsAt: Date }, now: Date): BookingState
  ```

- [ ] **Step 1: Write the failing tests**

Create `lib/domain/states.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { BOOKING_STATES, LEGAL_TRANSITIONS, TERMINAL_STATES } from "@/lib/domain/states";

describe("state machine table", () => {
  it("has exactly the 9 v0.5 states", () => {
    expect([...BOOKING_STATES].sort()).toEqual(
      ["awaiting_contract", "awaiting_signature", "canceled", "closed",
       "confirmed", "declined", "event_day", "post_event", "pending"]
    );
  });

  it("terminal states allow no transitions", () => {
    expect([...TERMINAL_STATES].sort()).toEqual(["canceled", "closed", "declined"]);
    for (const s of TERMINAL_STATES) expect(LEGAL_TRANSITIONS[s]).toEqual([]);
  });

  it("encodes exactly the v0.5 spec transitions", () => {
    expect(LEGAL_TRANSITIONS.pending).toEqual(["declined", "awaiting_contract", "canceled"]);
    expect(LEGAL_TRANSITIONS.awaiting_contract).toEqual(["awaiting_signature", "canceled"]);
    expect(LEGAL_TRANSITIONS.awaiting_signature).toEqual(["confirmed", "canceled"]);
    expect(LEGAL_TRANSITIONS.confirmed).toEqual(["event_day", "canceled"]);
    expect(LEGAL_TRANSITIONS.event_day).toEqual(["post_event"]);
    expect(LEGAL_TRANSITIONS.post_event).toEqual(["closed"]);
  });

  it("every transition target is a known state", () => {
    for (const s of BOOKING_STATES)
      for (const t of LEGAL_TRANSITIONS[s]) expect(BOOKING_STATES).toContain(t);
  });
});
```

Create `lib/domain/effective-state.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { deriveEffectiveState } from "@/lib/domain/effective-state";

const startsAt = new Date("2026-08-01T18:00:00Z");
const endsAt = new Date("2026-08-01T22:00:00Z");
const before = new Date("2026-08-01T17:59:59Z");
const during = new Date("2026-08-01T19:00:00Z");
const after = new Date("2026-08-01T22:00:01Z");

describe("deriveEffectiveState", () => {
  it("confirmed stays confirmed before the event", () => {
    expect(deriveEffectiveState({ state: "confirmed", startsAt, endsAt }, before)).toBe("confirmed");
  });
  it("confirmed reads as event_day from the start time (inclusive)", () => {
    expect(deriveEffectiveState({ state: "confirmed", startsAt, endsAt }, startsAt)).toBe("event_day");
    expect(deriveEffectiveState({ state: "confirmed", startsAt, endsAt }, during)).toBe("event_day");
  });
  it("confirmed reads as post_event after the end time", () => {
    expect(deriveEffectiveState({ state: "confirmed", startsAt, endsAt }, after)).toBe("post_event");
  });
  it("event_day reads as post_event after the end time, not at it", () => {
    expect(deriveEffectiveState({ state: "event_day", startsAt, endsAt }, endsAt)).toBe("event_day");
    expect(deriveEffectiveState({ state: "event_day", startsAt, endsAt }, after)).toBe("post_event");
  });
  it("all other states pass through unchanged", () => {
    for (const s of ["pending", "declined", "awaiting_contract", "awaiting_signature", "post_event", "closed", "canceled"] as const) {
      expect(deriveEffectiveState({ state: s, startsAt, endsAt }, after)).toBe(s);
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `source ~/.nvm/nvm.sh && nvm use 20 && npm test -- lib/domain/states.test.ts lib/domain/effective-state.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `lib/domain/states.ts`**

```ts
export const BOOKING_STATES = [
  "pending", "declined", "awaiting_contract", "awaiting_signature",
  "confirmed", "event_day", "post_event", "closed", "canceled",
] as const;

export type BookingState = (typeof BOOKING_STATES)[number];

/**
 * The v0.5 booking state machine — a strict subset of the v1.0 enum,
 * same state names (spec §4). This table is the single source of truth;
 * transitionBooking() enforces it and tests iterate it.
 */
export const LEGAL_TRANSITIONS: Record<BookingState, readonly BookingState[]> = {
  pending: ["declined", "awaiting_contract", "canceled"],
  awaiting_contract: ["awaiting_signature", "canceled"],
  awaiting_signature: ["confirmed", "canceled"],
  confirmed: ["event_day", "canceled"],
  event_day: ["post_event"],
  post_event: ["closed"],
  declined: [],
  closed: [],
  canceled: [],
};

export const TERMINAL_STATES: readonly BookingState[] = BOOKING_STATES.filter(
  (s) => LEGAL_TRANSITIONS[s].length === 0
);
```

- [ ] **Step 4: Implement `lib/domain/effective-state.ts`**

```ts
import type { BookingState } from "./states";

/**
 * Read-time derivation of clock-driven states (spec §6): the stored state
 * lags the clock between cron runs, so reads derive the effective state.
 * Persisting these transitions is a later phase.
 */
export function deriveEffectiveState(
  b: { state: BookingState; startsAt: Date; endsAt: Date },
  now: Date
): BookingState {
  if (b.state === "confirmed") {
    if (now > b.endsAt) return "post_event";
    if (now >= b.startsAt) return "event_day";
    return "confirmed";
  }
  if (b.state === "event_day" && now > b.endsAt) return "post_event";
  return b.state;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `source ~/.nvm/nvm.sh && nvm use 20 && npm test -- lib/domain/states.test.ts lib/domain/effective-state.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 6: Commit**

```bash
git add lib/domain/states.ts lib/domain/states.test.ts lib/domain/effective-state.ts lib/domain/effective-state.test.ts
git commit -m "feat: add v0.5 state table and effective-state derivation (tested)"
```

---

### Task 4: `transitionBooking` — transactional CAS + audit + hooks

**Files:**
- Create: `lib/domain/transitions.ts`, `lib/domain/transitions.test.ts`

**Interfaces:**
- Consumes: `LEGAL_TRANSITIONS`, `BookingState` (Task 3); `bookings`, `bookingEvents`, `Booking` from `@/db/schema` (Task 2); `createTestDb` (Task 2).
- Produces (used by Tasks 6 and later phases):
  ```ts
  export type Db = PgDatabase<PgQueryResultHKT, typeof schema>   // structural: Neon and PGlite both satisfy it
  export type Actor = { type: "owner" | "renter" | "system"; id?: string }
  export class BookingNotFoundError extends Error
  export class IllegalTransitionError extends Error   // has .from and .to
  export class ConcurrentTransitionError extends Error
  export function registerTransitionHook(to: BookingState, hook: (b: Booking, actor: Actor) => Promise<void>): void
  export function clearTransitionHooks(): void        // test hygiene
  export async function transitionBooking(
    db: Db, bookingId: string, to: BookingState, actor: Actor,
    opts?: { meta?: Record<string, unknown>; expectedFrom?: BookingState }
  ): Promise<Booking>
  ```

- [ ] **Step 1: Write the failing test**

Create `lib/domain/transitions.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "@/lib/domain/test-db";
import { studios, bookings, bookingEvents } from "@/db/schema";
import { BOOKING_STATES, LEGAL_TRANSITIONS, type BookingState } from "@/lib/domain/states";
import {
  transitionBooking, registerTransitionHook, clearTransitionHooks,
  BookingNotFoundError, IllegalTransitionError, ConcurrentTransitionError,
} from "@/lib/domain/transitions";

let db: TestDb;
let close: () => Promise<void>;
let studioId: string;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  const [s] = await db.insert(studios).values({ clerkUserId: "u1", name: "S", slug: "s" }).returning();
  studioId = s.id;
});
afterAll(async () => {
  await close();
});
beforeEach(() => clearTransitionHooks());

// Test fixture: inserting a row WITH an initial state is allowed;
// only transitionBooking may CHANGE state afterwards.
async function makeBooking(state: BookingState): Promise<string> {
  const [b] = await db.insert(bookings).values({
    studioId, state,
    renterName: "R", renterEmail: "r@x.com",
    startsAt: new Date("2026-08-01T18:00:00Z"), endsAt: new Date("2026-08-01T22:00:00Z"),
  }).returning();
  return b.id;
}

describe("transition matrix (all 9×9 pairs)", () => {
  for (const from of BOOKING_STATES) {
    for (const to of BOOKING_STATES) {
      const legal = LEGAL_TRANSITIONS[from].includes(to);
      it(`${from} → ${to} is ${legal ? "allowed" : "rejected"}`, async () => {
        const id = await makeBooking(from);
        if (legal) {
          const updated = await transitionBooking(db, id, to, { type: "owner", id: "u1" });
          expect(updated.state).toBe(to);
          const events = await db.select().from(bookingEvents).where(eq(bookingEvents.bookingId, id));
          expect(events).toHaveLength(1);
          expect(events[0]).toMatchObject({ fromState: from, toState: to, actorType: "owner", actorId: "u1" });
        } else {
          await expect(transitionBooking(db, id, to, { type: "owner" })).rejects.toThrow(IllegalTransitionError);
          const [row] = await db.select().from(bookings).where(eq(bookings.id, id));
          expect(row.state).toBe(from);
          const events = await db.select().from(bookingEvents).where(eq(bookingEvents.bookingId, id));
          expect(events).toHaveLength(0);
        }
      });
    }
  }
});

describe("transitionBooking behavior", () => {
  it("throws BookingNotFoundError for a missing id", async () => {
    await expect(
      transitionBooking(db, "00000000-0000-0000-0000-000000000000", "declined", { type: "owner" })
    ).rejects.toThrow(BookingNotFoundError);
  });

  it("records metadata on the audit row", async () => {
    const id = await makeBooking("pending");
    await transitionBooking(db, id, "declined", { type: "owner" }, { meta: { reason: "double booked" } });
    const [ev] = await db.select().from(bookingEvents).where(eq(bookingEvents.bookingId, id));
    expect(ev.metadata).toEqual({ reason: "double booked" });
  });

  it("throws ConcurrentTransitionError when expectedFrom no longer matches (CAS)", async () => {
    const id = await makeBooking("awaiting_contract"); // someone else already advanced it
    await expect(
      transitionBooking(db, id, "awaiting_contract", { type: "owner" }, { expectedFrom: "pending" })
    ).rejects.toThrow(ConcurrentTransitionError);
    const events = await db.select().from(bookingEvents).where(eq(bookingEvents.bookingId, id));
    expect(events).toHaveLength(0);
  });

  it("runs registered hooks after commit and survives hook failure", async () => {
    const calls: string[] = [];
    registerTransitionHook("declined", async (b) => { calls.push(`declined:${b.id}`); });
    registerTransitionHook("declined", async () => { throw new Error("hook boom"); });
    const id = await makeBooking("pending");
    const updated = await transitionBooking(db, id, "declined", { type: "owner" });
    expect(updated.state).toBe("declined");           // hook failure never breaks the transition
    expect(calls).toEqual([`declined:${id}`]);
  });

  it("does not run hooks when the transition is illegal", async () => {
    const calls: string[] = [];
    registerTransitionHook("closed", async () => { calls.push("x"); });
    const id = await makeBooking("pending");
    await expect(transitionBooking(db, id, "closed", { type: "owner" })).rejects.toThrow(IllegalTransitionError);
    expect(calls).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `source ~/.nvm/nvm.sh && nvm use 20 && npm test -- lib/domain/transitions.test.ts`
Expected: FAIL — cannot resolve `@/lib/domain/transitions`.

- [ ] **Step 3: Implement `lib/domain/transitions.ts`**

```ts
import { and, eq } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "@/db/schema";
import { bookings, bookingEvents, type Booking } from "@/db/schema";
import { LEGAL_TRANSITIONS, type BookingState } from "./states";

/** Structural DB type satisfied by both the Neon Pool client and PGlite. */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export type Actor = { type: "owner" | "renter" | "system"; id?: string };

export class BookingNotFoundError extends Error {
  constructor(bookingId: string) {
    super(`Booking not found: ${bookingId}`);
    this.name = "BookingNotFoundError";
  }
}

export class IllegalTransitionError extends Error {
  constructor(readonly from: BookingState, readonly to: BookingState) {
    super(`Illegal transition: ${from} → ${to}`);
    this.name = "IllegalTransitionError";
  }
}

export class ConcurrentTransitionError extends Error {
  constructor(bookingId: string) {
    super(`Booking ${bookingId} was transitioned concurrently; retry from fresh state`);
    this.name = "ConcurrentTransitionError";
  }
}

type TransitionHook = (booking: Booking, actor: Actor) => Promise<void>;
const hooks = new Map<BookingState, TransitionHook[]>();

/** Later phases register side effects (emails, availability blocks) per target state. */
export function registerTransitionHook(to: BookingState, hook: TransitionHook): void {
  const list = hooks.get(to) ?? [];
  list.push(hook);
  hooks.set(to, list);
}

export function clearTransitionHooks(): void {
  hooks.clear();
}

/**
 * The ONLY code path allowed to change bookings.state (spec §5).
 * Transactional: validate legality → compare-and-swap update → append audit row.
 * Hooks run AFTER commit; a failed side effect never rolls back a legal transition.
 */
export async function transitionBooking(
  db: Db,
  bookingId: string,
  to: BookingState,
  actor: Actor,
  opts?: { meta?: Record<string, unknown>; expectedFrom?: BookingState }
): Promise<Booking> {
  const updated = await db.transaction(async (tx) => {
    let from = opts?.expectedFrom;
    if (!from) {
      const [current] = await tx.select().from(bookings).where(eq(bookings.id, bookingId));
      if (!current) throw new BookingNotFoundError(bookingId);
      from = current.state;
    }

    if (!LEGAL_TRANSITIONS[from].includes(to)) throw new IllegalTransitionError(from, to);

    const rows = await tx
      .update(bookings)
      .set({ state: to })
      .where(and(eq(bookings.id, bookingId), eq(bookings.state, from)))
      .returning();
    if (rows.length === 0) {
      // Row exists but state moved under us (or expectedFrom was stale) — CAS failed.
      const [exists] = await tx.select({ id: bookings.id }).from(bookings).where(eq(bookings.id, bookingId));
      if (!exists) throw new BookingNotFoundError(bookingId);
      throw new ConcurrentTransitionError(bookingId);
    }

    await tx.insert(bookingEvents).values({
      bookingId,
      fromState: from,
      toState: to,
      actorType: actor.type,
      actorId: actor.id ?? null,
      metadata: opts?.meta ?? null,
    });

    return rows[0];
  });

  for (const hook of hooks.get(to) ?? []) {
    try {
      await hook(updated, actor);
    } catch (e) {
      console.error(`transition hook for "${to}" failed (transition stands):`, e);
    }
  }

  return updated;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `source ~/.nvm/nvm.sh && nvm use 20 && npm test -- lib/domain/transitions.test.ts`
Expected: PASS — 81 matrix cases + 5 behavior tests. (The hook-failure test intentionally triggers one `console.error` line; that log is the designed behavior, not noise.)

- [ ] **Step 5: Full suite + typecheck**

Run: `source ~/.nvm/nvm.sh && nvm use 20 && npm test && npm run typecheck`
Expected: all pass. If `Db` assignability fails against PGlite's type, relax the first generic: `PgDatabase<PgQueryResultHKT, typeof schema>` → `PgDatabase<any, typeof schema>` with an eslint-disable for `no-explicit-any` on that line — note it in your report if you do.

- [ ] **Step 6: Commit**

```bash
git add lib/domain/transitions.ts lib/domain/transitions.test.ts
git commit -m "feat: add transactional transitionBooking with CAS, audit log, and hooks (tested)"
```

---

### Task 5: Renter tokens

**Files:**
- Create: `lib/tokens.ts`, `lib/tokens.test.ts`

**Interfaces:**
- Consumes: `renterTokens`, `bookings`, `studios` from `@/db/schema`; `Db` type from `@/lib/domain/transitions`; `createTestDb`.
- Produces (used by Phase 4):
  ```ts
  export async function mintRenterToken(db: Db, bookingId: string, purpose: string, expiresAt: Date): Promise<string>  // returns raw base64url token
  export async function verifyRenterToken(db: Db, rawToken: string, purpose: string): Promise<string | null>          // booking_id or null
  ```

- [ ] **Step 1: Write the failing test**

Create `lib/tokens.test.ts`:

```ts
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

  it("rejects garbage input", async () => {
    expect(await verifyRenterToken(db, "not-a-real-token", "status")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `source ~/.nvm/nvm.sh && nvm use 20 && npm test -- lib/tokens.test.ts`
Expected: FAIL — cannot resolve `@/lib/tokens`.

- [ ] **Step 3: Implement `lib/tokens.ts`**

```ts
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { renterTokens } from "@/db/schema";
import type { Db } from "@/lib/domain/transitions";

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/**
 * Mint a booking-scoped token (spec §7). Returns the RAW token for the email
 * link; only its SHA-256 hash is stored. One active token per
 * (booking, purpose): re-minting rotates, invalidating the previous link.
 */
export async function mintRenterToken(
  db: Db,
  bookingId: string,
  purpose: string,
  expiresAt: Date
): Promise<string> {
  const raw = randomBytes(32).toString("base64url");
  await db.transaction(async (tx) => {
    await tx
      .delete(renterTokens)
      .where(and(eq(renterTokens.bookingId, bookingId), eq(renterTokens.purpose, purpose)));
    await tx.insert(renterTokens).values({ bookingId, purpose, tokenHash: hashToken(raw), expiresAt });
  });
  return raw;
}

/** Returns the booking id for a live token of the given purpose, else null. */
export async function verifyRenterToken(db: Db, rawToken: string, purpose: string): Promise<string | null> {
  const [row] = await db
    .select({ bookingId: renterTokens.bookingId })
    .from(renterTokens)
    .where(
      and(
        eq(renterTokens.tokenHash, hashToken(rawToken)),
        eq(renterTokens.purpose, purpose),
        gt(renterTokens.expiresAt, new Date())
      )
    );
  return row?.bookingId ?? null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `source ~/.nvm/nvm.sh && nvm use 20 && npm test -- lib/tokens.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Full suite + commit**

Run: `source ~/.nvm/nvm.sh && nvm use 20 && npm test`
Expected: all pass.

```bash
git add lib/tokens.ts lib/tokens.test.ts
git commit -m "feat: add renter token mint/verify with hash-at-rest and rotation (tested)"
```

---

### Task 6: Seed script

**Files:**
- Create: `scripts/seed.ts`
- Modify: `package.json` (add `"db:seed": "dotenv -e .env.local -- tsx scripts/seed.ts"` to scripts)

**Interfaces:**
- Consumes: `getDb`/`getPool` (Task 1), schema tables (Task 2), `transitionBooking` + `Actor` (Task 4), `LEGAL_TRANSITIONS`/`BookingState` (Task 3).
- Produces: `npm run db:seed` — idempotent dev-DB seed; no exports.

- [ ] **Step 1: Write `scripts/seed.ts`**

```ts
/**
 * Seeds the dev database with the prototype's demo studio and bookings,
 * remapped onto the v0.5 state machine (spec §8). Idempotent: deletes and
 * recreates the demo studio by slug. Booking histories are written THROUGH
 * transitionBooking so the seed itself exercises the state machine.
 */
import { eq } from "drizzle-orm";
import { getDb, getPool } from "@/lib/db";
import { studios, spaces, checklistItems, bookings } from "@/db/schema";
import { transitionBooking, type Actor } from "@/lib/domain/transitions";
import type { BookingState } from "@/lib/domain/states";

const SLUG = "westview";
const OWNER: Actor = { type: "owner", id: "seed-owner" };
const SYSTEM: Actor = { type: "system" };

/** Shortest path from `pending` to each target state, with the acting party. */
const PATHS: Record<BookingState, Array<{ to: BookingState; actor: Actor }>> = {
  pending: [],
  declined: [{ to: "declined", actor: OWNER }],
  awaiting_contract: [{ to: "awaiting_contract", actor: OWNER }],
  awaiting_signature: [
    { to: "awaiting_contract", actor: OWNER },
    { to: "awaiting_signature", actor: OWNER },
  ],
  confirmed: [
    { to: "awaiting_contract", actor: OWNER },
    { to: "awaiting_signature", actor: OWNER },
    { to: "confirmed", actor: OWNER },
  ],
  event_day: [
    { to: "awaiting_contract", actor: OWNER },
    { to: "awaiting_signature", actor: OWNER },
    { to: "confirmed", actor: OWNER },
    { to: "event_day", actor: SYSTEM },
  ],
  post_event: [
    { to: "awaiting_contract", actor: OWNER },
    { to: "awaiting_signature", actor: OWNER },
    { to: "confirmed", actor: OWNER },
    { to: "event_day", actor: SYSTEM },
    { to: "post_event", actor: SYSTEM },
  ],
  closed: [
    { to: "awaiting_contract", actor: OWNER },
    { to: "awaiting_signature", actor: OWNER },
    { to: "confirmed", actor: OWNER },
    { to: "event_day", actor: SYSTEM },
    { to: "post_event", actor: SYSTEM },
    { to: "closed", actor: OWNER },
  ],
  canceled: [
    { to: "awaiting_contract", actor: OWNER },
    { to: "canceled", actor: OWNER },
  ],
};

const now = new Date();
const days = (n: number) => new Date(now.getTime() + n * 24 * 60 * 60 * 1000);
const at = (base: Date, hour: number) => {
  const d = new Date(base);
  d.setHours(hour, 0, 0, 0);
  return d;
};

// Prototype personas remapped to v0.5 states (spec §8).
const DEMO_BOOKINGS: Array<{
  state: BookingState; renterName: string; renterEmail: string; eventType: string;
  headcount: number; byob: boolean; outsideVendors: boolean; notes: string;
  startsAt: Date; endsAt: Date;
}> = [
  { state: "pending", renterName: "Maya Reeves", renterEmail: "maya.r@gmail.com", eventType: "Birthday celebration", headcount: 25, byob: true, outsideVendors: false, notes: "Bringing a small dessert table and balloon arch — no wall tape, promise!", startsAt: at(days(7), 18), endsAt: at(days(7), 22) },
  { state: "awaiting_contract", renterName: "Tasha Willis", renterEmail: "tasha@willisproductions.co", eventType: "Creative production with guests", headcount: 15, byob: false, outsideVendors: true, notes: "Small crew, haze machine — happy to discuss.", startsAt: at(days(8), 12), endsAt: at(days(8), 18) },
  { state: "awaiting_signature", renterName: "Kelvin Odom", renterEmail: "kelvin@studiokco.com", eventType: "Brand event / pop-up", headcount: 40, byob: true, outsideVendors: true, notes: "Step-and-repeat near entrance.", startsAt: at(days(14), 19), endsAt: at(days(14), 23) },
  { state: "confirmed", renterName: "Dana Nguyen", renterEmail: "dana@podlab.fm", eventType: "Creative production with guests", headcount: 4, byob: false, outsideVendors: false, notes: "Repeat client.", startsAt: at(days(5), 10), endsAt: at(days(5), 13) },
  { state: "confirmed", renterName: "Lena Ortiz", renterEmail: "lena.ortiz@yahoo.com", eventType: "Other private event", headcount: 20, byob: true, outsideVendors: true, notes: "Private chef.", startsAt: at(days(21), 17), endsAt: at(days(21), 21) },
  { state: "event_day", renterName: "Jordan Carter", renterEmail: "jcarter@outlook.com", eventType: "Baby or bridal shower", headcount: 30, byob: false, outsideVendors: true, notes: "Caterer arriving 1:30 PM for setup.", startsAt: at(days(0), 14), endsAt: at(days(0), 18) },
  { state: "post_event", renterName: "Andre Brooks", renterEmail: "dre.brooks@gmail.com", eventType: "Listening session / release party", headcount: 35, byob: true, outsideVendors: false, notes: "DJ + light catering.", startsAt: at(days(-2), 19), endsAt: at(days(-2), 23) },
  { state: "closed", renterName: "Simone Price", renterEmail: "simone.p@gmail.com", eventType: "Other private event", headcount: 12, byob: true, outsideVendors: false, notes: "", startsAt: at(days(-8), 18), endsAt: at(days(-8), 21) },
  { state: "declined", renterName: "Marcus Hill", renterEmail: "mhill.events@gmail.com", eventType: "Brand event / pop-up", headcount: 60, byob: true, outsideVendors: true, notes: "60 guests — over our cap, sadly.", startsAt: at(days(10), 20), endsAt: at(days(10), 23) },
  { state: "canceled", renterName: "Priya Shah", renterEmail: "priya.shah@gmail.com", eventType: "Birthday celebration", headcount: 18, byob: false, outsideVendors: false, notes: "Renter had a schedule conflict.", startsAt: at(days(12), 15), endsAt: at(days(12), 19) },
];

const CHECKLIST = [
  { position: 1, name: "Cyc wall", hint: "Full-width shot, both corners" },
  { position: 2, name: "Floors", hint: "Any existing scuffs or marks" },
  { position: 3, name: "Lighting equipment", hint: "Stands, softboxes, cables" },
  { position: 4, name: "Furniture & props", hint: "Couch, tables, decor wall" },
  { position: 5, name: "Bathroom", hint: "Fixtures and counter" },
  { position: 6, name: "Entryway & door", hint: "Locks, handles, signage" },
];

async function main() {
  const db = getDb();

  // Idempotent: cascade delete wipes spaces/checklist/bookings/events/tokens.
  await db.delete(studios).where(eq(studios.slug, SLUG));

  const [studio] = await db.insert(studios).values({
    clerkUserId: "seed-owner",
    name: "Westview Studio",
    slug: SLUG,
    address: "1200 Westview Dr SW, Atlanta, GA",
    description: "Natural-light studio with a 20-ft cyc wall in Atlanta's Westview neighborhood.",
    equipmentList: "Cyc wall, 4x Aputure 300d, C-stands, seamless paper (white/gray)",
    hourlyRateCents: 9500,
    minHours: 4,
    depositCents: 40000,
    alcoholPolicy: "byob_with_agreement",
    vendorPolicy: "approved_in_advance",
    noiseCurfew: "22:00",
    cleanupWindowMin: 60,
    cancellationLadder: { full: 30, half: 14, none: 0 },
    onboardingCompletedAt: now,
  }).returning();

  await db.insert(spaces).values([
    { studioId: studio.id, name: "Main studio", maxOccupancy: 40 },
    { studioId: studio.id, name: "Green room", maxOccupancy: 8 },
  ]);
  await db.insert(checklistItems).values(CHECKLIST.map((c) => ({ ...c, studioId: studio.id })));

  for (const demo of DEMO_BOOKINGS) {
    const { state: target, ...intake } = demo;
    const [b] = await db.insert(bookings).values({
      ...intake,
      studioId: studio.id,
      depositCents: studio.depositCents,
      rateSnapshot: { hourlyRateCents: studio.hourlyRateCents, minHours: studio.minHours, cancellationLadder: studio.cancellationLadder },
    }).returning();
    for (const step of PATHS[target]) {
      await transitionBooking(db, b.id, step.to, step.actor, { meta: { seed: true } });
    }
    console.log(`seeded: ${intake.renterName.padEnd(14)} → ${target}`);
  }

  console.log(`\nSeed complete: studio "${studio.name}" (/book/${SLUG}) with ${DEMO_BOOKINGS.length} bookings.`);
  await getPool().end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: Add the npm script**

In `package.json` scripts, add:

```json
"db:seed": "dotenv -e .env.local -- tsx scripts/seed.ts"
```

- [ ] **Step 3: Run the seed against the dev DB and verify**

Run: `source ~/.nvm/nvm.sh && nvm use 20 && npm run db:seed`
Expected: 10 `seeded: <name> → <state>` lines + completion line; process exits.

Run it **again** to prove idempotency:
`source ~/.nvm/nvm.sh && nvm use 20 && npm run db:seed`
Expected: same output, no unique-violation errors.

- [ ] **Step 4: Verify seeded data shape**

Run:
```bash
source ~/.nvm/nvm.sh && nvm use 20 && npx dotenv-cli -e .env.local -- npx tsx -e "
import { getDb, getPool } from '@/lib/db';
import { bookings, bookingEvents } from '@/db/schema';
(async () => {
  const db = getDb();
  const bs = await db.select({ state: bookings.state }).from(bookings);
  console.log('states:', bs.map(b => b.state).sort().join(','));
  const evs = await db.select().from(bookingEvents);
  console.log('audit rows:', evs.length);
  await getPool().end();
})();
"
```
Expected: all 9 distinct states present across 10 bookings (confirmed appears twice); audit rows = 27 (sum of all path lengths: 0+1+1+2+3+3+4+5+6+2).

- [ ] **Step 5: Gates + commit**

Run: `source ~/.nvm/nvm.sh && nvm use 20 && npm run lint && npm run typecheck && npm test`
Expected: all pass.

```bash
git add scripts/seed.ts package.json
git commit -m "feat: add idempotent seed script exercising the state machine"
```

---

### Task 7: Final verification + PR

**Files:** none (verification and PR only).

**Interfaces:**
- Consumes: everything above.
- Produces: an open PR from `feat/phase-2-domain-core`, CI green.

- [ ] **Step 1: Run all four gates clean**

Run: `source ~/.nvm/nvm.sh && nvm use 20 && npm run lint && npm run typecheck && npm test && npm run build`
Expected: all pass. Test count ≈ 15 (existing) + 2 (schema) + 9 (states/derivation) + 86 (transitions) + 6 (tokens) ≈ 118.

- [ ] **Step 2: Verify state-discipline greps**

Run:
```bash
grep -rn "update(bookings)" --include="*.ts" lib app scripts | grep -v "lib/domain/transitions.ts"
grep -rn "update(bookingEvents)\|delete(bookingEvents)" --include="*.ts" lib app scripts
```
Expected: **no output from either** — nothing outside `transitionBooking` writes `bookings.state`; no update/delete on `booking_events` anywhere.

- [ ] **Step 3: Confirm protected surfaces are untouched**

Run: `git diff main --stat -- prototype/ "app/(marketing)" "app/(owner)" "app/(public)" proxy.ts`
Expected: no output.

- [ ] **Step 4: Push and open the PR**

```bash
git push -u origin feat/phase-2-domain-core
gh pr create --title "Phase 2: domain core — schema, state machine, audit log, tokens, seed" --body "$(cat <<'EOF'
## Summary
- Full v0.5 schema (10 tables, one migration); `deposits`/`coi_documents`/`claims` deliberately absent
- `lib/db.ts` on the Neon websocket Pool driver (lazy init preserved) so `db.transaction()` works
- `transitionBooking`: transactional validate → CAS update → append-only `booking_events` audit row; post-commit side-effect hook registry (no-op stubs)
- Read-time effective-state derivation for clock states; renter tokens hashed at rest with rotation
- Idempotent seed: Westview Studio + 10 bookings across all 9 states, histories written through the state machine
- Tests on PGlite running the real generated migrations: full 9×9 transition matrix, CAS, hooks, tokens, derivation (~118 tests, no CI secrets)
- Spec: `docs/specs/2026-07-05-venuedash-phase-2-domain-core-design.md` · Plan: `docs/plans/2026-07-05-venuedash-phase-2-domain-core.md`

## Test plan
- [ ] CI green (lint / typecheck / test / build)
- [ ] `npm run db:migrate` + `npm run db:seed` run clean against dev Neon (run locally; verified during build)
- [ ] Landing/waitlist/auth unchanged on preview deploy

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 5: Confirm exit criteria (spec §12)**

- [ ] Full transition matrix covered in `npm test`, green in CI with no secrets.
- [ ] Seeded dev DB browsable: 10 bookings across all 9 states with audit histories.
- [ ] Migration + healthcheck work on the new driver.
- [ ] State/audit discipline greps clean.
- [ ] Phases 0–1 behavior unchanged.

---

## Self-Review

**1. Spec coverage** (Phase 2 spec §3–§12):
- §3 schema: all 10 tables + 7 enums + v0.5 deltas (deposit_status/deposit_status_at/contract_signed_at, sha256, no stripe_account_id/envelope_id, unique (booking,purpose)) → Task 2. Driver change + healthcheck → Task 1. ✓
- §4 state machine as data → Task 3 (`states.ts`), tests assert the exact table. ✓
- §5 transitionBooking (transaction, CAS, audit, post-commit hooks, typed errors, expectedFrom) → Task 4. ✓
- §6 derivation → Task 3. ✓ §7 tokens → Task 5. ✓ §8 seed (10 bookings/9 states via transitionBooking, idempotent) → Task 6. ✓
- §9 testing (PGlite + real migrations, matrix, CAS, tokens, derivation, audit append-only via grep) → Tasks 2–5 + Task 7 Step 2. ✓
- §10 errors → Task 4. §11 out of scope: nothing in plan touches UI/cron/email. §12 exit criteria → Task 7 Step 5. ✓

**2. Placeholder scan:** every code step has complete code; every command has expected output; no TBDs. The one conditional instruction (Task 4 Step 5 `Db` generic relaxation) specifies the exact fallback change. ✓

**3. Type consistency:** `Db` defined in Task 4, imported by Task 5 (`@/lib/domain/transitions`); `createTestDb`/`TestDb` defined Task 2, used Tasks 4–5; `getDb`/`getPool` defined Task 1, used Task 6; `BookingState`/`LEGAL_TRANSITIONS`/`BOOKING_STATES` defined Task 3, used Tasks 4/6; `transitionBooking(db, id, to, actor, opts?)` signature consistent across Tasks 4/6 and matches the amended spec. Audit-row count in Task 6 Step 4 (27) recomputed from PATHS lengths (0+1+1+2+3+3+4+5+6+2 = 27). ✓

**Known judgment calls:** (a) PGlite is single-connection, so the CAS/concurrency branch is tested via `expectedFrom` staleness rather than true parallelism — the deterministic equivalent; (b) `tsconfig` path alias `@/` works under tsx because Phase 0's healthcheck already relies on it.
