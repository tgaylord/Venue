# VenueDash — Implementation Plan

Companion to ARCHITECTURE.md. Eleven phases, each with goal, steps, and exit criteria. Ordering respects the design brief's build priority (the photo checklist is the product) while sequencing foundations first, since every feature depends on the schema and booking records.

Estimated critical path: Phases 0–5 produce a demoable core; 6–9 make it transactional; 10 makes it launchable.

---

## Phase 0 — Foundation (repo scaffold)

**Goal:** deployable skeleton with auth, database, storage, and email wired.

1. Scaffold Next.js (App Router, TypeScript, Tailwind) at repo root; keep `prototype/` untouched as visual reference.
2. Tailwind config: port design tokens (§11 of ARCHITECTURE.md); load Instrument Sans/Serif + IBM Plex Mono.
3. Route groups `(marketing)`, `(public)`, `(owner)` with placeholder pages; Clerk middleware protecting `(owner)`.
4. Drizzle + Neon: connection via serverless driver, `drizzle-kit` migrations, empty initial migration; `db/schema.ts` established.
5. Clients: R2 (S3 SDK, signed URL helpers in `lib/storage.ts`), Resend (`lib/email.ts` with one test template).
6. `.env.example` with every secret named; README dev-setup section.
7. CI: GitHub Actions — lint, typecheck, build on PR. Vercel project connected for preview deploys.

**Exit:** a signed-in owner sees an empty dashboard shell on a Vercel deploy; CI green.

## Phase 1 — Domain core: schema + state machine

**Goal:** every entity and every legal state transition exists and is tested before any feature UI.

1. Migrate the full schema from ARCHITECTURE.md §4 (all 13 tables).
2. `lib/domain/states.ts`: the state enum + legal-transition table exactly as §3.
3. `lib/domain/transitions.ts`: `transitionBooking(bookingId, to, actor, meta)` — transactional: validate legality → update → append `booking_events` → dispatch side-effect hooks (no-op stubs for now, filled in per phase).
4. Effective-state derivation for clock states (`confirmed → event_day → claim_window` computed from timestamps at read time).
5. Renter-token utility: `lib/tokens.ts` — mint (hash at rest), verify, rotate, purpose+expiry scoping.
6. Seed script recreating the prototype's 8 demo bookings across states (b1 pending … b6 claim_window …) for dev.
7. Tests: every legal transition succeeds; every illegal transition throws; audit row written per transition; token verify/expiry.

**Exit:** `npm test` covers the full transition matrix; seeded dev DB browsable.

## Phase 2 — Onboarding wizard ("Settings & policies")

**Goal:** a studio owner can fully configure their studio and get a live public slug. Port of the prototype's 5-step wizard.

1. Step 1 — Studio profile: name, address, spaces (+ per-space occupancy cap), equipment list.
2. Step 2 — House rules: alcohol policy (3 options), outside vendors, noise curfew, cleanup window.
3. Step 3 — Pricing & deposit: hourly rate, minimum hours, deposit amount; cancellation ladder shown from standard template.
4. Step 4 — Contract preview: rendered Standard template with their values interpolated; COI required toggle; legal disclaimer displayed (hard constraint).
5. Step 5 — Photo checklist config: named areas with hints (seed the 6 defaults from the prototype), reorder/add/edit; "You're live" card with `/book/{slug}` link.
6. Slug generation + uniqueness; wizard revisitable as Settings; each step persists independently (no all-or-nothing submit).
7. Empty-dashboard state (per brief): new studio with zero bookings sees "share your link" guidance, not a blank table.

**Exit:** completing the wizard yields a working (if minimal) `/book/[slug]` page and a dashboard in its empty state.

## Phase 3 — Public booking page + intake (renter, no accounts)

**Goal:** the renter mini-site through "Request sent." Mobile-first, warm-light theme.

1. `/book/[slug]`: studio hero, description, pricing strip (rate/min hours/deposit), house-rule pills, photo grid placeholders.
2. Availability: `availability_blocks` table queried for the visible window; date row + time-slot picker (simple custom calendar per spec — 1–1.5 weeks of scope, not Calendly). Buffers (setup/teardown/cleanup) written as blocks when bookings confirm.
3. Intake form: event type (fixed list), headcount (validated against occupancy cap), BYOB toggle, vendors toggle, notes.
4. Review screen: request summary, price breakdown ("rent paid directly to studio" / deposit line), "what happens next" 4-step explainer.
5. Submit → create `bookings` row (`pending`), snapshot rate+deposit+policies, soft-block the slot, email owner, email renter a tokenized status link.
6. 24-hour approval window surfaced on the owner side (deadline stamp; auto-expiry of stale requests can be manual for MVP).

**Exit:** end-to-end on a phone: pick slot → intake → review → submit; owner email arrives; booking appears in owner dashboard as pending.

## Phase 4 — Owner dashboard + booking detail

**Goal:** the studio owner's daily surface. Direct port of the prototype's dashboard and booking-detail screens.

1. Dashboard sections derived purely from state: **Needs your action** (pending, coi_review, event_day, claim_window), **Waiting on renter** (awaiting_contract/coi/deposit, with "sent N days ago"), **Upcoming & confirmed**, **Past**.
2. Metrics strip: deposits held (sum of captured deposits), upcoming count, needs-action count; sidebar mini-stats.
3. Booking detail: lifecycle rail (all states with current highlighted), status cards (Contract / COI / Deposit / Documentation), intake details.
4. State-specific primary-action cards: pending → approve/decline; coi_review → review card; event_day → start checklist; claim_window → countdown + file-claim card (live countdown to `refund_due_at`).
5. Approve action fires the simultaneous contract + COI emails (stubbed until Phases 7–8 — send tokenized placeholder links now so the flow is walkable).
6. Copy-booking-link button; day-of badge on nav ("Due 2 PM").

**Exit:** all seeded bookings render in the right sections with the right actions; approve/decline transitions work and email.

## Phase 5 — Photo checklist PWA (the product — highest value)

**Goal:** chain-of-custody walkthrough working on real phones.

1. PWA: manifest, icons, service worker (installable; checklist shell cached).
2. Checklist flow (port of prototype): one area per screen, progress bar, item name + hint, live camera viewfinder via `getUserMedia` (**no file-input fallback** — hard constraint), capture → retake/next.
3. Upload per capture: stream to R2 via presigned/route upload, server sets `server_captured_at`, store geolocation (best-effort; record denial).
4. Review grid (all items + thumbnails + timestamps) → **Lock** step with the "can't be edited — that's what makes it evidence" warning → `locked_at` set, audit event, no further mutation paths.
5. Post-event variant: same flow, `kind = post`; locking the post walkthrough is what opens the claim window cleanly.
6. Skip consequence: if event start passes without a locked pre-walkthrough → `deposit_protected = false`, dashboard "unprotected" flag, claim filing disabled for this booking, warning shown.
7. Reminder email 3h before event (cron) linking straight into that event's checklist.
8. Optional renter acknowledgment: tokenized link (expires at event start), non-blocking; `acknowledged_at` recorded.

**Exit:** full pre + post walkthrough completed on iOS Safari and Android Chrome physical devices; photos in R2 with server timestamps; locked records immutable via API.

## Phase 6 — Deposit lifecycle (Stripe Connect)

**Goal:** money moves correctly in test mode.

1. Stripe Connect Express onboarding from the wizard/settings (only requirement for owners; rent stays off-platform).
2. Renter payment page at `r/[token]`: deposit line item, card element, charge + **capture** (no auth hold); webhook `payment_intent.succeeded` → `transitionBooking(confirmed)`; write availability buffer blocks.
3. `refund_due_at = event_end + 48h` stamped when the event ends.
4. Cron sweep (every 15 min): `claim_window` + past `refund_due_at` + no claim → Stripe refund → `closed` → emails.
5. Claim hold: filing sets deposit `held`, cancels auto-refund eligibility.
6. Resolution transfers: accepted/resolved claims → transfer claim amount to owner's Connect account, refund remainder to renter.
7. Webhook handler with signature verification + idempotency; money state only ever advanced by webhooks.

**Exit:** in Stripe test mode — pay deposit → confirmed; no claim → auto-refund fires from cron; claim filed → refund frozen; resolution splits funds.

## Phase 7 — Contract generation + e-signature

**Goal:** signed Georgia venue agreements per booking.

1. Template functions for Standard + Recurring Client with all required clauses (equipment exclusion, occupancy, BYOB/dram shop, § 74-133 curfew, vendors, cleanup, deposit terms, cancellation ladder, GA jurisdiction) interpolated from studio policies + intake.
2. Renter-facing contract view with "In plain English" clause summaries (prototype pattern).
3. `lib/esign/provider.ts` adapter interface; DocuSign sandbox implementation (`createEnvelope`, webhook parse).
4. On approve: envelope created, contract email sent (simultaneous with COI request); webhook `envelope.completed` → `transitionBooking(awaiting_coi | awaiting_deposit)`.
5. Signed PDF pulled and stored to R2; downloadable from booking detail forever.
6. Replace the Phase 4 placeholder links with the real flows.

**Exit:** approve → renter signs in sandbox → state advances automatically → signed PDF retrievable from dashboard.

## Phase 8 — COI collection

**Goal:** insurance document gate. Deliberately simple (spec: hours, not days).

1. Tokenized upload page: PDF/photo → R2; guidance copy (Thimble/Eventsured, "$1M per occurrence," "list studio as additional insured").
2. Owner review card on booking detail: file preview link, "Looks good — unlock deposit" → `awaiting_deposit`; "Request a new COI" → back to `awaiting_coi` + email.
3. `coi_required` respected: studios without it skip both COI states entirely (transition table already encodes this).
4. No API verification — human review only (V1 boundary).

**Exit:** COI-required booking cannot reach payment until owner approves an uploaded document; COI-optional booking skips straight to payment.

## Phase 9 — Damage claim filing

**Goal:** the structured claim flow inside the 48-hour window.

1. Claim form (port of prototype): affected-area pills sourced from the studio's checklist items, factual description, amount input capped at deposit, evidence panel auto-attaching both locked photo sets.
2. Guards: only within window, only if `deposit_protected`, only while deposit `captured`.
3. File → deposit `held`, renter emailed with tokenized accept/dispute link (24h deadline), "what happens next" confirmation screen (claim #, steps).
4. Renter accept → resolution + transfers (Phase 6 plumbing). Renter dispute → founder notified; minimal internal resolution action (a guarded server action or admin-only page — **not** a dashboard) records the binding decision within the ToS's 72h; funds released per decision.
5. All claim actions audit-logged.

**Exit:** claim filed on a seeded claim-window booking freezes refund; both renter paths (accept, dispute→decision) settle funds correctly in test mode.

## Phase 10 — Landing page + launch polish

**Goal:** launchable.

1. Marketing landing page port: hero, three problem/solution cards, how-a-booking-runs, $60/mo flat pricing, first-60-days-free CTA, Atlanta/HBCU footer line.
2. Legal disclaimers placed (onboarding preview, contract footer, landing footer); ToS + privacy pages including the binding dispute framework.
3. Beta mechanics: 60-day free flag on studios (hard stop), referral hook ("refer a studio → 1 free month") visible in dashboard from day one per acquisition plan.
4. Billing: Stripe subscription ($60/mo) activated at day 60 — simplest possible implementation (checkout link + webhook), not a billing system.
5. Empty/edge states pass: zero bookings, declined, canceled, expired requests.
6. Production checklist: live Stripe keys gated, error monitoring (Sentry free tier), domain + SSL via Cloudflare, backup/restore note for Neon.

**Exit:** a stranger can onboard a studio, receive a real booking request, and run it through to deposit refund without founder intervention.

---

## Cross-cutting rules (apply to every phase)

- **State discipline**: no direct writes to `bookings.state` outside `transitionBooking()`.
- **Money discipline**: money state advances only from verified Stripe webhooks.
- **Evidence discipline**: no update/delete paths on locked walkthroughs or their photos, ever.
- **Snapshot discipline**: terms (deposit, rate, policies) are copied onto the booking at request time.
- **Prototype fidelity**: `prototype/VenueDash_Prototype.dc.html` is the visual spec; port screens, don't redesign.
- Each phase lands as its own PR with tests for its domain logic; preview deploy exercised before merge.

## Traceability

| Spec V1 feature | Phase |
|---|---|
| Booking calendar (simple custom) | 3 |
| Contract generation + e-signature | 7 |
| Pre/post photo checklist | 5 |
| Deposit capture + release | 6 |
| COI collection | 8 |
| Damage claim flow | 9 |
| Onboarding wizard | 2 |
| Dashboard + booking detail | 4 |
| Landing page + beta/referral | 10 |
| CUT: GCal sync, dispute dashboard, rent processing, COI verification, SMS, contract editor | excluded by design |
