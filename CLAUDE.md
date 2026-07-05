# VenueDash — Project Context

VenueDash is a SaaS platform for Atlanta studio owners who rent their spaces for private events. It handles the paperwork layer of event rentals: signed contracts, timestamped condition-photo walkthroughs, and damage deposits with rules-based release.

## Current build — v0.5 (start here)

The repo now contains a **Next.js 16 app at the root** (not just the `prototype/`). We are building **v0.5**, a deliberately scoped first release. Read these before working:

- **Spec:** `docs/specs/2026-07-05-venuedash-v0.5-design.md`
- **Phase plans:** `docs/plans/` · **Full v1.0 vision (deferred):** `docs/v1.0-vision/`

**v0.5 scope — this supersedes the "Key business rules" section below wherever they conflict:**
- **No held deposits.** VenueDash never touches deposit money; the owner collects/refunds it off-platform and VenueDash only records a status. This removes money-transmission/escrow risk — do not reintroduce VenueDash-held deposits without revisiting the spec.
- **COI collection, the damage-claim flow, automated e-signature, and Stripe are OUT of v0.5** (deferred to v1.0). Contract signing is manual for now.
- The booking state machine is a trimmed **subset** of the full v1.0 enum, using the same state names (spec §4).

**Stack:** Next.js 16 (App Router) · React 19 · Tailwind v4 · Clerk 7 (owner auth) · Drizzle + Neon Postgres · Cloudflare R2 · Resend. Route groups: `(marketing)` / `(public)` / `(owner)`.

**Dev setup (important):**
- **Use Node 20** (`nvm use 20`). `.npmrc` sets `engine-strict=true` and `package.json` pins `engines.node` to `>=20 <21`. CI and Vercel build on Node 20; generating `package-lock.json` under another Node major corrupts it for `npm ci`.
- Copy `.env.example` → `.env.local` and fill the keys (Clerk, Neon, R2, Resend) — see README.
- Auth runs in **`proxy.ts`** (Next 16's renamed middleware, on the Node.js runtime — required so Clerk's Node APIs work; do not convert it back to Edge/`middleware.ts`).
- Vercel's framework is pinned in **`vercel.json`** (`"framework": "nextjs"`) — required for Vercel to serve the app.
- Scripts: `npm run dev | build | lint | typecheck | test | db:generate | db:migrate | db:healthcheck`.

## What's in this repo

### `prototype/`
Two files that constitute the full interactive UI prototype built with the dc-runtime Design Component system:

- **`VenueDash_Prototype.dc.html`** — Single-file prototype. Self-contained; open directly in a browser (the `support.js` must be in the same directory). Covers every screen across three surfaces:
  - Marketing landing page
  - Studio-owner web app (dashboard, booking detail, day-of photo checklist, damage claim form, onboarding wizard)
  - Renter mini-site (public booking page, intake form, review & submit, contract signing, COI upload, deposit payment)

- **`support.js`** — The dc-runtime bundle (auto-loads React from unpkg, runs the component system). Do not edit — it is generated from `dc-runtime/src/*.ts`. Treat it as a vendored dependency.

## Running the prototype

Open `prototype/VenueDash_Prototype.dc.html` in a browser — that's it. No build step, no server required (file:// works). The prototype chrome at the top lets you switch between the three surfaces and tweak demo props.

## Architecture notes (for implementation planning)

### Core booking lifecycle (v1.0 full vision)
`pending → contract → signed → coi_review → deposit → upcoming → today → claim_window → closed`
_v0.5 ships a trimmed subset of this (no `coi_review`/`deposit`/`claim_window` states) — see the v0.5 spec §4._

### Three distinct user surfaces
1. **Studio owner web app** — dashboard-driven, desktop-first
2. **Renter mini-site** — mobile-first, no account required, email-linked flows
3. **Marketing landing page** — standalone, links to onboarding wizard

### Key business rules encoded in the prototype (v1.0 vision — several deferred in v0.5, see "Current build" above)
- Damage deposit held by VenueDash, not the studio (studio collects rent directly) — **v0.5: NOT held; owner collects off-platform**
- 48-hour claim window after event ends; auto-refund if no claim
- Pre/post photo walkthroughs are server-timestamped and locked (immutable after locking)
- COI required before deposit payment is unlocked ($1M event liability, studio as additional insured)
- Contract auto-generated from studio's wizard-configured policies (GA jurisdiction)

## Conventions

- Design tokens: dark background `#0b0c0f`, accent indigo `#7a86ff`, success green `#5fd68b`, warning amber `#e6b054`, danger coral `#ef6f54`
- Fonts: Instrument Sans (UI), Instrument Serif (renter-facing display), IBM Plex Mono (metadata/labels)
- The renter-facing surface uses a warm light palette (`#f7f5f0` bg) to signal a different context from the owner's dark app
