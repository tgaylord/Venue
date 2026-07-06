# VenueDash Phase 7 — Photo Checklist PWA — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the owner-performed pre/post photo walkthrough — an installable PWA capture surface that server-timestamps, geotags, and SHA-256-hashes each photo, uploads it direct-to-R2, then locks the walkthrough into an immutable timestamped record.

**Architecture:** A new `lib/walkthrough.ts` domain module (Drizzle-handle-first, PGlite-tested, R2 side-effects injected — mirroring `lib/contract.ts`) drives lifecycle: get-or-create → per-item presigned upload → commit → lock. Immutability is enforced by a Postgres trigger (migration `0004`) plus app-layer guards. A full-screen owner capture UI under `(owner)` uses `getUserMedia` primary with a file-input fallback and a webview interstitial. A protected cron route sends the best-effort 3h reminder.

**Tech Stack:** Next.js 16 (App Router, Node runtime) · React 19 · Drizzle + Neon/PGlite · Cloudflare R2 (presigned PUT/GET) · Resend · Web Crypto (`crypto.subtle`) for SHA-256 · Clerk (owner auth).

**Spec:** `docs/specs/2026-07-06-venuedash-phase-7-photo-checklist-design.md`

## Global Constraints

- **Node 20** for all npm commands (`nvm use 20 && …`); engine-strict rejects Node 24.
- **Node runtime only** for every route/action touching R2 or `getDb()` — never Edge (no `export const runtime = "edge"`).
- **State discipline:** no writes to `bookings.state` outside `transitionBooking()`. This phase makes **none** (walkthroughs + `deposit_protected` are their own lifecycle; auto-close deferred).
- **Evidence discipline:** no update/delete path on a **locked** walkthrough or its photos, ever — enforced by DB trigger + app guard.
- **Snapshot discipline:** legal/terms fields read from `bookings.rateSnapshot`, never re-joined from studio settings.
- **`"use server"` files export only async functions** — constants live in a plain `forms.ts`/module.
- **Copy discipline (binding):** "timestamped documentation," never "immutable evidence"/"proof"/"legal backbone." No held-deposit, auto-refund, or damage-claim language.
- **Owner action pattern:** each action re-resolves studio from Clerk `userId`, re-fetches studio-scoped via `getBookingForOwner` (foreign id → `notFound()`), `revalidatePath` + stay on page. Client-supplied ids never trusted for authz.
- **DB fns** take the Drizzle handle (`Db`) as first arg; tests inject `createTestDb()` from `lib/domain/test-db.ts`.
- **Tests** run on PGlite (no secrets). Verify with `nvm use 20 && npm run test`, `npm run typecheck`, `npm run lint`, `npm run build`.

---

## File Structure

**Create:**
- `db/schema.ts` — modify (add unique/partial-unique indexes + `pre_reminder_sent_at`)
- `drizzle/0004_*.sql` — generated columns/indexes + hand-appended trigger DDL
- `lib/walkthrough.ts` — walkthrough domain module (+ `lib/walkthrough.test.ts`)
- `lib/capture.ts` — pure client helpers: webview detection, SHA-256 hex, compression, kind parse (+ `lib/capture.test.ts`)
- `lib/domain/booking-view.ts` — modify: add `walkthroughEntries` pure helper (+ tests in `booking-view.test.ts`)
- `app/manifest.ts` — PWA manifest route (+ `app/manifest.test.ts`)
- `public/icon-192.png`, `public/icon-512.png`, `public/apple-touch-icon.png` — PWA icons
- `app/(owner)/dashboard/bookings/[id]/walkthrough/[kind]/page.tsx` — server page (loads booking + items + existing photos)
- `app/(owner)/dashboard/bookings/[id]/walkthrough/[kind]/actions.ts` — `"use server"` actions
- `app/(owner)/dashboard/bookings/[id]/walkthrough/[kind]/forms.ts` — pure parsers/constants (+ test)
- `app/(owner)/dashboard/bookings/[id]/walkthrough/[kind]/_components/CaptureFlow.tsx` — client capture UI
- `app/(owner)/dashboard/bookings/[id]/walkthrough/[kind]/_components/InstallHint.tsx` — "add to home screen" hint
- `app/(owner)/dashboard/bookings/[id]/walkthrough/[kind]/photo/[photoId]/route.ts` — presigned GET
- `emails/WalkthroughReminder.tsx` — reminder email (+ render helper in `lib/email.ts`)
- `app/api/cron/walkthrough-reminders/route.ts` — protected cron route

**Modify:**
- `app/(owner)/dashboard/bookings/[id]/page.tsx` — replace event_day/post_event/Documentation placeholders with entry points + gallery
- `lib/email.ts` — `renderWalkthroughReminder`
- `.env.example` — `CRON_SECRET`
- `scripts/seed.ts` — (optional) seed a locked walkthrough for a `post_event`/`closed` booking to walk the gallery
- `CLAUDE.md`, `.superpowers/sdd/progress.md` — handoff (final task)

---

## Task 1: Migration 0004 — indexes + `pre_reminder_sent_at` + immutability triggers

**Files:**
- Modify: `db/schema.ts` (walkthroughs, walkthroughPhotos, bookings)
- Create: `drizzle/0004_*.sql` (generated, then hand-edited)
- Test: `lib/walkthrough-immutability.test.ts`

**Interfaces:**
- Produces: schema with `unique(walkthroughs.booking_id, kind)`, partial `unique(walkthrough_photos.walkthrough_id, checklist_item_id) WHERE checklist_item_id IS NOT NULL`, `bookings.pre_reminder_sent_at timestamptz null`, and BEFORE UPDATE/DELETE triggers `walkthroughs_immutable_when_locked` / `walkthrough_photos_immutable_when_locked`.

- [ ] **Step 1: Write the failing test** (`lib/walkthrough-immutability.test.ts`)

```ts
import { describe, it, expect } from "vitest";
import { createTestDb } from "@/lib/domain/test-db";
import { studios, bookings, walkthroughs, walkthroughPhotos } from "@/db/schema";
import { eq } from "drizzle-orm";

async function seedLockable() {
  const { db, close } = await createTestDb();
  const [s] = await db.insert(studios).values({ clerkUserId: "u1", name: "S", slug: "s" }).returning();
  const [b] = await db.insert(bookings).values({
    studioId: s.id, renterName: "R", renterEmail: "r@x.com",
    startsAt: new Date("2026-08-01T18:00:00Z"), endsAt: new Date("2026-08-01T22:00:00Z"),
  }).returning();
  const [w] = await db.insert(walkthroughs).values({ bookingId: b.id, kind: "pre", startedAt: new Date() }).returning();
  return { db, close, w };
}

describe("locked-walkthrough immutability", () => {
  it("allows the lock write, then forbids further updates/deletes", async () => {
    const { db, close, w } = await seedLockable();
    // pre-lock update is fine
    await db.update(walkthroughs).set({ startedAt: new Date() }).where(eq(walkthroughs.id, w.id));
    // the lock write itself is allowed (OLD.locked_at IS NULL)
    await db.update(walkthroughs).set({ lockedAt: new Date() }).where(eq(walkthroughs.id, w.id));
    // any subsequent update fails
    await expect(
      db.update(walkthroughs).set({ acknowledgedAt: new Date() }).where(eq(walkthroughs.id, w.id))
    ).rejects.toThrow();
    // delete fails
    await expect(db.delete(walkthroughs).where(eq(walkthroughs.id, w.id))).rejects.toThrow();
    await close();
  });

  it("forbids writing a photo under a locked walkthrough", async () => {
    const { db, close, w } = await seedLockable();
    // photo insert while unlocked is fine
    const [p] = await db.insert(walkthroughPhotos).values({
      walkthroughId: w.id, r2Key: "k", sha256: "h",
    }).returning();
    await db.update(walkthroughs).set({ lockedAt: new Date() }).where(eq(walkthroughs.id, w.id));
    await expect(
      db.update(walkthroughPhotos).set({ sha256: "tampered" }).where(eq(walkthroughPhotos.id, p.id))
    ).rejects.toThrow();
    await expect(db.delete(walkthroughPhotos).where(eq(walkthroughPhotos.id, p.id))).rejects.toThrow();
    await close();
  });
});
```

- [ ] **Step 2: Run it, expect FAIL** — `nvm use 20 && npm run test -- walkthrough-immutability`. Expected: failing (no triggers yet; the "further update" resolves instead of rejecting).

- [ ] **Step 3: Edit `db/schema.ts`.** Add to the `walkthroughs` table builder callback a unique index, to `walkthroughPhotos` a partial unique index, and to `bookings` the new column:

```ts
// walkthroughs (t) => [...]:
  index("walkthroughs_booking_id_idx").on(t.bookingId),
  uniqueIndex("walkthroughs_booking_kind_unique").on(t.bookingId, t.kind),
// walkthroughPhotos (t) => [...]:
  index("walkthrough_photos_walkthrough_id_idx").on(t.walkthroughId),
  uniqueIndex("walkthrough_photos_item_unique")
    .on(t.walkthroughId, t.checklistItemId)
    .where(sql`"checklist_item_id" IS NOT NULL`),
// bookings columns, after contractSignedAt:
  preReminderSentAt: timestamp("pre_reminder_sent_at", { withTimezone: true }),
```
Ensure `uniqueIndex` and `sql` are imported at the top of `db/schema.ts` (they are already used elsewhere — verify).

- [ ] **Step 4: Generate the migration** — `nvm use 20 && npm run db:generate`. Confirm a new `drizzle/0004_*.sql` appears with the two unique indexes and the `pre_reminder_sent_at` column.

- [ ] **Step 5: Hand-append the trigger DDL** to the generated `drizzle/0004_*.sql` (drizzle-kit does not emit triggers). Append verbatim:

```sql
--> statement-breakpoint
CREATE OR REPLACE FUNCTION forbid_locked_walkthrough() RETURNS trigger AS $$
BEGIN
  IF OLD.locked_at IS NOT NULL THEN
    RAISE EXCEPTION 'walkthrough % is locked and cannot be modified', OLD.id;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER walkthroughs_immutable_when_locked
  BEFORE UPDATE OR DELETE ON walkthroughs
  FOR EACH ROW EXECUTE FUNCTION forbid_locked_walkthrough();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION forbid_locked_walkthrough_photo() RETURNS trigger AS $$
DECLARE locked timestamptz;
BEGIN
  SELECT w.locked_at INTO locked FROM walkthroughs w
    WHERE w.id = CASE WHEN TG_OP = 'DELETE' THEN OLD.walkthrough_id ELSE NEW.walkthrough_id END;
  IF locked IS NOT NULL THEN
    RAISE EXCEPTION 'walkthrough photo belongs to a locked walkthrough and cannot be modified';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER walkthrough_photos_immutable_when_locked
  BEFORE UPDATE OR DELETE ON walkthrough_photos
  FOR EACH ROW EXECUTE FUNCTION forbid_locked_walkthrough_photo();
```

- [ ] **Step 6: Run the test, expect PASS** — `nvm use 20 && npm run test -- walkthrough-immutability`. If PGlite rejects the PL/pgSQL, STOP and use systematic-debugging; fallback is app-layer-only guards with the trigger removed and this test relaxed to assert the guard (document the deviation in the ledger).

- [ ] **Step 7: Verify the whole suite + typecheck still pass** — `nvm use 20 && npm run test && npm run typecheck`.

- [ ] **Step 8: Commit**

```bash
git add db/schema.ts drizzle/ lib/walkthrough-immutability.test.ts
git commit -m "feat(walkthrough): migration 0004 — unique indexes, reminder stamp, locked-immutability triggers"
```

---

## Task 2: `lib/walkthrough.ts` — `getOrCreateWalkthrough` + `photoKey`

**Files:**
- Create: `lib/walkthrough.ts`, `lib/walkthrough.test.ts`

**Interfaces:**
- Produces:
  - `type Walkthrough = typeof walkthroughs.$inferSelect`
  - `type WalkthroughKind = "pre" | "post"`
  - `photoKey(walkthroughId: string, checklistItemId: string): string` → `walkthroughs/{walkthroughId}/{checklistItemId}.jpg`
  - `getOrCreateWalkthrough(db: Db, bookingId: string, kind: WalkthroughKind, now?: () => Date): Promise<Walkthrough>`

- [ ] **Step 1: Write the failing test** (`lib/walkthrough.test.ts`)

```ts
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
```

- [ ] **Step 2: Run it, expect FAIL** — `nvm use 20 && npm run test -- lib/walkthrough.test` → module not found.

- [ ] **Step 3: Implement** (`lib/walkthrough.ts`)

```ts
import { and, eq } from "drizzle-orm";
import { walkthroughs } from "@/db/schema";
import type { Db } from "@/lib/domain/transitions";

export type Walkthrough = typeof walkthroughs.$inferSelect;
export type WalkthroughKind = "pre" | "post";

export function photoKey(walkthroughId: string, checklistItemId: string): string {
  return `walkthroughs/${walkthroughId}/${checklistItemId}.jpg`;
}

export async function getOrCreateWalkthrough(
  db: Db, bookingId: string, kind: WalkthroughKind, now: () => Date = () => new Date()
): Promise<Walkthrough> {
  await db.insert(walkthroughs)
    .values({ bookingId, kind, startedAt: now() })
    .onConflictDoNothing({ target: [walkthroughs.bookingId, walkthroughs.kind] });
  const [row] = await db.select().from(walkthroughs)
    .where(and(eq(walkthroughs.bookingId, bookingId), eq(walkthroughs.kind, kind)));
  return row;
}
```

- [ ] **Step 4: Run it, expect PASS** — `nvm use 20 && npm run test -- lib/walkthrough.test`.

- [ ] **Step 5: Commit**

```bash
git add lib/walkthrough.ts lib/walkthrough.test.ts
git commit -m "feat(walkthrough): getOrCreateWalkthrough + deterministic photoKey"
```

---

## Task 3: `startCapture` + `commitCapture`

**Files:**
- Modify: `lib/walkthrough.ts`, `lib/walkthrough.test.ts`

**Interfaces:**
- Consumes: `photoKey`, `getOrCreateWalkthrough`.
- Produces:
  - `type StartCaptureDeps = { getUploadUrl: (key: string, contentType: string) => Promise<string> }`
  - `startCapture(db, args: { bookingId; kind; checklistItemId }, deps): Promise<{ key: string; uploadUrl: string; walkthroughId: string }>` — throws `WalkthroughLockedError` if locked.
  - `commitCapture(db, args: { walkthroughId; checklistItemId; sha256; bytes; contentType; lat?: number|null; lng?: number|null }, now?): Promise<Photo>` — upserts one row per `(walkthrough, item)`; throws `WalkthroughLockedError` if locked.
  - `type Photo = typeof walkthroughPhotos.$inferSelect`
  - `class WalkthroughLockedError extends Error`

- [ ] **Step 1: Write the failing test** (append to `lib/walkthrough.test.ts`)

```ts
import { startCapture, commitCapture, WalkthroughLockedError } from "@/lib/walkthrough";
import { walkthroughs as wt, walkthroughPhotos } from "@/db/schema";
import { eq } from "drizzle-orm";

const deps = { getUploadUrl: async (key: string) => `https://r2/${key}?sig` };

async function seedWithItem() {
  const { db, close } = await createTestDb();
  const [s] = await db.insert(studios).values({ clerkUserId: "u1", name: "S", slug: "s" }).returning();
  const { checklistItems } = await import("@/db/schema");
  const [item] = await db.insert(checklistItems).values({ studioId: s.id, position: 1, name: "Floor" }).returning();
  const [b] = await db.insert(bookings).values({
    studioId: s.id, renterName: "R", renterEmail: "r@x.com",
    startsAt: new Date("2026-08-01T18:00:00Z"), endsAt: new Date("2026-08-01T22:00:00Z"),
  }).returning();
  return { db, close, bookingId: b.id, itemId: item.id };
}

describe("startCapture / commitCapture", () => {
  it("returns a deterministic key + presigned url, commit upserts one row per item", async () => {
    const { db, close, bookingId, itemId } = await seedWithItem();
    const start = await startCapture(db, { bookingId, kind: "pre", checklistItemId: itemId }, deps);
    expect(start.key).toBe(`walkthroughs/${start.walkthroughId}/${itemId}.jpg`);
    expect(start.uploadUrl).toContain("https://r2/");

    await commitCapture(db, { walkthroughId: start.walkthroughId, checklistItemId: itemId, sha256: "h1", bytes: 100, contentType: "image/jpeg", lat: 33.7, lng: -84.4 });
    // retake — same item overwrites, still one row
    await commitCapture(db, { walkthroughId: start.walkthroughId, checklistItemId: itemId, sha256: "h2", bytes: 120, contentType: "image/jpeg" });
    const rows = await db.select().from(walkthroughPhotos).where(eq(walkthroughPhotos.walkthroughId, start.walkthroughId));
    expect(rows).toHaveLength(1);
    expect(rows[0].sha256).toBe("h2");
    await close();
  });

  it("refuses capture on a locked walkthrough", async () => {
    const { db, close, bookingId, itemId } = await seedWithItem();
    const start = await startCapture(db, { bookingId, kind: "pre", checklistItemId: itemId }, deps);
    await db.update(wt).set({ lockedAt: new Date() }).where(eq(wt.id, start.walkthroughId));
    await expect(
      startCapture(db, { bookingId, kind: "pre", checklistItemId: itemId }, deps)
    ).rejects.toBeInstanceOf(WalkthroughLockedError);
    await expect(
      commitCapture(db, { walkthroughId: start.walkthroughId, checklistItemId: itemId, sha256: "x", bytes: 1, contentType: "image/jpeg" })
    ).rejects.toBeInstanceOf(WalkthroughLockedError);
    await close();
  });
});
```

- [ ] **Step 2: Run it, expect FAIL** — `nvm use 20 && npm run test -- lib/walkthrough.test`.

- [ ] **Step 3: Implement** (append to `lib/walkthrough.ts`)

```ts
import { walkthroughPhotos } from "@/db/schema";

export type Photo = typeof walkthroughPhotos.$inferSelect;
export class WalkthroughLockedError extends Error {}

export type StartCaptureDeps = { getUploadUrl: (key: string, contentType: string) => Promise<string> };

export async function startCapture(
  db: Db,
  args: { bookingId: string; kind: WalkthroughKind; checklistItemId: string; contentType?: string },
  deps: StartCaptureDeps
): Promise<{ key: string; uploadUrl: string; walkthroughId: string }> {
  const w = await getOrCreateWalkthrough(db, args.bookingId, args.kind);
  if (w.lockedAt) throw new WalkthroughLockedError("walkthrough is locked");
  const key = photoKey(w.id, args.checklistItemId);
  const uploadUrl = await deps.getUploadUrl(key, args.contentType ?? "image/jpeg");
  return { key, uploadUrl, walkthroughId: w.id };
}

export async function commitCapture(
  db: Db,
  args: { walkthroughId: string; checklistItemId: string; sha256: string; bytes: number;
          contentType: string; lat?: number | null; lng?: number | null },
  now: () => Date = () => new Date()
): Promise<Photo> {
  const [w] = await db.select().from(walkthroughs).where(eq(walkthroughs.id, args.walkthroughId));
  if (!w) throw new WalkthroughLockedError("walkthrough not found");
  if (w.lockedAt) throw new WalkthroughLockedError("walkthrough is locked");
  const [row] = await db.insert(walkthroughPhotos)
    .values({
      walkthroughId: args.walkthroughId, checklistItemId: args.checklistItemId,
      r2Key: photoKey(args.walkthroughId, args.checklistItemId),
      serverCapturedAt: now(), sha256: args.sha256, bytes: args.bytes,
      contentType: args.contentType, lat: args.lat ?? null, lng: args.lng ?? null,
    })
    .onConflictDoUpdate({
      target: [walkthroughPhotos.walkthroughId, walkthroughPhotos.checklistItemId],
      set: { r2Key: photoKey(args.walkthroughId, args.checklistItemId), serverCapturedAt: now(),
             sha256: args.sha256, bytes: args.bytes, contentType: args.contentType,
             lat: args.lat ?? null, lng: args.lng ?? null },
    })
    .returning();
  return row;
}
```
Add `walkthroughs` to the existing `select` imports as needed (already imported).

- [ ] **Step 4: Run it, expect PASS** — `nvm use 20 && npm run test -- lib/walkthrough.test`.

- [ ] **Step 5: Commit**

```bash
git add lib/walkthrough.ts lib/walkthrough.test.ts
git commit -m "feat(walkthrough): startCapture (presigned) + commitCapture (per-item upsert) with locked guard"
```

---

## Task 4: `lockWalkthrough` + `skipWalkthrough`

**Files:**
- Modify: `lib/walkthrough.ts`, `lib/walkthrough.test.ts`

**Interfaces:**
- Produces:
  - `lockWalkthrough(db, walkthroughId, opts?: { requireItemCount?: number }, now?): Promise<{ locked: boolean; alreadyLocked: boolean }>` — CAS on `locked_at IS NULL`; throws `IncompleteWalkthroughError` if `requireItemCount` given and fewer photos exist.
  - `skipWalkthrough(db, bookingId, now?): Promise<void>` — sets `bookings.deposit_protected = false`, `deposit_status_at` untouched (plain update; no `booking_events`).
  - `class IncompleteWalkthroughError extends Error`

- [ ] **Step 1: Write the failing test** (append)

```ts
import { lockWalkthrough, skipWalkthrough, IncompleteWalkthroughError } from "@/lib/walkthrough";

describe("lockWalkthrough", () => {
  it("blocks lock until required item count is met, then is idempotent", async () => {
    const { db, close, bookingId, itemId } = await seedWithItem();
    const start = await startCapture(db, { bookingId, kind: "pre", checklistItemId: itemId }, deps);
    await expect(lockWalkthrough(db, start.walkthroughId, { requireItemCount: 1 }))
      .rejects.toBeInstanceOf(IncompleteWalkthroughError);
    await commitCapture(db, { walkthroughId: start.walkthroughId, checklistItemId: itemId, sha256: "h", bytes: 1, contentType: "image/jpeg" });
    const first = await lockWalkthrough(db, start.walkthroughId, { requireItemCount: 1 });
    expect(first).toEqual({ locked: true, alreadyLocked: false });
    const second = await lockWalkthrough(db, start.walkthroughId, { requireItemCount: 1 });
    expect(second).toEqual({ locked: false, alreadyLocked: true });
    await close();
  });
});

describe("skipWalkthrough", () => {
  it("clears deposit_protected", async () => {
    const { db, close, bookingId } = await seedWithItem();
    await skipWalkthrough(db, bookingId);
    const [b] = await db.select().from(bookings).where(eq(bookings.id, bookingId));
    expect(b.depositProtected).toBe(false);
    await close();
  });
});
```

- [ ] **Step 2: Run it, expect FAIL.**

- [ ] **Step 3: Implement** (append to `lib/walkthrough.ts`)

```ts
import { bookings } from "@/db/schema";
import { sql, isNull } from "drizzle-orm";

export class IncompleteWalkthroughError extends Error {}

export async function lockWalkthrough(
  db: Db, walkthroughId: string,
  opts: { requireItemCount?: number } = {}, now: () => Date = () => new Date()
): Promise<{ locked: boolean; alreadyLocked: boolean }> {
  if (opts.requireItemCount != null) {
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(walkthroughPhotos)
      .where(eq(walkthroughPhotos.walkthroughId, walkthroughId));
    if (count < opts.requireItemCount) {
      throw new IncompleteWalkthroughError(`need ${opts.requireItemCount} photos, have ${count}`);
    }
  }
  const updated = await db.update(walkthroughs)
    .set({ lockedAt: now() })
    .where(and(eq(walkthroughs.id, walkthroughId), isNull(walkthroughs.lockedAt)))
    .returning({ id: walkthroughs.id });
  if (updated.length > 0) return { locked: true, alreadyLocked: false };
  return { locked: false, alreadyLocked: true };
}

export async function skipWalkthrough(db: Db, bookingId: string): Promise<void> {
  await db.update(bookings).set({ depositProtected: false }).where(eq(bookings.id, bookingId));
}
```

- [ ] **Step 4: Run it, expect PASS.**

- [ ] **Step 5: Commit**

```bash
git add lib/walkthrough.ts lib/walkthrough.test.ts
git commit -m "feat(walkthrough): lockWalkthrough (CAS + completeness guard) + skipWalkthrough"
```

---

## Task 5: Read model + reminder queries

**Files:**
- Modify: `lib/walkthrough.ts`, `lib/walkthrough.test.ts`

**Interfaces:**
- Produces:
  - `getWalkthroughWithPhotos(db, bookingId, kind): Promise<{ walkthrough: Walkthrough; photos: Photo[] } | null>`
  - `getWalkthroughSummary(db, bookingId): Promise<{ preLocked: boolean; postLocked: boolean }>` — used by the detail page for affordances.
  - `bookingsNeedingPreReminder(db, now: Date, windowHours: number): Promise<{ bookingId: string; studioId: string }[]>` — `confirmed` bookings with `starts_at` in `(now, now + windowHours]`, no started `pre` walkthrough, `pre_reminder_sent_at IS NULL`.
  - `markPreReminderSent(db, bookingId, at: Date): Promise<void>`

- [ ] **Step 1: Write the failing test** (append; covers summary + reminder window + idempotency)

```ts
import { getWalkthroughWithPhotos, getWalkthroughSummary, bookingsNeedingPreReminder, markPreReminderSent } from "@/lib/walkthrough";

describe("getWalkthroughSummary", () => {
  it("reports pre/post lock state", async () => {
    const { db, close, bookingId, itemId } = await seedWithItem();
    let sum = await getWalkthroughSummary(db, bookingId);
    expect(sum).toEqual({ preLocked: false, postLocked: false });
    const start = await startCapture(db, { bookingId, kind: "pre", checklistItemId: itemId }, deps);
    await commitCapture(db, { walkthroughId: start.walkthroughId, checklistItemId: itemId, sha256: "h", bytes: 1, contentType: "image/jpeg" });
    await lockWalkthrough(db, start.walkthroughId);
    sum = await getWalkthroughSummary(db, bookingId);
    expect(sum.preLocked).toBe(true);
    const wp = await getWalkthroughWithPhotos(db, bookingId, "pre");
    expect(wp?.photos).toHaveLength(1);
    await close();
  });
});

describe("bookingsNeedingPreReminder", () => {
  it("selects confirmed bookings inside the window, once", async () => {
    const { db, close } = await createTestDb();
    const [s] = await db.insert(studios).values({ clerkUserId: "u1", name: "S", slug: "s" }).returning();
    const now = new Date("2026-08-01T15:00:00Z");
    const [b] = await db.insert(bookings).values({
      studioId: s.id, state: "confirmed", renterName: "R", renterEmail: "r@x.com",
      startsAt: new Date("2026-08-01T17:00:00Z"), endsAt: new Date("2026-08-01T21:00:00Z"),
    }).returning();
    let due = await bookingsNeedingPreReminder(db, now, 3);
    expect(due.map((d) => d.bookingId)).toContain(b.id);
    await markPreReminderSent(db, b.id, now);
    due = await bookingsNeedingPreReminder(db, now, 3);
    expect(due.map((d) => d.bookingId)).not.toContain(b.id);
    await close();
  });
});
```

- [ ] **Step 2: Run it, expect FAIL.**

- [ ] **Step 3: Implement** (append to `lib/walkthrough.ts`)

```ts
import { gt, lte, asc } from "drizzle-orm";

export async function getWalkthroughWithPhotos(
  db: Db, bookingId: string, kind: WalkthroughKind
): Promise<{ walkthrough: Walkthrough; photos: Photo[] } | null> {
  const [w] = await db.select().from(walkthroughs)
    .where(and(eq(walkthroughs.bookingId, bookingId), eq(walkthroughs.kind, kind)));
  if (!w) return null;
  const photos = await db.select().from(walkthroughPhotos)
    .where(eq(walkthroughPhotos.walkthroughId, w.id))
    .orderBy(asc(walkthroughPhotos.serverCapturedAt));
  return { walkthrough: w, photos };
}

export async function getWalkthroughSummary(
  db: Db, bookingId: string
): Promise<{ preLocked: boolean; postLocked: boolean }> {
  const rows = await db.select().from(walkthroughs).where(eq(walkthroughs.bookingId, bookingId));
  const pre = rows.find((r) => r.kind === "pre");
  const post = rows.find((r) => r.kind === "post");
  return { preLocked: !!pre?.lockedAt, postLocked: !!post?.lockedAt };
}

export async function bookingsNeedingPreReminder(
  db: Db, now: Date, windowHours: number
): Promise<{ bookingId: string; studioId: string }[]> {
  const end = new Date(now.getTime() + windowHours * 3600_000);
  const rows = await db.select({ bookingId: bookings.id, studioId: bookings.studioId })
    .from(bookings)
    .where(and(
      eq(bookings.state, "confirmed"),
      gt(bookings.startsAt, now),
      lte(bookings.startsAt, end),
      isNull(bookings.preReminderSentAt),
    ));
  // Exclude those with a started pre-walkthrough.
  const started = await db.select({ bookingId: walkthroughs.bookingId })
    .from(walkthroughs).where(eq(walkthroughs.kind, "pre"));
  const startedSet = new Set(started.map((r) => r.bookingId));
  return rows.filter((r) => !startedSet.has(r.bookingId));
}

export async function markPreReminderSent(db: Db, bookingId: string, at: Date): Promise<void> {
  await db.update(bookings).set({ preReminderSentAt: at }).where(eq(bookings.id, bookingId));
}
```

- [ ] **Step 4: Run it, expect PASS.**

- [ ] **Step 5: Commit**

```bash
git add lib/walkthrough.ts lib/walkthrough.test.ts
git commit -m "feat(walkthrough): read model + reminder-window query with idempotency stamp"
```

---

## Task 6: `booking-view.ts` — `walkthroughEntries` affordance helper

**Files:**
- Modify: `lib/domain/booking-view.ts`, `lib/domain/booking-view.test.ts`

**Interfaces:**
- Produces:
  - `type WalkthroughEntry = "start_pre_walkthrough" | "start_post_walkthrough"`
  - `walkthroughEntries(effectiveState: BookingState, locks: { preLocked: boolean; postLocked: boolean }): WalkthroughEntry[]` — pre when effective ∈ {confirmed, event_day} and !preLocked; post when effective === post_event and !postLocked.

- [ ] **Step 1: Write the failing test** (append to `booking-view.test.ts`)

```ts
import { walkthroughEntries } from "@/lib/domain/booking-view";

describe("walkthroughEntries", () => {
  const none = { preLocked: false, postLocked: false };
  it("offers pre on confirmed and event_day", () => {
    expect(walkthroughEntries("confirmed", none)).toEqual(["start_pre_walkthrough"]);
    expect(walkthroughEntries("event_day", none)).toEqual(["start_pre_walkthrough"]);
  });
  it("offers post only on post_event", () => {
    expect(walkthroughEntries("post_event", none)).toEqual(["start_post_walkthrough"]);
  });
  it("hides an entry once its walkthrough is locked", () => {
    expect(walkthroughEntries("event_day", { preLocked: true, postLocked: false })).toEqual([]);
    expect(walkthroughEntries("post_event", { preLocked: true, postLocked: true })).toEqual([]);
  });
  it("offers nothing before confirmed or on terminal states", () => {
    expect(walkthroughEntries("pending", none)).toEqual([]);
    expect(walkthroughEntries("closed", none)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it, expect FAIL.**

- [ ] **Step 3: Implement** (append to `lib/domain/booking-view.ts`)

```ts
export type WalkthroughEntry = "start_pre_walkthrough" | "start_post_walkthrough";

export function walkthroughEntries(
  effectiveState: BookingState,
  locks: { preLocked: boolean; postLocked: boolean }
): WalkthroughEntry[] {
  const out: WalkthroughEntry[] = [];
  if ((effectiveState === "confirmed" || effectiveState === "event_day") && !locks.preLocked) {
    out.push("start_pre_walkthrough");
  }
  if (effectiveState === "post_event" && !locks.postLocked) {
    out.push("start_post_walkthrough");
  }
  return out;
}
```

- [ ] **Step 4: Run it, expect PASS** — `nvm use 20 && npm run test -- booking-view`.

- [ ] **Step 5: Commit**

```bash
git add lib/domain/booking-view.ts lib/domain/booking-view.test.ts
git commit -m "feat(booking-view): walkthroughEntries affordance helper"
```

---

## Task 7: `lib/capture.ts` — pure client helpers

**Files:**
- Create: `lib/capture.ts`, `lib/capture.test.ts`

**Interfaces:**
- Produces:
  - `parseKind(raw: string): "pre" | "post" | null`
  - `isInAppWebview(ua: string): boolean` — true for known in-app browsers (FBAN/FBAV, Instagram, Line, GmailApp, and iOS Mail signature).
  - `sha256Hex(bytes: ArrayBuffer): Promise<string>` — lowercase hex via `crypto.subtle.digest`.
  - `compressToJpeg(source: CanvasImageSource, srcW: number, srcH: number, maxEdge?: number, quality?: number): Promise<Blob>` — canvas downscale to JPEG (browser-only; not unit-tested, but pure of app state).

- [ ] **Step 1: Write the failing test** (`lib/capture.test.ts`) — only the environment-independent helpers:

```ts
import { describe, it, expect } from "vitest";
import { parseKind, isInAppWebview, sha256Hex } from "@/lib/capture";

describe("parseKind", () => {
  it("accepts pre/post, rejects others", () => {
    expect(parseKind("pre")).toBe("pre");
    expect(parseKind("post")).toBe("post");
    expect(parseKind("PRE")).toBeNull();
    expect(parseKind("x")).toBeNull();
  });
});

describe("isInAppWebview", () => {
  it("flags known in-app browsers", () => {
    expect(isInAppWebview("Mozilla/5.0 ... [FBAN/FBIOS;FBAV/...]")).toBe(true);
    expect(isInAppWebview("Mozilla/5.0 ... Instagram 300.0")).toBe(true);
    expect(isInAppWebview("Mozilla/5.0 ... GmailApp")).toBe(true);
  });
  it("passes real Safari/Chrome", () => {
    expect(isInAppWebview("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AppleWebKit/605 Version/17.0 Mobile/15E148 Safari/604.1")).toBe(false);
  });
});

describe("sha256Hex", () => {
  it("hashes known bytes (empty → e3b0c442...)", async () => {
    const hex = await sha256Hex(new Uint8Array([]).buffer);
    expect(hex).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });
});
```

- [ ] **Step 2: Run it, expect FAIL.**

- [ ] **Step 3: Implement** (`lib/capture.ts`)

```ts
export function parseKind(raw: string): "pre" | "post" | null {
  return raw === "pre" || raw === "post" ? raw : null;
}

const WEBVIEW_MARKERS = [/FBAN|FBAV|FB_IAB/i, /Instagram/i, /\bLine\//i, /GmailApp/i, /\bMicroMessenger\b/i];
export function isInAppWebview(ua: string): boolean {
  return WEBVIEW_MARKERS.some((re) => re.test(ua));
}

export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Downscale a captured frame/image to a compressed JPEG. Browser-only. */
export async function compressToJpeg(
  source: CanvasImageSource, srcW: number, srcH: number, maxEdge = 1600, quality = 0.8
): Promise<Blob> {
  const scale = Math.min(1, maxEdge / Math.max(srcW, srcH));
  const w = Math.round(srcW * scale), h = Math.round(srcH * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  ctx.drawImage(source, 0, 0, w, h);
  return await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/jpeg", quality)
  );
}
```

- [ ] **Step 4: Run it, expect PASS.** (If `crypto.subtle` is undefined in the vitest env, add `import { webcrypto } from "node:crypto"` guard in the test setup — Node 20 exposes global `crypto`.)

- [ ] **Step 5: Commit**

```bash
git add lib/capture.ts lib/capture.test.ts
git commit -m "feat(capture): pure helpers — parseKind, webview detection, sha256Hex, jpeg compression"
```

---

## Task 8: PWA manifest + icons + install hint

**Files:**
- Create: `app/manifest.ts`, `app/manifest.test.ts`, `public/icon-192.png`, `public/icon-512.png`, `public/apple-touch-icon.png`
- Create: `app/(owner)/dashboard/bookings/[id]/walkthrough/[kind]/_components/InstallHint.tsx`
- Modify: `app/layout.tsx` (add `appleWebApp`/theme-color metadata if not present)

**Interfaces:**
- Produces: `manifest()` default export returning a `MetadataRoute.Manifest` with `name`, `short_name: "VenueDash"`, `display: "standalone"`, `theme_color: "#0b0c0f"`, `background_color: "#0b0c0f"`, and the three icons.

- [ ] **Step 1: Write the failing test** (`app/manifest.test.ts`)

```ts
import { describe, it, expect } from "vitest";
import manifest from "@/app/manifest";

describe("PWA manifest", () => {
  it("is a standalone installable manifest with icons", () => {
    const m = manifest();
    expect(m.display).toBe("standalone");
    expect(m.short_name).toBe("VenueDash");
    expect(m.theme_color).toBe("#0b0c0f");
    expect((m.icons ?? []).map((i) => i.sizes)).toEqual(expect.arrayContaining(["192x192", "512x512"]));
  });
});
```

- [ ] **Step 2: Run it, expect FAIL.**

- [ ] **Step 3: Implement** (`app/manifest.ts`)

```ts
import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "VenueDash — Condition Documentation",
    short_name: "VenueDash",
    description: "Owner pre/post photo walkthroughs — timestamped documentation of your space.",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#0b0c0f",
    theme_color: "#0b0c0f",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
```

- [ ] **Step 4: Generate the three PNG icons.** Use a simple solid-accent tile (no external fetch). Run this Node script once from repo root (writes valid PNGs via a tiny generator) — or create them with any local tool; they must be non-empty PNGs of the stated sizes:

```bash
nvm use 20 && node scripts/gen-icons.mjs   # create this helper: draws a #7a86ff rounded tile with "VD" on #0b0c0f using @napi-rs/canvas if available, else a flat-color PNG. Commit the PNGs; the script is dev-only.
```
If no canvas lib is available, generate flat #7a86ff PNGs at 192/512 and a 180×180 apple-touch-icon (a minimal PNG encoder is acceptable). The icons are placeholders to be refined in the human UI pass.

- [ ] **Step 5: Implement `InstallHint.tsx`** (client) — a dismissible banner shown when `display-mode: standalone` is NOT active:

```tsx
"use client";
import { useEffect, useState } from "react";

export default function InstallHint() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)").matches
      || (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    setShow(!standalone);
  }, []);
  if (!show) return null;
  return (
    <div className="rounded-lg border border-owner-border bg-owner-panel px-3 py-2 text-[12px] text-owner-muted">
      Tip: add VenueDash to your home screen for the most reliable camera — Share → Add to Home Screen.
    </div>
  );
}
```

- [ ] **Step 6: Add app-icon metadata** to `app/layout.tsx` `metadata` export (merge, don't remove existing): `appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "VenueDash" }` and `icons: { apple: "/apple-touch-icon.png" }`.

- [ ] **Step 7: Run test + build** — `nvm use 20 && npm run test -- manifest && npm run build`. Expected PASS + successful build (manifest route compiles).

- [ ] **Step 8: Commit**

```bash
git add app/manifest.ts app/manifest.test.ts app/layout.tsx public/icon-192.png public/icon-512.png public/apple-touch-icon.png scripts/gen-icons.mjs "app/(owner)/dashboard/bookings/[id]/walkthrough/[kind]/_components/InstallHint.tsx"
git commit -m "feat(pwa): installable manifest, icons, apple-web-app metadata, install hint"
```

---

## Task 9: Walkthrough forms + server actions

**Files:**
- Create: `app/(owner)/dashboard/bookings/[id]/walkthrough/[kind]/forms.ts`, `forms.test.ts`
- Create: `app/(owner)/dashboard/bookings/[id]/walkthrough/[kind]/actions.ts`

**Interfaces:**
- Consumes: `startCapture`, `commitCapture`, `lockWalkthrough`, `skipWalkthrough`, `parseKind`, `getSignedUploadUrl`, `getBookingForOwner`, `getStudioByClerkUserId`.
- Produces (all `"use server"` async):
  - `requestUpload(bookingId, kind, checklistItemId, contentType): Promise<{ ok: true; key; uploadUrl; walkthroughId } | { ok: false; error }>`
  - `commitPhoto(bookingId, kind, input: { walkthroughId; checklistItemId; sha256; bytes; contentType; lat; lng }): Promise<{ ok: boolean; error?: string }>`
  - `lockWalkthroughAction(bookingId, kind, requiredCount): Promise<{ ok: boolean; error?: string }>`
  - `skipWalkthroughAction(bookingId): Promise<{ ok: boolean; error?: string }>`
  - `forms.ts`: `parseCommitInput(fd)` if a FormData path is used; the client calls actions directly with typed args, so `forms.ts` holds only shared constants (`REMINDER_WINDOW_HOURS = 3`) + a pure `isValidKind` re-export. Keep `forms.ts` free of `"use server"`.

- [ ] **Step 1: Write the failing test** for `forms.ts` (`forms.test.ts`) — the only unit-testable slice:

```ts
import { describe, it, expect } from "vitest";
import { REMINDER_WINDOW_HOURS, coerceKind } from "./forms";

describe("walkthrough forms", () => {
  it("exposes the reminder window and coerces kind", () => {
    expect(REMINDER_WINDOW_HOURS).toBe(3);
    expect(coerceKind("pre")).toBe("pre");
    expect(coerceKind("nope")).toBeNull();
  });
});
```

- [ ] **Step 2: Run it, expect FAIL.**

- [ ] **Step 3: Implement `forms.ts`**

```ts
import { parseKind } from "@/lib/capture";
export const REMINDER_WINDOW_HOURS = 3;
export function coerceKind(raw: string): "pre" | "post" | null {
  return parseKind(raw);
}
```

- [ ] **Step 4: Run it, expect PASS.**

- [ ] **Step 5: Implement `actions.ts`** (`"use server"`, Node runtime, owner-scoped authz — mirror `bookings/[id]/actions.ts` `ownerContext`):

```ts
"use server";
import { auth } from "@clerk/nextjs/server";
import { redirect, notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import { getStudioByClerkUserId } from "@/lib/studio";
import { getBookingForOwner } from "@/lib/booking";
import { getSignedUploadUrl } from "@/lib/storage";
import {
  startCapture, commitCapture, lockWalkthrough, skipWalkthrough,
  WalkthroughLockedError, IncompleteWalkthroughError,
} from "@/lib/walkthrough";
import { coerceKind } from "./forms";

async function ctx(bookingId: string) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");
  const db = getDb();
  const studio = await getStudioByClerkUserId(db, userId);
  if (!studio) redirect("/settings");
  const booking = await getBookingForOwner(db, bookingId, studio.id);
  if (!booking) notFound();
  return { db, booking };
}

export async function requestUpload(
  bookingId: string, kind: string, checklistItemId: string, contentType: string
) {
  const k = coerceKind(kind); if (!k) return { ok: false as const, error: "bad kind" };
  const { db } = await ctx(bookingId);
  try {
    const r = await startCapture(db, { bookingId, kind: k, checklistItemId, contentType },
      { getUploadUrl: (key, ct) => getSignedUploadUrl(key, ct) });
    return { ok: true as const, ...r };
  } catch (e) {
    if (e instanceof WalkthroughLockedError) return { ok: false as const, error: "This walkthrough is locked." };
    throw e;
  }
}

export async function commitPhoto(
  bookingId: string, kind: string,
  input: { walkthroughId: string; checklistItemId: string; sha256: string; bytes: number; contentType: string; lat: number | null; lng: number | null }
) {
  const { db } = await ctx(bookingId);
  try {
    await commitCapture(db, input);
    revalidatePath(`/dashboard/bookings/${bookingId}/walkthrough/${kind}`);
    return { ok: true as const };
  } catch (e) {
    if (e instanceof WalkthroughLockedError) return { ok: false as const, error: "This walkthrough is locked." };
    throw e;
  }
}

export async function lockWalkthroughAction(bookingId: string, kind: string, requiredCount: number) {
  const k = coerceKind(kind); if (!k) return { ok: false as const, error: "bad kind" };
  const { db } = await ctx(bookingId);
  const { getOrCreateWalkthrough } = await import("@/lib/walkthrough");
  const w = await getOrCreateWalkthrough(db, bookingId, k);
  try {
    await lockWalkthrough(db, w.id, { requireItemCount: requiredCount });
  } catch (e) {
    if (e instanceof IncompleteWalkthroughError) return { ok: false as const, error: "Capture every area before locking." };
    throw e;
  }
  revalidatePath(`/dashboard/bookings/${bookingId}`);
  revalidatePath(`/dashboard/bookings/${bookingId}/walkthrough/${kind}`);
  return { ok: true as const };
}

export async function skipWalkthroughAction(bookingId: string) {
  const { db } = await ctx(bookingId);
  await skipWalkthrough(db, bookingId);
  revalidatePath(`/dashboard/bookings/${bookingId}`);
  return { ok: true as const };
}
```

- [ ] **Step 6: Typecheck** — `nvm use 20 && npm run typecheck`. Expected clean.

- [ ] **Step 7: Commit**

```bash
git add "app/(owner)/dashboard/bookings/[id]/walkthrough/[kind]/forms.ts" "app/(owner)/dashboard/bookings/[id]/walkthrough/[kind]/forms.test.ts" "app/(owner)/dashboard/bookings/[id]/walkthrough/[kind]/actions.ts"
git commit -m "feat(walkthrough): owner-scoped server actions (requestUpload/commitPhoto/lock/skip)"
```

---

## Task 10: Capture page + `CaptureFlow` client component

**Files:**
- Create: `app/(owner)/dashboard/bookings/[id]/walkthrough/[kind]/page.tsx`
- Create: `app/(owner)/dashboard/bookings/[id]/walkthrough/[kind]/_components/CaptureFlow.tsx`

**Interfaces:**
- Consumes: `getBookingForOwner`, `getStudioByClerkUserId`, `getWalkthroughWithPhotos`, checklist items query, `toBookingView`, `parseKind`; actions from Task 9; `isInAppWebview`, `compressToJpeg`, `sha256Hex` from `lib/capture`.
- Produces: the rendered walkthrough capture surface.

- [ ] **Step 1: Implement the server `page.tsx`** — validate kind, load booking (studio-scoped), checklist items (ordered), and any existing photos (resume), gate by effective state, hand data to `CaptureFlow`:

```tsx
import { auth } from "@clerk/nextjs/server";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getDb } from "@/lib/db";
import { getStudioByClerkUserId } from "@/lib/studio";
import { getBookingForOwner } from "@/lib/booking";
import { getWalkthroughWithPhotos } from "@/lib/walkthrough";
import { deriveEffectiveState } from "@/lib/domain/effective-state";
import { parseKind } from "@/lib/capture";
import { checklistItems } from "@/db/schema";
import { asc, eq } from "drizzle-orm";
import CaptureFlow from "./_components/CaptureFlow";

export default async function WalkthroughPage(
  { params }: { params: Promise<{ id: string; kind: string }> }
) {
  const { id, kind } = await params;
  const k = parseKind(kind); if (!k) notFound();
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");
  const db = getDb();
  const studio = await getStudioByClerkUserId(db, userId);
  if (!studio) redirect("/settings");
  const booking = await getBookingForOwner(db, id, studio.id);
  if (!booking) notFound();

  const effective = deriveEffectiveState(booking, new Date());
  const preOk = k === "pre" && (effective === "confirmed" || effective === "event_day");
  const postOk = k === "post" && effective === "post_event";
  if (!preOk && !postOk) {
    // Not yet due (or already past) — send them back to the detail page.
    redirect(`/dashboard/bookings/${id}`);
  }

  const items = await db.select().from(checklistItems)
    .where(eq(checklistItems.studioId, studio.id)).orderBy(asc(checklistItems.position));
  const existing = await getWalkthroughWithPhotos(db, id, k);

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-4 py-4">
      <Link href={`/dashboard/bookings/${id}`} className="text-sm text-owner-muted hover:text-owner-text">← Back</Link>
      <CaptureFlow
        bookingId={id}
        kind={k}
        renterName={booking.renterName}
        locked={!!existing?.walkthrough.lockedAt}
        items={items.map((it) => ({ id: it.id, name: it.name, hint: it.hint }))}
        captured={(existing?.photos ?? []).map((p) => ({ checklistItemId: p.checklistItemId, serverCapturedAt: p.serverCapturedAt.toISOString() }))}
      />
    </main>
  );
}
```

- [ ] **Step 2: Implement `CaptureFlow.tsx`** (client). Port the prototype's mobile checklist screens (`prototype/VenueDash_Prototype.dc.html` ~L431–510), rewriting copy to v0.5 truth. It manages: getUserMedia stream (fallback to file input), webview interstitial, per-item capture → compress → `sha256Hex` → `requestUpload` → `PUT` to R2 → `commitPhoto`, geolocation, progress, review grid, lock. Key logic (the parts that must be exact):

```tsx
"use client";
import { useEffect, useRef, useState } from "react";
import { isInAppWebview, compressToJpeg, sha256Hex } from "@/lib/capture";
import { requestUpload, commitPhoto, lockWalkthroughAction, skipWalkthroughAction } from "../actions";

type Item = { id: string; name: string; hint: string | null };
type Props = {
  bookingId: string; kind: "pre" | "post"; renterName: string; locked: boolean;
  items: Item[]; captured: { checklistItemId: string | null; serverCapturedAt: string }[];
};

async function getGeo(): Promise<{ lat: number | null; lng: number | null }> {
  if (!("geolocation" in navigator)) return { lat: null, lng: null };
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => resolve({ lat: null, lng: null }),
      { enableHighAccuracy: false, timeout: 4000 }
    );
  });
}

export default function CaptureFlow(props: Props) {
  const { bookingId, kind, items } = props;
  const [idx, setIdx] = useState(0);
  const [done, setDone] = useState<Record<string, boolean>>(
    () => Object.fromEntries(props.captured.filter(c => c.checklistItemId).map(c => [c.checklistItemId as string, true]))
  );
  const [phase, setPhase] = useState<"intro" | "capture" | "review" | "locked">(props.locked ? "locked" : "intro");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [useFallback, setUseFallback] = useState(false);
  const [webview, setWebview] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => { setWebview(isInAppWebview(navigator.userAgent)); }, []);

  async function startCamera() {
    try {
      if (!navigator.mediaDevices?.getUserMedia) { setUseFallback(true); return; }
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
      streamRef.current = stream;
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }
    } catch { setUseFallback(true); }
  }
  function stopCamera() { streamRef.current?.getTracks().forEach(t => t.stop()); streamRef.current = null; }
  useEffect(() => () => stopCamera(), []);

  async function uploadBlob(item: Item, blob: Blob) {
    setBusy(true); setErr(null);
    try {
      const buf = await blob.arrayBuffer();
      const sha256 = await sha256Hex(buf);
      const start = await requestUpload(bookingId, kind, item.id, "image/jpeg");
      if (!start.ok) { setErr(start.error); return; }
      const put = await fetch(start.uploadUrl, { method: "PUT", headers: { "Content-Type": "image/jpeg" }, body: blob });
      if (!put.ok) { setErr("Upload failed — check your connection and retake."); return; }
      const geo = await getGeo();
      const res = await commitPhoto(bookingId, kind, {
        walkthroughId: start.walkthroughId, checklistItemId: item.id,
        sha256, bytes: blob.size, contentType: "image/jpeg", lat: geo.lat, lng: geo.lng,
      });
      if (!res.ok) { setErr(res.error ?? "Could not save."); return; }
      setDone(d => ({ ...d, [item.id]: true }));
    } finally { setBusy(false); }
  }

  async function captureFromVideo(item: Item) {
    const v = videoRef.current; if (!v) return;
    const blob = await compressToJpeg(v, v.videoWidth, v.videoHeight);
    await uploadBlob(item, blob);
  }
  async function captureFromFile(item: Item, file: File) {
    const bitmap = await createImageBitmap(file);
    const blob = await compressToJpeg(bitmap, bitmap.width, bitmap.height);
    await uploadBlob(item, blob);
  }

  async function lock() {
    setBusy(true); setErr(null);
    const res = await lockWalkthroughAction(bookingId, kind, items.length);
    setBusy(false);
    if (!res.ok) { setErr(res.error ?? "Could not lock."); return; }
    stopCamera(); setPhase("locked");
  }
  async function skip() {
    if (!confirm("Skip this walkthrough? Without it, no defensible timestamped record exists for this event and the deposit is marked unprotected.")) return;
    await skipWalkthroughAction(bookingId);
    window.location.href = `/dashboard/bookings/${bookingId}`;
  }

  // Render intro (with webview interstitial + skip), capture (per item, live or fallback),
  // review (grid of captured items + lock warning), locked (confirmation). Copy is v0.5 truth:
  // "timestamped documentation", never "immutable evidence"/"proof". Port layout from the prototype.
  // ...JSX omitted here for brevity in the plan header; implement all four phases faithfully.
  return null; // replace with the four-phase JSX per the spec §6
}
```
Implement all four phases' JSX (intro/capture/review/locked) porting the prototype layout and rewriting copy. The **webview interstitial**: when `webview` is true, show "Open in Safari / your installed app to use the live camera" plus the file-input fallback (`<input type="file" accept="image/*" capture="environment">`). The **capture screen** wires the "Capture photo" button to `captureFromVideo`/`captureFromFile`; captured state shows a server-timestamp/geo confirmation and Retake/Next; the last item routes to review. **Review** shows the grid + the lock warning + a "Lock {pre/post}-event documentation" button (calls `lock()`) and a subordinate "Skip walkthrough" link (calls `skip()`).

- [ ] **Step 3: Typecheck + lint + build** — `nvm use 20 && npm run typecheck && npm run lint && npm run build`. Expected clean.

- [ ] **Step 4: Commit**

```bash
git add "app/(owner)/dashboard/bookings/[id]/walkthrough/[kind]/page.tsx" "app/(owner)/dashboard/bookings/[id]/walkthrough/[kind]/_components/CaptureFlow.tsx"
git commit -m "feat(walkthrough): capture surface — getUserMedia + fallback + webview interstitial, per-item upload, review, lock"
```

---

## Task 11: Photo download route (owner, presigned GET)

**Files:**
- Create: `app/(owner)/dashboard/bookings/[id]/walkthrough/[kind]/photo/[photoId]/route.ts`

**Interfaces:**
- Consumes: `getBookingForOwner`, `getStudioByClerkUserId`, `getWalkthroughWithPhotos`, `getSignedDownloadUrl`.
- Produces: `GET` → 302 to a presigned R2 URL for a photo that belongs to the owner's booking+kind; `notFound()` otherwise.

- [ ] **Step 1: Implement** (Node runtime; mirror the contract owner route's auth boundary)

```ts
import { auth } from "@clerk/nextjs/server";
import { redirect, notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { getStudioByClerkUserId } from "@/lib/studio";
import { getBookingForOwner } from "@/lib/booking";
import { getWalkthroughWithPhotos } from "@/lib/walkthrough";
import { parseKind } from "@/lib/capture";
import { getSignedDownloadUrl } from "@/lib/storage";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; kind: string; photoId: string }> }
) {
  const { id, kind, photoId } = await params;
  const k = parseKind(kind); if (!k) notFound();
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");
  const db = getDb();
  const studio = await getStudioByClerkUserId(db, userId);
  if (!studio) redirect("/settings");
  const booking = await getBookingForOwner(db, id, studio.id);
  if (!booking) notFound();
  const wp = await getWalkthroughWithPhotos(db, id, k);
  const photo = wp?.photos.find((p) => p.id === photoId);
  if (!photo) notFound();
  const url = await getSignedDownloadUrl(photo.r2Key, 300);
  return Response.redirect(url, 302);
}
```

- [ ] **Step 2: Typecheck + build** — `nvm use 20 && npm run typecheck && npm run build`.

- [ ] **Step 3: Commit**

```bash
git add "app/(owner)/dashboard/bookings/[id]/walkthrough/[kind]/photo/[photoId]/route.ts"
git commit -m "feat(walkthrough): owner presigned photo download route (studio-scoped)"
```

---

## Task 12: Booking-detail integration — entry points + Condition documentation gallery

**Files:**
- Modify: `app/(owner)/dashboard/bookings/[id]/page.tsx`

**Interfaces:**
- Consumes: `walkthroughEntries`, `getWalkthroughSummary`, `getWalkthroughWithPhotos`.
- Produces: replaces the `event_day` card, `post_event` card, and the "Documentation" status card with real entry points + a locked-record gallery; shows the `deposit_protected=false` warning when skipped.

- [ ] **Step 1: Extend the page loader** — after `const view = toBookingView(...)`, add:

```tsx
import { getWalkthroughSummary, getWalkthroughWithPhotos } from "@/lib/walkthrough";
import { walkthroughEntries } from "@/lib/domain/booking-view";
// ...
const wtSummary = await getWalkthroughSummary(db, id);
const entries = walkthroughEntries(view.effectiveState, wtSummary);
const preRecord = wtSummary.preLocked ? await getWalkthroughWithPhotos(db, id, "pre") : null;
const postRecord = wtSummary.postLocked ? await getWalkthroughWithPhotos(db, id, "post") : null;
```

- [ ] **Step 2: Replace the `event_day` placeholder card** ("The walkthrough checklist arrives in a later release.") with a real entry when `entries` includes `start_pre_walkthrough`:

```tsx
{entries.includes("start_pre_walkthrough") ? (
  <div className="rounded-xl border border-[#4a3a1a] bg-[#1b1710] p-4">
    <div className="font-mono text-[10px] uppercase tracking-wider text-warning">
      {view.effectiveState === "event_day" ? "Event today · pre-event walkthrough" : "Pre-event walkthrough"}
    </div>
    <p className="mt-2 text-sm text-owner-text">
      Photograph every area before {booking.renterName} arrives — each photo is server-timestamped, geotagged, and locked into a timestamped record.
    </p>
    <Link href={`/dashboard/bookings/${booking.id}/walkthrough/pre`}
      className="mt-4 inline-block rounded-lg bg-owner-accent px-4 py-2 text-sm font-bold text-[#0d0e14]">
      Start pre-event walkthrough
    </Link>
  </div>
) : null}
```
Keep the `event_day` branch only for the non-entry case (e.g. pre already locked) — show a short "Pre-event documentation locked" note there instead of the old placeholder.

- [ ] **Step 3: Replace/augment the `post_event` card** to offer `start_post_walkthrough` when present (same shape, `/walkthrough/post`, copy "Photograph the space after the event…").

- [ ] **Step 4: Replace the "Documentation" status card** with a real state-aware card:

```tsx
<div className="rounded-xl border border-owner-border bg-owner-panel p-4">
  <div className="font-mono text-[10px] uppercase tracking-wider text-owner-muted">Condition documentation</div>
  {!booking.depositProtected ? (
    <p className="mt-2 text-xs text-warning">Walkthrough skipped — no defensible timestamped record exists for this event.</p>
  ) : null}
  <div className="mt-2 space-y-3 text-sm">
    <WalkthroughRecord label="Pre-event" bookingId={booking.id} kind="pre" record={preRecord} />
    <WalkthroughRecord label="Post-event" bookingId={booking.id} kind="post" record={postRecord} />
  </div>
</div>
```
Add a small local `WalkthroughRecord` component (in the same file or `_components/WalkthroughRecord.tsx`) that renders: "Locked · N photos · {date}" with a thumbnail row linking each photo to `/dashboard/bookings/{id}/walkthrough/{kind}/photo/{photoId}`, or "Not started/In progress" muted text when `record` is null. Copy discipline: "timestamped documentation," never "evidence."

- [ ] **Step 5: Typecheck + lint + build** — `nvm use 20 && npm run typecheck && npm run lint && npm run build`. Expected clean.

- [ ] **Step 6: Commit**

```bash
git add "app/(owner)/dashboard/bookings/[id]/page.tsx" "app/(owner)/dashboard/bookings/[id]/_components/WalkthroughRecord.tsx"
git commit -m "feat(walkthrough): booking-detail entry points + Condition documentation gallery + skip warning"
```

---

## Task 13: Reminder email template + protected cron route

**Files:**
- Create: `emails/WalkthroughReminder.tsx`, `app/api/cron/walkthrough-reminders/route.ts`
- Modify: `lib/email.ts`, `.env.example`

**Interfaces:**
- Consumes: `bookingsNeedingPreReminder`, `markPreReminderSent`, `getBookingForOwner`(studio owner lookup), `clerkClient`, `sendEmail`.
- Produces: `renderWalkthroughReminder(props)`; `POST /api/cron/walkthrough-reminders` guarded by bearer `CRON_SECRET`.

- [ ] **Step 1: Implement `WalkthroughReminder.tsx`** — dark owner-facing template mirroring `OwnerBookingRequest.tsx` structure. Props `{ renterName: string; startsAtLabel: string; bookingUrl: string }`. Copy: "Your event with {renterName} starts at {startsAtLabel}. Run the pre-event walkthrough to capture timestamped documentation of the space." CTA → `bookingUrl`. Export `renderWalkthroughReminder` in `lib/email.ts` following the existing `render(...)` helpers.

- [ ] **Step 2: Implement the cron route** (`app/api/cron/walkthrough-reminders/route.ts`, Node runtime):

```ts
import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { getDb } from "@/lib/db";
import { bookingsNeedingPreReminder, markPreReminderSent } from "@/lib/walkthrough";
import { getBookingForOwner } from "@/lib/booking";
import { getStudioById } from "@/lib/studio";
import { clerkClient } from "@clerk/nextjs/server";
import { sendEmail, renderWalkthroughReminder } from "@/lib/email";
import { formatAtlantaRange } from "@/lib/tz";
import { baseUrl } from "@/lib/url";
import { REMINDER_WINDOW_HOURS } from "@/app/(owner)/dashboard/bookings/[id]/walkthrough/[kind]/forms";

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET; if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const a = Buffer.from(token), b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const db = getDb();
  const now = new Date();
  const due = await bookingsNeedingPreReminder(db, now, REMINDER_WINDOW_HOURS);
  let sent = 0;
  for (const { bookingId, studioId } of due) {
    try {
      const studio = await getStudioById(db, studioId);
      const booking = studio ? await getBookingForOwner(db, bookingId, studioId) : null;
      if (!studio || !booking) continue;
      const user = await (await clerkClient()).users.getUser(studio.clerkUserId);
      const to = user.primaryEmailAddress?.emailAddress;
      if (!to) continue;
      const html = await renderWalkthroughReminder({
        renterName: booking.renterName,
        startsAtLabel: formatAtlantaRange(booking.startsAt, booking.endsAt),
        bookingUrl: `${await baseUrl()}/dashboard/bookings/${bookingId}`,
      });
      await sendEmail({ to, subject: "Pre-event walkthrough reminder", html });
      await markPreReminderSent(db, bookingId, now);
      sent++;
    } catch (e) {
      console.error("reminder failed for", bookingId, e); // best-effort; do not stamp on failure
    }
  }
  return NextResponse.json({ due: due.length, sent });
}
```
**Required:** `getStudioById` does **not** exist in `lib/studio.ts` — add it as part of this task:
```ts
export async function getStudioById(db: Db, id: string): Promise<Studio | undefined> {
  const [row] = await db.select().from(studios).where(eq(studios.id, id));
  return row;
}
```
**Note:** `baseUrl()` takes **no argument** (it reads `next/headers` and is `async`) — call `await baseUrl()`. Do not pass `req`. It works in a Node route handler.

- [ ] **Step 3: Add `CRON_SECRET` to `.env.example`** with a comment: `# CRON_SECRET — bearer token for POST /api/cron/walkthrough-reminders (set on Vercel Production; external scheduler sends "Authorization: Bearer $CRON_SECRET")`.

- [ ] **Step 4: Typecheck + build** — `nvm use 20 && npm run typecheck && npm run build`. Expected clean.

- [ ] **Step 5: Commit**

```bash
git add emails/WalkthroughReminder.tsx lib/email.ts lib/studio.ts .env.example "app/api/cron/walkthrough-reminders/route.ts"
git commit -m "feat(walkthrough): best-effort 3h pre-event reminder — email template + bearer-guarded cron route"
```

---

## Task 14: Seed a walkable locked record + docs/handoff

**Files:**
- Modify: `scripts/seed.ts` (optional convenience), `CLAUDE.md`, `.superpowers/sdd/progress.md`

- [ ] **Step 1 (optional): Extend the seed** so one `post_event`/`closed` booking has a locked pre-walkthrough with 2–3 photo rows (fake r2 keys) — lets the human see the gallery card without running a live capture. Guard so it stays idempotent under the existing cascade-delete reseed.

- [ ] **Step 2: Update `CLAUDE.md`** — flip Phase 7 to ✅ in the status line, add a "Phase 7 as built" section: capture surface route, the immutability trigger (correcting the earlier assumption), presigned per-item upload flow, deposit_protected skip semantics, the owner gallery, and the reminder cron + required ops (CRON_SECRET on Vercel Production, external scheduler, **R2 bucket CORS must allow PUT from the deploy origins**). Note carry-forwards: renter acknowledgment + auto-close still deferred (v1.0); client-supplied SHA-256 trusted for MVP.

- [ ] **Step 3: Append a Phase 7 section to `.superpowers/sdd/progress.md`** with the per-task ledger.

- [ ] **Step 4: Full gate** — `nvm use 20 && npm run lint && npm run typecheck && npm run test && npm run build`. All green.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md .superpowers/sdd/progress.md scripts/seed.ts
git commit -m "docs(phase-7): handoff — photo checklist as built, ops (CRON_SECRET, R2 CORS), deferrals"
```

---

## Deployment & human verification (post-merge-gate, before merge to main)

These are **operational** steps, executed once the branch is green and the PR preview is up. They are not code tasks but are required before the human UI walk:

1. **Apply migration 0004 to Neon** — `nvm use 20 && npm run db:migrate` against the `.env.local` `DATABASE_URL` (the deployment's DB). Confirm the triggers exist (`\df forbid_locked_walkthrough*`).
2. **Configure R2 bucket CORS** — allow `PUT` (and `GET`) from the preview + production origins, with `Content-Type` header. Without this, browser presigned PUTs fail CORS.
3. **Set `CRON_SECRET`** on Vercel Production (and Preview if testing there).
4. **Human preview walk (render, don't curl):** install the PWA on a phone; open a `confirmed`/`event_day` booking → **Start pre-event walkthrough** → capture all areas (retake one) → **Review** → **Lock**; confirm the booking detail shows the locked gallery with timestamps; open a photo (presigned) ; exercise the file-input fallback and the webview interstitial (open the link inside Gmail); confirm **Skip** flips the "unprotected" warning. Optionally POST the cron route with the bearer and confirm an email arrives.

---

## Self-Review (completed by plan author)

- **Spec coverage:** PWA manifest/install → T8. getUserMedia primary + file fallback + webview interstitial → T7 (helpers) + T10 (UI). Presigned per-capture R2 upload → T3 + T9 + T10. Server timestamp + geotag + SHA-256 → T3 (timestamp/geo columns) + T7/T10 (sha256/geo capture). Pre + post lifecycle → T2–T5. Review → lock (immutable) → T4 (lock) + T1 (trigger). Skip → deposit_protected=false + warning → T4 + T12. Owner locked-record view → T11 + T12. 3h reminder → T5 (query) + T13 (route/email). Copy discipline → enforced in T10/T12 copy + noted. Immutability enforcement (missing) → T1. All covered.
- **Placeholder scan:** the only deliberately-not-fully-coded block is `CaptureFlow`'s four-phase JSX (T10 Step 2), which ports the prototype layout — the risky logic (camera/compression/upload/lock) is fully coded; the JSX is layout the implementer ports from the named prototype lines. Acceptable and explicit.
- **Type consistency:** `WalkthroughKind`/`parseKind` return `"pre"|"post"`; `startCapture`/`commitCapture`/`lockWalkthrough` signatures match their callers in T9/T10/T11/T13; `walkthroughEntries(effectiveState, {preLocked,postLocked})` matches T12 usage; `getWalkthroughWithPhotos` return shape matches T11/T12. Consistent.
- **Scope:** single plan, one subsystem (the walkthrough). Reminder cron is the one semi-independent slice but shares the domain module and is small — kept in-plan as its own task.
