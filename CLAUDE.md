# VenueDash — Project Context

VenueDash is a SaaS platform for Atlanta studio owners who rent their spaces for private events. It handles the paperwork layer of event rentals: signed contracts, timestamped condition-photo walkthroughs, and damage-deposit status tracking.

## Current build — v0.5, Phases 0–4 merged; Phase 5 is next

We are building **v0.5**, a deliberately scoped first release. Read these before working:

- **v0.5 spec (source of truth):** `docs/specs/2026-07-05-venuedash-v0.5-design.md`
- **Per-phase specs + plans:** `docs/specs/` and `docs/plans/` (Phases 1–3 have both)
- **Progress ledger (what happened, per task, incl. review findings):** `.superpowers/sdd/progress.md`
- **Full v1.0 vision (deferred):** `docs/v1.0-vision/`

**Status by phase (v0.5 spec §5):**
- ✅ Phase 0 — Foundation (PR #6) · ✅ Phase 1 — Landing + waitlist + ToS (PR #7) · ✅ Phase 2 — Domain core (PR #8) · ✅ Phase 3 — Onboarding wizard + dashboard empty state (PR #9) · ✅ Phase 4 — Public booking page + intake (PR #11)
- **▶ Phase 5 — Owner dashboard + booking detail (next):** state-derived sections; lifecycle rail; approve→`awaiting_contract` / decline→`declined` / cancel via `transitionBooking` (owner actor); **manual `deposit_status` & `contract_signed_at` toggles**; copy-booking-link. This is the first surface that *drives* the state machine from the owner side.
- Then: 6 contract generation (GA template → PDF, manual sign) · 7 photo checklist PWA (the differentiator).

**What exists and works today:** an owner signs up (Clerk) → 5-step wizard at `/settings` (doubles as Settings forever) → live `/book/[slug]` link on the dashboard. A renter (no account) opens `/book/[slug]`, picks an available date/time, submits intake → a `pending` booking is created (terms snapshotted), owner + renter receive emails, and the renter lands on a durable `/status/[token]` page. Landing at `/` with waitlist (Resend contacts). Seeded dev DB: `npm run db:seed` (Westview Studio, slug **`westview`** + 10 bookings across all 9 states). **The owner cannot yet act on requests in-app — approve/decline/toggles are Phase 5.**

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
- `lib/tokens.ts` — renter tokens: 32-byte base64url raw, SHA-256 hash at rest, one active per `(booking, purpose)`, re-mint rotates. `createBooking` mints `purpose="status"` at creation; `/status/[token]` renders read-only booking state from it (durable, not single-use).
- `lib/booking.ts` — `createBooking(db, input)`: the **sanctioned creation path**. `pending` is the schema-default *genesis* state, so this is a plain INSERT — **not** a `transitionBooking` call — and writes **no** `booking_events` row (`createdAt` is the creation record). Snapshots terms onto `rateSnapshot` (rate/minHours/ladder/policies/maxOccupancy) + `depositCents`. Also `getBusyIntervals` (non-terminal bookings + manual blocks) for conflict-checking.
- `lib/tz.ts` — Atlanta (`America/New_York`) wall-clock ↔ UTC, DST-aware two-pass offset. `lib/availability.ts` — pure interval math (`overlaps`/`hasConflict`/`availableStartHours`). `lib/rate-limit.ts` — DB-backed fixed-window limiter (`checkRateLimit`, atomic upsert; `rate_limits` table).
- `lib/studio.ts` — studio persistence (slug minted once, immutable; `onboarding_completed_at` set once); `getStudioBySlug`, `maxOccupancyOf`. `lib/money.ts` — `parseDollarsToCents`, `formatCents`.
- All DB-touching functions take the Drizzle handle (`Db` from `lib/domain/transitions`) as their first parameter; PGlite tests inject `createTestDb()` from `lib/domain/test-db.ts`, which applies the **real** generated migrations from `drizzle/`.
- Cross-cutting: snapshot terms (rate/deposit/policies) onto the booking at request time; never re-join studio settings for legal fields.

**DB access:** `lib/db.ts` exposes lazy `getDb()`/`getPool()` (Neon **websocket** Pool + `ws`; imports must stay on the Node runtime — never Edge). Nothing connects at import time (CI/builds have no DATABASE_URL). Auth middleware lives in **`proxy.ts`** (Next 16's renamed middleware, Node runtime — do not create `middleware.ts`); its matcher gates `/dashboard(.*)` and `/settings(.*)` — extend it when adding owner routes.

**Server-action pattern (established in Phase 3, follow it):** thin `"use server"` actions = Clerk `auth()` (owner) → pure FormData parser (colocated `forms.ts`, unit-tested) → `lib/*` persistence (PGlite-tested) → `redirect()` on success / return form-state on error. **A `"use server"` file may only export async functions** — a `const` exported from one reaches client components as a broken reference and crashes at render (this shipped as a bug once; constants live in plain modules like `forms.ts`). The public `/book/[slug]` submit follows the same shape with two front gates — **honeypot** (silent bounce) then **IP rate-limit** (`checkRateLimit`, before any DB/email work) — and **best-effort emails**: a `sendEmail` failure is caught and logged but never fails the booking, and `redirect()` stays outside every try/catch (it throws control-flow). Owner email address is fetched from **Clerk** (`clerkClient().users.getUser`), not stored in our DB.

## Dev setup & workflow

- **Use Node 20** (`nvm use 20`; default shell Node is 24 and engine-strict rejects it). Prefix npm commands accordingly.
- Copy `.env.example` → `.env.local` (Clerk, Neon `DATABASE_URL`, R2, Resend). Resend API key must be **Full access** (sending-only keys 401 on the Contacts API).
- Scripts: `npm run dev | build | lint | typecheck | test | db:generate | db:migrate | db:seed | db:healthcheck`. Tests run on PGlite — no secrets needed; CI runs lint/typecheck/test/build.
- **Vercel:** framework pinned in `vercel.json`. The four `NEXT_PUBLIC_CLERK_*` redirect vars are baked at build time — set on **both Production and Preview**; a cached "Redeploy" won't pick up changes, push a commit. **`APP_URL`** (server-only *runtime* var — origin for transactional email links) is set on **Production only** (currently `https://venue-gold.vercel.app`); leave it **unset on Preview/dev** so the submit action falls back to the request host (the correct per-deploy URL). Because it's not `NEXT_PUBLIC_`, it's changeable without a rebuild (swap it when a custom domain lands).
- **Email deliverability (working via Resend's default sender):** booking/status emails are **best-effort** — a send failure never blocks the booking, so it's silent; diagnose via the **Resend dashboard logs**. `EMAIL_FROM` is intentionally **UNSET in Vercel** (both scopes), so `lib/email.ts` falls back to `VenueDash <onboarding@resend.dev>` (Resend's shared verified sender) and sends **do deliver** — verified 2026-07-06 to a public Gmail. **Footgun when re-adding `EMAIL_FROM`:** paste it UNQUOTED in the Vercel UI — a value copied from `.env.example` keeps its surrounding double-quotes, reaches Resend as `"…"`, and 422s (`Invalid from`); this silently killed every send once. A branded `venuedash.com` sender additionally needs the domain verified in Resend (pre-launch checklist).
- **DB migrations:** `npm run db:migrate` (drizzle-kit, idempotent) applies `drizzle/*.sql` to the `DATABASE_URL` in `.env.local` — the same Neon DB the deployment reads. Run it after any schema change and before deploying code that needs the new table (Phase 4 added `0002` = `rate_limits`).
- **Process per phase:** brainstorm (superpowers) → spec in `docs/specs/` → plan in `docs/plans/` → subagent-driven development on a `feat/phase-N-*` branch → whole-branch review → PR with preview-deploy checks → merge. Ledger in `.superpowers/sdd/progress.md`.
- **Verification lesson (hard-won):** signed-out curl checks are not enough — every new owner/renter page must be **rendered** in verification (authenticated walk on the preview, or an unauthenticated debug-route render of the client components locally).

## Phase 5 carry-forwards (from Phase 4 reviews/ledger)

- **Phase 5 is the owner's side of the state machine.** Booking list + detail; approve→`awaiting_contract` / decline→`declined` / cancel via `transitionBooking` (owner actor); manual `deposit_status` + `contract_signed_at` toggles. The owner-notification email already links to `/dashboard`.
- **Effective vs stored state:** the owner dashboard's clock-driven sections should derive state via `lib/domain/effective-state.ts` (`confirmed`→`event_day`→`post_event`), not raw `booking.state`. (The renter `/status/[token]` badge reads raw state deliberately — those three all render "You're booked".)
- **Snapshot is richer than the seed:** `createBooking` writes a full terms snapshot (policies incl.) to `rateSnapshot`, but `scripts/seed.ts` still writes the narrower shape — align it if Phase 5/6 reads snapshot policies.
- **Availability is TOCTOU-tolerant by design:** a `pending` request is not a reservation — overlaps are allowed and the owner arbitrates at approval; hard exclusion (buffer blocks on confirm) is deferred. `availability_blocks` currently only holds `manual` blocks.
- **Backlog (non-blocking, from reviews):** `rate_limits` has no TTL cleanup (v1.0, esp. if per-email keys added); `availableStartHours` lacks half-open-edge tests; IP rate limit trusts the first `x-forwarded-for` hop (fine for single Vercel proxy). Older dashboard follow-ups: gate the share-link card on `onboarding_completed_at`, `createStudio` unique-violation retry, "save and stay" settings UX.
- **Palettes:** renter/public surface = **warm-light** (`renter-*` tokens, Instrument Serif display, mobile-first); owner/marketing = **dark**.

## What's in this repo (unchanged references)

### `prototype/`
`VenueDash_Prototype.dc.html` + `support.js` — the interactive UI prototype and **visual spec of record**; port screens, don't redesign, and never edit these files. Open the HTML directly in a browser; the chrome switches between marketing / owner app / renter mini-site surfaces. Note: prototype copy reflects the v1.0 vision — rewrite claims to v0.5 truth when porting (no held deposits, no e-sign, no auto-refunds; "timestamped documentation," never "immutable evidence").

### Design conventions
- Owner surface (dark): bg `#0b0c0f`, panel `#16171c`, border `#26272e`, text `#e9eaee`/muted `#9a9ca8`, accent `#7a86ff`, success `#5fd68b`, warning `#e6b054`, danger `#ef6f54`. Marketing shares the dark palette.
- Renter/public surface (warm light): bg `#f7f5f0`, ink `#211f1a`, border `#ddd7c6`, ok `#4d7c4a`.
- Fonts: Instrument Sans (UI), Instrument Serif (renter-facing display), IBM Plex Mono (metadata/labels) — loaded in `app/layout.tsx`, exposed as `font-sans/serif/mono`.
- Tailwind: tokens exist as `owner-*`/`renter-*` classes; where a prototype hex has no token, use an arbitrary value matching the prototype exactly. Don't put a width utility in a shared input class that flex-row items reuse (`w-full` overrides `flex-1`/`w-[90px]` — this also shipped as a bug once).
