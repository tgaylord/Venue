# VenueDash Phase 7 — Photo Checklist PWA — Design

**Status:** Draft for implementation · **Date:** 2026-07-06 · **Branch:** `feat/phase-7-photo-checklist`
**Source of truth:** `docs/specs/2026-07-05-venuedash-v0.5-design.md` (§2 camera/chain-of-custody, §5 Phase 7, §6 evidence discipline, §8 risks, §9 resolved decisions). This document refines that scope; where they conflict, the v0.5 spec wins.

## 1. Why this phase

The photo checklist is the differentiator: a guided **pre-** and **post-event** walkthrough where the studio **owner** photographs each configured area of the space, and each photo is captured fresh, **server-timestamped**, **geotagged**, **content-hashed (SHA-256)**, then the walkthrough is **locked** into an immutable, timestamped record. This is what turns "camera-roll photos — your word against theirs" into a defensible condition record, without VenueDash ever touching deposit money or promising a courtroom standard.

**Language discipline (binding, spec §2/§6):** copy says **"timestamped documentation,"** never "immutable evidence," "proof," or "legal backbone." The prototype's photo-checklist copy reflects the v1.0 vision (claims/evidence) and **must be rewritten to v0.5 truth** when ported. No held-deposit, no auto-refund, no damage-claim language.

## 2. Scope

### IN (this phase)
1. **Installable PWA** — web manifest, icons, theme color, apple-touch metadata, and an "Add to Home Screen for reliable camera" install hint. **No service worker / offline shell** (deferred, v0.5 spec §3).
2. **Capture surface** — owner-authed, full-screen mobile, one-area-per-screen:
   - `getUserMedia` live capture **primary** (video → canvas frame),
   - mobile `<input type="file" accept="image/*" capture="environment">` **fallback** when `getUserMedia` is unavailable/blocked,
   - a **webview interstitial** ("open in Safari / the installed app") when a known in-app browser (Gmail/iOS Mail/etc.) is detected,
   - **client-side compression** (canvas → JPEG, max edge ~1600px, quality ~0.8) before upload.
3. **Per-capture direct-to-R2 upload** via **presigned PUT**, with **server timestamp + geolocation + SHA-256** recorded per photo.
4. **Pre + post walkthrough lifecycle** — start → capture each checklist item → review → **lock** (irreversible).
5. **Evidence immutability enforcement** — a DB trigger (plus app-layer guard) forbidding `UPDATE`/`DELETE` on a **locked** walkthrough and its photos. *(This is currently unenforced; CLAUDE.md assumed the schema already did this — it does not.)*
6. **Skip → `deposit_protected = false`** with a persistent warning ("no defensible record exists").
7. **Owner view of the locked record** — a "Condition documentation" card on the booking detail: pre/post status + a photo gallery (presigned GET).
8. **3-hours-before reminder email** — a protected cron route (bearer secret) emailing the owner when an event starts within ~3h and the pre-walkthrough hasn't started; idempotent. External scheduler documented (not code); best-effort at MVP volume.

### OUT (deferred to v1.0 — do not build)
- **Renter acknowledgment** (`walkthroughs.acknowledged_at`, acknowledgment token/link). Column stays null; drop the prototype's "acknowledgment link sent" copy.
- **Auto-close `post_event → closed`** and clock-state persistence (already deferred in Phase 5 handoff; entangling it here is out of scope). Locking the post walkthrough is this phase's terminal action.
- **Damage-claim / dispute flow**, renter-facing photo view, offline service worker, referral hook.
- Server-side re-hash verification of uploaded bytes (client-computed SHA-256 is trusted for MVP; the owner documents their own space).

## 3. Data model

The walkthrough tables already exist (`walkthroughs`, `walkthrough_photos` with `sha256`, `checklist_items`, `bookings.deposit_protected`). Deltas in **migration `0004`**:

- **`walkthroughs`**: add `unique(booking_id, kind)` — one pre and one post walkthrough per booking.
- **`bookings`**: add `pre_reminder_sent_at timestamptz null` — idempotency stamp for the reminder cron.
- **`walkthrough_photos`**: add a partial `unique(walkthrough_id, checklist_item_id) WHERE checklist_item_id IS NOT NULL` — backs the per-item capture upsert.
- **Immutability trigger(s)** (PL/pgSQL, must run under PGlite `createTestDb`):
  - `BEFORE UPDATE OR DELETE ON walkthroughs`: if `OLD.locked_at IS NOT NULL` → raise exception. (Allow the single transition that *sets* `locked_at`: the lock write updates a row whose `OLD.locked_at IS NULL`, so it passes; any subsequent write fails.)
  - `BEFORE UPDATE OR DELETE ON walkthrough_photos`: if the parent walkthrough's `locked_at IS NOT NULL` → raise. (Photos are written only while the parent is unlocked; the lock is the freeze point.)
- If PGlite cannot host the trigger, fall back to app-layer guards only and document the gap — but attempt the trigger first (it is the honest fulfillment of §6 "…ever").

No new tables. `walkthrough_photos.checklist_item_id` remains the per-item link (nullable, `set null` on item delete — preserves the photo record if the studio later edits its checklist).

## 4. Domain / server layer

New `lib/walkthrough.ts` (Drizzle-handle-first, PGlite-tested; R2 side effects injected as deps, mirroring `lib/contract.ts`):

- `getOrCreateWalkthrough(db, bookingId, kind)` → returns the row, creating it with `started_at = now()` if absent (idempotent via the new unique index; concurrent create → `onConflictDoNothing` then re-select).
- `photoKey(walkthroughId, checklistItemId)` → deterministic `walkthroughs/{walkthroughId}/{checklistItemId}.jpg`.
- `startCapture(db, {bookingId, kind, checklistItemId}, deps)` → validates walkthrough is **not locked** and item belongs to the studio; returns `{ key, uploadUrl }` (presigned PUT, ~300s) via injected `getSignedUploadUrl`.
- `commitCapture(db, {walkthroughId, checklistItemId, sha256, bytes, contentType, lat, lng})` → guards not-locked; **upserts** the `walkthrough_photos` row (`server_captured_at = now()`), one per `(walkthrough, item)`. (A partial unique index on `(walkthrough_id, checklist_item_id)` backs the upsert — added in `0004`.)
- `lockWalkthrough(db, walkthroughId)` → CAS-style: set `locked_at = now()` **where `locked_at IS NULL`**; require all checklist items captured before locking (count guard). Idempotent/racesafe: a second lock affects 0 rows → treated as already-locked.
- `skipWalkthrough(db, bookingId)` → sets `bookings.deposit_protected = false` (plain column update — like `setDepositStatus`; writes no `booking_events`).
- `getWalkthroughWithPhotos(db, bookingId, kind)` → read model for the owner gallery.
- `bookingsNeedingPreReminder(db, now, windowHours)` and `markPreReminderSent(db, bookingId, at)` → cron query + idempotency stamp.

**State discipline:** walkthroughs and `deposit_protected` are **not** booking-state transitions — they are their own lifecycle. No `bookings.state` write happens in this phase except (none in v0.5 — auto-close deferred). `booking_events` is untouched. This respects "no direct writes to `bookings.state` outside `transitionBooking`" trivially (we make none).

**`booking-view.ts` additions:** derive walkthrough affordances so the owner UI stays thin:
- `start_pre_walkthrough` when effective state ∈ {`confirmed`, `event_day`} and pre not locked,
- `start_post_walkthrough` when effective state = `post_event` and post not locked,
- surface pre/post **locked** status + `deposit_protected` for the documentation card.

## 5. Routes & actions

All Node runtime (R2 SDK + Node built-ins; never Edge).

- **`app/manifest.ts`** — Next metadata manifest route; icons under `public/`.
- **`/dashboard/bookings/[id]/walkthrough/[kind]`** (owner page + client capture component) — full-screen mobile; server-loads booking (studio-scoped via `getBookingForOwner`, foreign id → `notFound()`), checklist items, and the walkthrough's existing photos (resume support). `kind` validated ∈ `pre|post`.
- **Server actions** (colocated `actions.ts`, thin `"use server"` async-only): `startCapture`, `commitCapture`, `lockWalkthrough`, `skipWalkthrough` — each re-resolves studio from Clerk `userId` and re-fetches studio-scoped; client-supplied ids never trusted for authz. `revalidatePath` + stay on page (owner pattern).
- **`GET /dashboard/bookings/[id]/walkthrough/[kind]/photo/[photoId]`** — owner, studio-scoped, presigned GET (302 to R2, ~300s) for gallery/full view. No secret in body.
- **`POST /api/cron/walkthrough-reminders`** — bearer `CRON_SECRET` (constant-time compare; 401 otherwise). Finds `confirmed` bookings starting within `windowHours` with no started pre-walkthrough and `pre_reminder_sent_at IS NULL`, sends the owner reminder email (owner address from Clerk), stamps `pre_reminder_sent_at`. Best-effort email (a send failure is logged, does not fail the run). `proxy.ts` runs Clerk middleware over `/api` but only calls `auth.protect()` for `/dashboard`/`/settings`, so `/api/cron` is already reachable unauthenticated — the **bearer `CRON_SECRET` is the sole guard** (no matcher change needed).

**Email:** new `WalkthroughReminder` template (dark, owner-facing) following the existing Resend/`lib/email.ts` pattern; best-effort send.

## 6. Capture UI (port from prototype, rewrite copy)

Port the prototype's "Day-of Photo Checklist" mobile screens (`prototype/VenueDash_Prototype.dc.html` lines ~431–510) faithfully in structure, rewriting copy to v0.5 truth:

- **Capture screen:** progress bar, `ITEM n OF total`, area name + hint, live camera (or fallback), **Capture photo** → captured state (server timestamp + geotag chip) with **Retake** / **Next area** (last item → **Review**).
- **Review screen:** thumbnail grid of all captured areas + a warning ("Once locked, this record can't be edited — that's what makes it a reliable timestamped record") + **Lock pre/post-event documentation**.
- **Locked screen:** confirmation (`N PHOTOS · SERVER-TIMESTAMPED · GEOTAGGED`), post-walkthrough reminder note (for pre), **Back to dashboard**. **Remove** the "acknowledgment link sent to renter" copy (deferred).
- **Webview interstitial:** shown instead of capture when an in-app browser is detected — "Open in Safari / your installed app to use the camera," with the fallback file-input still offered.

Copy discipline enforced by a test asserting forbidden phrases ("immutable evidence", "proof", "legal backbone") are absent (mirrors the contract forbidden-phrase test).

## 7. Testing strategy

- **PGlite (server/domain):** `getOrCreateWalkthrough` idempotency; `startCapture`/`commitCapture` upsert (one row per item, retake overwrites); `lockWalkthrough` CAS + all-items guard + idempotency; **immutability trigger** (update/delete on a locked walkthrough/photo raises; writes before lock succeed); `skipWalkthrough` flips the flag; `bookingsNeedingPreReminder` window + `pre_reminder_sent_at` idempotency; `booking-view` walkthrough affordances across states.
- **Pure helpers:** webview detection, compression parameters, SHA-256 util, `kind` parsing, `photoKey`.
- **Not unit-tested (jsdom can't drive getUserMedia/canvas):** live capture — verified in the **human preview walk** ("render, don't curl," per the Phase 5/6 lesson): install the PWA on a phone, run a pre-walkthrough end-to-end (capture all areas, retake one, lock), confirm the locked gallery renders on the booking detail, exercise the fallback file-input and the webview interstitial, and confirm skip flips the warning.

## 8. Risks & mitigations (from v0.5 spec §8)

- **Camera in webviews** → interstitial + file-input fallback; owner installs the PWA (reliability target, §9).
- **Vercel free cron can't sub-daily** → external scheduler hitting the protected route; idempotency stamp makes hourly polling safe; accepted best-effort.
- **R2 direct upload (4.5MB serverless body cap)** → presigned direct PUT + client compression; **bucket CORS must allow the deploy origins' PUT** (ops step, documented).
- **PGlite trigger support** → verify early; app-layer guard as fallback.

## 9. Out-of-scope reminders (guardrails)

No renter acknowledgment, no auto-close, no claim flow, no held deposits, no service worker, no server-side re-hash. "Timestamped documentation," never "immutable evidence." Interpolate/port mechanically; don't redesign the prototype screens.
