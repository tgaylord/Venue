# VenueDash — Project Context

VenueDash is a SaaS platform for Atlanta studio owners who rent their spaces for private events. It handles the paperwork layer of event rentals: signed contracts, timestamped condition-photo walkthroughs, and damage deposits with rules-based release.

## What's in this repo

### `docs/`
Implementation source of truth — read these before writing any application code:

- **`ARCHITECTURE.md`** — Locked MVP architecture decisions: system shape, identity model, the booking state machine, full data model, photo chain-of-custody rules, payments, and V1 scope boundaries.
- **`IMPLEMENTATION_PLAN.md`** — The 11-phase (0–10) build plan, each phase with steps and exit criteria, plus cross-cutting rules and a spec traceability table.

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

### Core booking lifecycle
`pending → contract → signed → coi_review → deposit → upcoming → today → claim_window → closed`

### Three distinct user surfaces
1. **Studio owner web app** — dashboard-driven, desktop-first
2. **Renter mini-site** — mobile-first, no account required, email-linked flows
3. **Marketing landing page** — standalone, links to onboarding wizard

### Key business rules encoded in the prototype
- Damage deposit held by VenueDash, not the studio (studio collects rent directly)
- 48-hour claim window after event ends; auto-refund if no claim
- Pre/post photo walkthroughs are server-timestamped and locked (immutable after locking)
- COI required before deposit payment is unlocked ($1M event liability, studio as additional insured)
- Contract auto-generated from studio's wizard-configured policies (GA jurisdiction)

## Conventions

- Design tokens: dark background `#0b0c0f`, accent indigo `#7a86ff`, success green `#5fd68b`, warning amber `#e6b054`, danger coral `#ef6f54`
- Fonts: Instrument Sans (UI), Instrument Serif (renter-facing display), IBM Plex Mono (metadata/labels)
- The renter-facing surface uses a warm light palette (`#f7f5f0` bg) to signal a different context from the owner's dark app
