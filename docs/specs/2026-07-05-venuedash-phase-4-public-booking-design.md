# VenueDash Phase 4 — Public Booking Page + Intake — Design

Status: **Approved for planning** · Date: 2026-07-05
Implements: v0.5 spec ([`2026-07-05-venuedash-v0.5-design.md`](./2026-07-05-venuedash-v0.5-design.md)) §5 Phase 4

## 1. Goal & context

Turn the live `/book/[slug]` link (surfaced on the dashboard since Phase 3, currently 404) into a working renter mini-site. A renter with **no account** views a studio's public page, picks a date/time, fills an intake form, reviews, and submits — creating a `pending` booking with snapshotted terms, notifying the owner by email, and giving the renter a durable tokenized status link. Warm-light theme, mobile-first, ported screen-for-screen from the prototype's renter mini-site (`prototype/VenueDash_Prototype.dc.html` lines 723–825) with copy rewritten to v0.5 truth.

This is the first surface where the domain spine built in Phase 2 (bookings, snapshots, renter tokens) is exercised end-to-end by a real user path.

## 2. Decisions made in brainstorming

- **Availability model:** date + start time + duration (≥ studio `minHours`), **conflict-checked** against existing non-terminal bookings and manual `availability_blocks`. A pending request writes **no** block itself (it may be declined) — the picker is read-only against availability. Buffer-block writing deferred.
- **Status link:** submit redirects to **`/status/[token]`** (path param, raw `purpose="status"` token); the same URL is emailed to the renter. This route replaces the existing `(public)/status` placeholder.
- **Flow structure:** one client component owns the step state (page → intake → review); only the final submit calls a `"use server"` action. URL stays `/book/[slug]`.
- **Timezone:** **America/New_York hardcoded** (Atlanta-only market), DST-aware, no schema change. A per-studio timezone returns in v1.0.
- **Spam protection:** honeypot field only (reuse the shipped waitlist pattern). Real rate-limiting stays a backlog item until outreach drives traffic.
- **Headcount cap:** **soft-warn, allow submit.** Over-cap shows an inline warning; the owner decides at approval.
- **Owner email address:** fetched from **Clerk** (`clerkClient().users.getUser(studio.clerkUserId)`) at send time — owner email is not in our DB, and this avoids a schema/onboarding change.
- **Genesis state:** `pending` is the booking's initial state, not a transition; `createBooking` is a plain insert (matching the seed's snapshot shape) and writes **no** `booking_events` row — `createdAt` is the creation record. `transitionBooking` is unchanged and unused in this phase.

## 3. Routes, gating, data flow

- **`/book/[slug]`** — `(public)` route group, warm-light layout (already present). Server component:
  1. `getStudioBySlug(db, slug)` (new). **404 unless the studio exists AND `onboarding_completed_at` is set** — the page is not live until onboarding completes.
  2. Loads spaces (for `maxOccupancy`) and computes availability for the next ~30 days from non-terminal bookings + manual `availability_blocks`.
  3. Passes a serializable prop bundle (studio display fields, snapshot-able terms, per-day busy intervals) to the client component.
- **`/status/[token]`** — `(public)` route group. Server component: `verifyRenterToken(db, token, "status")` → booking id → render read-only state. Invalid/expired token → 404.
- No `proxy.ts` change: both routes are public; the matcher gates only `/dashboard(.*)` and `/settings(.*)`.

## 4. The renter flow (prototype-faithful, v0.5-truthful)

One client component, internal step state, ported from the prototype:

1. **Booking page** (proto 723–768) — hero, studio name/description, stat row (rate/min, max guests, refundable deposit), house-rule chips, spaces, **availability picker** (day strip → start-time select → duration select), "Request to book".
2. **Intake form** (proto 771–791) — event type (select), estimated headcount (with soft over-cap warning against max space occupancy), BYOB toggle, outside-vendors toggle, optional notes. Hidden honeypot field.
3. **Review** (proto 794–814) — recap of when/type/headcount/flags, price line (`hours × hourlyRateCents`), deposit line, a **v0.5-truthful** "what happens next," and "Send booking request".

**Copy rewrite (mandatory):** the prototype's renter copy reflects the v1.0 money layer and must be corrected. Remove/replace "held securely," "auto-refunded within 48 hrs," "upload proof of event insurance," "pay deposit — you're booked." Deposit is *"a refundable damage deposit you'll arrange directly with the studio."* "What happens next" becomes: *1) the studio reviews · 2) sign the rental agreement · 3) arrange the deposit — you're booked.* "Timestamped documentation," never "immutable evidence."

On successful submit the renter is redirected to `/status/[token]`, which serves as the "request sent" confirmation (unifying the prototype's separate Sent screen with the durable status page).

## 5. Submit action & `createBooking`

Established server-action pattern (Phase 3): thin `"use server"` action → honeypot check (silent drop) → pure FormData parser in colocated `forms.ts` (unit-tested) → `lib/booking.ts` persistence (PGlite-tested) → `redirect()`.

`createBooking(db, input)` (new `lib/booking.ts`):
- Inserts the booking; `state` defaults to `pending`.
- **Snapshot discipline** — copies terms onto the booking at request time so legal fields are never re-joined later:
  - `depositCents` column (from studio).
  - `rateSnapshot` jsonb widened to a full terms snapshot: `{ hourlyRateCents, minHours, cancellationLadder, alcoholPolicy, vendorPolicy, noiseCurfew, cleanupWindowMin, maxOccupancy }` — everything Phase 6's contract needs. (The seed writes a narrower shape; left as-is as dev data.)
- Mints a `purpose="status"` renter token (returns the raw token for the redirect + email).
- Writes **no** `booking_events` row (genesis state — see §2).
- Returns `{ booking, rawToken }`.
- `startsAt`/`endsAt` are computed from the renter's wall-clock selection via `lib/tz.ts` before insert (see §6).

Emails are sent by the action **after** `createBooking` succeeds (§7).

## 6. Helpers

- **`lib/tz.ts`** (new) — converts renter wall-clock (date + start hour + duration hours) in **America/New_York** to UTC `Date`s for the `timestamptz` columns, DST-aware, via an `Intl.DateTimeFormat` offset technique. No new dependency. Unit-tested across a DST boundary.
- **`lib/availability.ts`** (new) — pure busy-interval computation: given existing non-terminal booking intervals + manual blocks for a studio, produce per-day availability / disable start times with less than `minHours` of free space after them. Unit-tested.
- **`lib/money.ts`** — add `formatCents(cents)` for `$660`-style display.
- **`lib/studio.ts`** — add `getStudioBySlug(db, slug)`.

## 7. Emails (two; both non-blocking on failure)

Sent from the action after the booking commits; a failed send is logged but never fails the booking (same philosophy as post-commit transition hooks). React Email templates in `emails/` alongside `TestEmail`.

- **Owner notification** → owner email from Clerk (`clerkClient().users.getUser(studio.clerkUserId)`, primary email). Content: renter name, event type, date/time (Atlanta), headcount, BYOB/vendors, notes. CTA links to `/dashboard` (booking detail is Phase 5).
- **Renter confirmation** → `renterEmail`: "request received," a recap, and the durable **`/status/[token]`** link.

`EMAIL_FROM` uses Resend's shared domain for now (fine for testing; verify a sending domain before real owner deliverability — carried forward).

## 8. Status page

`/status/[token]` renders read-only booking state from a `purpose="status"` token (durable, not single-use — matches the Phase 2 token semantics). A state badge derived from `bookings.state`:

- `pending` → "Request sent — waiting on {studio}"
- `awaiting_contract` / `awaiting_signature` → "Approved — rental agreement next"
- `confirmed` (and clock states `event_day`/`post_event`) → "You're booked"
- `declined` → "This request wasn't accepted"
- `canceled` → "This booking was canceled"

Plus an event summary (date/time, type, headcount). No renter actions in v0.5.

## 9. Validation & errors

- **Studio not live:** 404 on missing slug or `onboarding_completed_at IS NULL`.
- **Availability:** submit re-validates that the chosen interval still doesn't overlap a non-terminal booking / manual block (guards against a slot taken between page load and submit); on conflict, return form state asking the renter to pick another time.
- **Intake:** event type and a positive integer headcount required; duration ≥ `minHours`; over-cap headcount warns but does not block.
- **Honeypot** filled → silently treat as success without creating a booking or sending email.
- **Invalid/expired status token:** 404.

## 10. Testing

Pure units (vitest + PGlite, no secrets):
- `createBooking` — snapshot payload correctness, token minting, no `booking_events` row.
- `forms.ts` parser — valid, missing required, honeypot.
- `lib/availability.ts` — busy-interval math, `minHours` free-space rule, overlap detection.
- `lib/tz.ts` — wall-clock → UTC across a DST boundary.
- `formatCents`, `getStudioBySlug`.

Verification (per the hard-won lesson — signed-out curl is not enough): **render** `/book/[slug]` and `/status/[token]`; on preview, a live submit exercising both emails (owner via Clerk lookup, renter status link) and the `pending` booking landing in the DB / dashboard.

## 11. New / changed files

**New:**
- `app/(public)/book/[slug]/page.tsx` — server component (load + gate).
- `app/(public)/book/[slug]/_components/*` — client step component(s).
- `app/(public)/book/[slug]/forms.ts` + `forms.test.ts` — pure FormData parser.
- `app/(public)/book/[slug]/actions.ts` — `"use server"` submit.
- `app/(public)/status/[token]/page.tsx` — status page.
- `lib/booking.ts` + `lib/booking.test.ts` — `createBooking`.
- `lib/tz.ts` + `lib/tz.test.ts` — Atlanta wall-clock ↔ UTC.
- `lib/availability.ts` + `lib/availability.test.ts` — busy-interval math.
- `emails/OwnerBookingRequest.tsx`, `emails/RenterRequestReceived.tsx`.

**Changed:**
- `lib/money.ts` — add `formatCents`.
- `lib/studio.ts` — add `getStudioBySlug`.
- Delete `app/(public)/status/page.tsx` (placeholder replaced by `[token]` route).

## 12. Explicitly out of scope (v1.0 / later phases)

- Owner dashboard booking list + booking detail + approve/decline (Phase 5).
- Contract generation / PDF (Phase 6). This phase only snapshots the terms a contract will need.
- Any deposit charge/hold/refund (deferred entirely in v0.5 — deposit is a printed contract term + owner-toggled status).
- COI upload, e-sign, payment, buffer-block writing on confirmation, IP rate limiting.
- Renter accounts; renter actions on the status page.

## 13. Exit criteria (v0.5 spec §5 Phase 4)

- `/book/[slug]` renders the ported, v0.5-truthful renter mini-site for a live (onboarded) studio; 404 otherwise.
- A renter can pick an available date/time, complete intake, review, and submit.
- Submit creates a `pending` booking with a correct terms snapshot, redirects to `/status/[token]`.
- Owner receives a notification email; renter receives a confirmation email with the durable status link.
- Availability picker excludes times overlapping non-terminal bookings / manual blocks; submit re-validates.
- Domain-logic tests pass; preview deploy exercised (rendered pages + live submit + both emails) before merge.
- Lands as its own PR on a `feat/phase-4-*` branch; ledger updated in `.superpowers/sdd/progress.md`.
