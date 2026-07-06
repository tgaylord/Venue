# VenueDash — Project Context

VenueDash is a SaaS platform for Atlanta studio owners who rent their spaces for private events. It handles the paperwork layer of event rentals: signed contracts, timestamped condition-photo walkthroughs, and damage-deposit status tracking.

## Current build — v0.5, Phases 0–3 merged; Phase 4 is next

We are building **v0.5**, a deliberately scoped first release. Read these before working:

- **v0.5 spec (source of truth):** `docs/specs/2026-07-05-venuedash-v0.5-design.md`
- **Per-phase specs + plans:** `docs/specs/` and `docs/plans/` (Phases 1–3 have both)
- **Progress ledger (what happened, per task, incl. review findings):** `.superpowers/sdd/progress.md`
- **Full v1.0 vision (deferred):** `docs/v1.0-vision/`

**Status by phase (v0.5 spec §5):**
- ✅ Phase 0 — Foundation (PR #6) · ✅ Phase 1 — Landing + waitlist + ToS (PR #7) · ✅ Phase 2 — Domain core (PR #8) · ✅ Phase 3 — Onboarding wizard + dashboard empty state (PR #9)
- **▶ Phase 4 — Public booking page + intake (next):** `/book/[slug]` renter mini-site (mobile-first, warm-light theme, no renter accounts), availability picker, intake form, review screen, submit → `pending` booking via `transitionBooking`, snapshot terms, owner email + tokenized renter status link.
- Then: 5 dashboard/booking detail · 6 contract generation · 7 photo checklist PWA.

**What exists and works today:** an owner signs up (Clerk) → 5-step wizard at `/settings` (doubles as Settings forever) → live `/book/[slug]` link shown on the dashboard (the booking page itself 404s until Phase 4). Landing at `/` with waitlist (Resend contacts). Seeded dev DB: `npm run db:seed` (Westview Studio + 10 bookings across all 9 states).

**v0.5 scope guardrails (supersede older sections wherever they conflict):**
- **No held deposits.** VenueDash never touches deposit money; the owner collects/refunds off-platform and VenueDash only records `deposit_status` (`uncollected|collected|returned`). Do not reintroduce VenueDash-held deposits without revisiting the spec.
- **COI collection, damage-claim flow, automated e-signature, and Stripe are OUT of v0.5** (v1.0). Contract signing is manual.
- The booking state machine is a trimmed subset of the v1.0 enum, same state names: `pending → declined|awaiting_contract → awaiting_signature → confirmed → event_day → post_event → closed`, `canceled` from pre-event states; `declined/closed/canceled` terminal.

## Architecture (as built)

**Stack:** Next.js 16 (App Router) · React 19 · Tailwind v4 (`@theme` in `app/globals.css`) · Clerk 7 · Drizzle + Neon Postgres (websocket Pool driver) · Cloudflare R2 · Resend. Route groups `(marketing)` / `(public)` / `(owner)`.

**Domain layer (the spine — read before touching bookings):**
- `lib/domain/states.ts` — `BOOKING_STATES`, `LEGAL_TRANSITIONS` (single source of truth).
- `lib/domain/transitions.ts` — `transitionBooking(db, id, to, actor, opts?)`: transactional CAS + append-only `booking_events` audit + post-commit hooks. **No other code path ever writes `bookings.state`.** `booking_events` has no update/delete path, ever.
- `lib/domain/effective-state.ts` — read-time clock-state derivation (`confirmed→event_day→post_event`).
- `lib/tokens.ts` — renter tokens: 32-byte base64url raw, SHA-256 hash at rest, one active per `(booking, purpose)`, re-mint rotates. Phase 4 mints `purpose="status"` at booking creation.
- `lib/studio.ts` — studio persistence (slug minted once, immutable; `onboarding_completed_at` set once). `lib/money.ts` — `parseDollarsToCents`.
- All DB-touching functions take the Drizzle handle (`Db` from `lib/domain/transitions`) as their first parameter; PGlite tests inject `createTestDb()` from `lib/domain/test-db.ts`, which applies the **real** generated migrations from `drizzle/`.
- Cross-cutting: snapshot terms (rate/deposit/policies) onto the booking at request time; never re-join studio settings for legal fields.

**DB access:** `lib/db.ts` exposes lazy `getDb()`/`getPool()` (Neon **websocket** Pool + `ws`; imports must stay on the Node runtime — never Edge). Nothing connects at import time (CI/builds have no DATABASE_URL). Auth middleware lives in **`proxy.ts`** (Next 16's renamed middleware, Node runtime — do not create `middleware.ts`); its matcher gates `/dashboard(.*)` and `/settings(.*)` — extend it when adding owner routes.

**Server-action pattern (established in Phase 3, follow it):** thin `"use server"` actions = Clerk `auth()` → pure FormData parser (colocated `forms.ts`, unit-tested) → `lib/*` persistence (PGlite-tested) → `redirect()` on success / return form-state on error. **A `"use server"` file may only export async functions** — a `const` exported from one reaches client components as a broken reference and crashes at render (this shipped as a bug once; constants live in plain modules like `forms.ts`).

## Dev setup & workflow

- **Use Node 20** (`nvm use 20`; default shell Node is 24 and engine-strict rejects it). Prefix npm commands accordingly.
- Copy `.env.example` → `.env.local` (Clerk, Neon `DATABASE_URL`, R2, Resend). Resend API key must be **Full access** (sending-only keys 401 on the Contacts API).
- Scripts: `npm run dev | build | lint | typecheck | test | db:generate | db:migrate | db:seed | db:healthcheck`. Tests run on PGlite — no secrets needed; CI runs lint/typecheck/test/build.
- **Vercel:** framework pinned in `vercel.json`. Env vars must be set for **both Production and Preview** scopes (the four `NEXT_PUBLIC_CLERK_*` redirect vars are baked at build time — a cached "Redeploy" won't pick up changes; push a commit). No custom domain yet (`*.vercel.app`; Resend sending domain unverified — needed before Phase 4's booking emails become deliverable to real owners; consider buying the domain then).
- **Process per phase:** brainstorm (superpowers) → spec in `docs/specs/` → plan in `docs/plans/` → subagent-driven development on a `feat/phase-N-*` branch → whole-branch review → PR with preview-deploy checks → merge. Ledger in `.superpowers/sdd/progress.md`.
- **Verification lesson (hard-won):** signed-out curl checks are not enough — every new owner/renter page must be **rendered** in verification (authenticated walk on the preview, or an unauthenticated debug-route render of the client components locally).

## Phase 4 carry-forwards (from reviews/ledger)

- Availability: `availability_blocks` table exists (empty); Phase 4 builds the picker + writes `pending` requests; buffer-block writing on confirmation may be simplified per v0.5 spec.
- Booking emails: owner notification + renter status link (`verifyRenterToken` → `(public)/r/[token]`-style route or `/status?token=`; decide in brainstorm). `EMAIL_FROM` currently uses Resend's shared domain — fine for testing, verify a domain for real deliverability.
- Non-blocking dashboard follow-ups: gate the share-link card on `onboarding_completed_at`; unique-violation retry in `createStudio`; "save and stay" UX for settings-mode edits.
- Renter surface uses the **warm-light** palette (`renter-*` tokens in `app/globals.css`), Instrument Serif for display; mobile-first.

## What's in this repo (unchanged references)

### `prototype/`
`VenueDash_Prototype.dc.html` + `support.js` — the interactive UI prototype and **visual spec of record**; port screens, don't redesign, and never edit these files. Open the HTML directly in a browser; the chrome switches between marketing / owner app / renter mini-site surfaces. Note: prototype copy reflects the v1.0 vision — rewrite claims to v0.5 truth when porting (no held deposits, no e-sign, no auto-refunds; "timestamped documentation," never "immutable evidence").

### Design conventions
- Owner surface (dark): bg `#0b0c0f`, panel `#16171c`, border `#26272e`, text `#e9eaee`/muted `#9a9ca8`, accent `#7a86ff`, success `#5fd68b`, warning `#e6b054`, danger `#ef6f54`. Marketing shares the dark palette.
- Renter/public surface (warm light): bg `#f7f5f0`, ink `#211f1a`, border `#ddd7c6`, ok `#4d7c4a`.
- Fonts: Instrument Sans (UI), Instrument Serif (renter-facing display), IBM Plex Mono (metadata/labels) — loaded in `app/layout.tsx`, exposed as `font-sans/serif/mono`.
- Tailwind: tokens exist as `owner-*`/`renter-*` classes; where a prototype hex has no token, use an arbitrary value matching the prototype exactly. Don't put a width utility in a shared input class that flex-row items reuse (`w-full` overrides `flex-1`/`w-[90px]` — this also shipped as a bug once).
