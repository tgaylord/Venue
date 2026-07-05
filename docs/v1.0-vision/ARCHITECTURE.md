# VenueDash — Architecture Decisions

Status: **Locked for MVP** · Derived from: MVP Full-Scope spec, Pre-Build Design Brief, UI prototype (`prototype/VenueDash_Prototype.dc.html`)

---

## 1. System shape: one app, three surfaces

**Decision: a single Next.js (App Router) application** deployed on Vercel. No separate backend, no monorepo, no second app for renters.

Route groups partition the three surfaces:

```
app/
  (marketing)/            → venuedash.com landing page (public, SSR/static)
  (public)/
    book/[slug]/          → renter mini-site: studio page, date picker, intake, review
    r/[token]/            → all tokenized renter flows: contract, COI upload,
                            deposit payment, claim response, acknowledgment
  (owner)/                → Clerk-gated studio owner app
    dashboard/
    bookings/[id]/
    checklist/[bookingId]/
    claims/[bookingId]/
    settings/             → onboarding wizard (revisitable as "Settings & policies")
  api/
    webhooks/stripe/
    webhooks/esign/
    cron/                 → claim-window sweep, reminder emails
```

Rationale: the renter surface is stateless from an account perspective (hard constraint: **no renter accounts**), so it does not justify a separate deployment. The owner app and public pages share the domain model, design tokens, and email templates.

## 2. Identity model

| Actor | Identity mechanism |
|---|---|
| Studio owner | Clerk (email/password, Google OAuth, magic link). One Clerk user ↔ one `studios` row for MVP. |
| Renter | **No account, ever (V1).** Identity = booking-scoped signed tokens embedded in email links. |

**Renter tokens** (`renter_tokens` table): random 256-bit value, hashed at rest, scoped to `(booking_id, purpose, expires_at)`. Purposes: `status`, `contract`, `coi_upload`, `payment`, `acknowledge`, `claim_response`. Single active token per purpose; re-sending an email rotates the token. The acknowledgment token expires at event start (per brief: acknowledgment is optional and non-blocking); others expire with the booking's relevant window.

## 3. Booking state machine — the spine of the product

One enum, one transition module, enforced server-side only. Every screen, dashboard section, email, and cron behavior derives from this state. **No feature may mutate `bookings.state` except through `transitionBooking()`.**

```
pending
  → declined                      (owner declines; terminal)
  → awaiting_contract             (owner approves; contract + COI request sent simultaneously)
awaiting_contract
  → awaiting_coi                  (renter signs; studio requires COI)
  → awaiting_deposit              (renter signs; studio does NOT require COI)
awaiting_coi
  → coi_review                    (renter uploads COI)
coi_review
  → awaiting_deposit              (owner approves COI)
  → awaiting_coi                  (owner requests a new COI)
awaiting_deposit
  → confirmed                     (Stripe webhook: deposit captured)
confirmed
  → event_day                     (clock: event date reached — checklist due)
event_day
  → claim_window                  (clock: event end time passed; 48h window opens)
claim_window
  → closed                        (cron: window expired, no claim → auto-refund)
  → claim_filed                   (owner files claim → refund frozen, renter notified)
claim_filed
  → claim_resolved                (renter accepts, OR founder decision after dispute)
claim_resolved → closed           (funds released per resolution)
canceled                          (reachable from any pre-event state via cancellation ladder)
```

Implementation:
- `lib/domain/transitions.ts` — a declarative `Record<State, State[]>` legal-transition table + `transitionBooking(bookingId, to, actor, meta)` which (in one DB transaction) validates legality, updates state, appends a `booking_events` audit row, and enqueues side effects (emails, Stripe calls).
- **Audit log is append-only** (`booking_events`: state_from, state_to, actor_type [owner|renter|system|cron], timestamp, metadata JSON). This is a legal-posture requirement, not just debugging — claims hinge on provable sequences.
- Clock-driven transitions (`confirmed → event_day → claim_window`) are computed, not stored eagerly: a cron marks them, but reads also derive "effective state" from timestamps so the UI is never stale between cron runs.

## 4. Data model

```
studios          id, clerk_user_id, name, slug (unique), address, description,
                 equipment_list, hourly_rate_cents, min_hours, deposit_cents,
                 coi_required (bool), alcohol_policy, vendor_policy, noise_curfew,
                 cleanup_window_min, cancellation_ladder (jsonb), stripe_account_id,
                 onboarding_completed_at
spaces           id, studio_id, name, max_occupancy
checklist_items  id, studio_id, position, name, hint      -- owner-configured areas
availability_blocks  id, studio_id, starts_at, ends_at, source (booking|manual|buffer)
bookings         id, studio_id, state, renter_name, renter_email, renter_phone,
                 event_type, headcount, byob, outside_vendors, notes,
                 starts_at, ends_at, deposit_cents (snapshot), rate_snapshot (jsonb),
                 deposit_protected (bool, default true), created_at
booking_events   id, booking_id, from_state, to_state, actor_type, actor_id,
                 metadata (jsonb), created_at              -- APPEND-ONLY
walkthroughs     id, booking_id, kind (pre|post), started_at, locked_at,
                 acknowledged_at (nullable)
walkthrough_photos  id, walkthrough_id, checklist_item_id, r2_key,
                 server_captured_at, lat, lng, bytes, content_type
contracts        id, booking_id, template (standard|recurring), envelope_id,
                 status (sent|signed|voided), signed_pdf_r2_key, sent_at, signed_at
coi_documents    id, booking_id, r2_key, status (pending_review|approved|rejected),
                 uploaded_at, reviewed_at
deposits         id, booking_id, stripe_payment_intent_id, amount_cents,
                 status (pending|captured|refunded|held|released_to_owner|split),
                 captured_at, refund_due_at, resolved_at
claims           id, booking_id, description, amount_cents, area_item_ids (jsonb),
                 status (filed|accepted|disputed|resolved), renter_deadline_at,
                 resolution (jsonb), filed_at
renter_tokens    id, booking_id, purpose, token_hash, expires_at, used_at
```

Notes:
- **Snapshots over joins for legal fields**: deposit amount, rate, and policies are copied onto the booking at request time so later settings changes can't alter the terms of an existing agreement.
- `deposit_protected` flips to `false` if the pre-event walkthrough was never locked (checklist-skip consequence). Claim filing is disabled when false.
- Drizzle ORM over Neon serverless Postgres; migrations via `drizzle-kit`, committed to the repo.

## 5. Photo chain of custody (hard constraint)

The photo checklist is the product's legal backbone. Requirements, in order of enforcement:

1. **In-app capture only** — MediaDevices `getUserMedia` camera stream inside the PWA; no `<input type="file">` fallback that reads camera roll. (This is the brief's explicit non-negotiable.)
2. **Server timestamps** — `server_captured_at` is set by the API route at upload receipt. Device clock is never trusted or stored as authoritative.
3. **Geotag** — browser Geolocation API, captured client-side, stored per photo. Best-effort (renter of the API can deny); denial is recorded, not blocking.
4. **Immediate durable write** — photo streams to Cloudflare R2 on capture (per item, not batched at the end), so a crashed phone mid-walkthrough loses one photo, not six.
5. **Locking** — `walkthroughs.locked_at` set once; after lock there is **no update or delete path in the API** for the walkthrough or its photos. Enforced in code and by convention (no soft-delete backdoor). Lock writes a `booking_events` audit row.
6. **R2 layout** — `studios/{studioId}/bookings/{bookingId}/{pre|post}/{itemId}.jpg`; bucket private; owner/renter access only via short-lived signed URLs.

Skip consequence (from spec): skipping never blocks the event. It shows the hard warning ("You cannot file a damage claim for this event"), sets `deposit_protected = false`, and the dashboard flags the deposit "unprotected."

## 6. Payments (Stripe Connect — deposit only)

- **Scope**: V1 processes **only the damage deposit**. Rent is collected by the studio however they already collect it. This is the spec's onboarding-friction decision; do not widen it.
- **Charge + capture at confirmation** — not an authorization hold (auth holds expire at 7 days; bookings are made weeks out). Renter-facing copy: "refunded within 3 days of your event if no claim is filed."
- **Connect account type**: Express accounts for studio owners; onboarding link generated during wizard; deposit claims that resolve in the owner's favor are transferred to their Connect account.
- **Refund path**: Vercel Cron (`api/cron/claim-window-sweep`, every 15 min) finds `claim_window` bookings past `refund_due_at` with no claim → issues Stripe refund → `transitionBooking(closed)` → emails both parties.
- **Claim path**: filing a claim inside the window freezes the auto-refund (deposit `status = held`). Accept → split/transfer + refund remainder. Dispute → manual founder decision (V1 has **no arbitration dashboard** — email + ToS framework), founder records the resolution via a minimal internal action.
- **Webhooks** are the source of truth for money state (`payment_intent.succeeded`, `refund.updated`, `transfer.created`); the UI never assumes success from a client redirect.

## 7. Contracts + e-signature

- Two fixed templates — **Standard Event Rental** and **Recurring Client** — stored as typed template functions in the codebase, not a document editor. Values interpolated from studio policies (onboarding) + booking intake.
- Required clauses (per spec): equipment exclusion, max occupancy, alcohol/BYOB with dram-shop language, noise curfew citing Atlanta Code § 74-133, outside vendor approval, cleanup deadline, deposit terms with 48-hour claim window, cancellation ladder (30+ days full / 14–29 days 50% / <14 days none), Georgia jurisdiction.
- **Vendor adapter**: `lib/esign/provider.ts` defines a narrow interface (`createEnvelope`, `getStatus`, webhook parser); `docusign.ts` implements it against the DocuSign developer sandbox (~1,000 free envelopes). The planned Dropbox Sign migration is a second adapter, not a rewrite.
- Signed PDF stored to R2, retrievable forever from the dashboard.
- Renter-facing contract page includes the prototype's "In plain English" summaries alongside clauses.

## 8. Email (Resend + React Email)

All notifications derive from state transitions — the transition module enqueues them. V1 set:
booking request received (owner) · request approved + contract/COI links (renter, simultaneous per spec) · COI uploaded (owner) · deposit payment link (renter) · booking confirmed (both) · pre-event checklist reminder, 3h before (owner) · optional acknowledgment link (renter) · post-event window open (owner) · claim filed (renter) · deposit refunded/resolved (both). SMS is V2.

## 9. PWA (hard constraint: no native app)

Web app manifest + service worker (installable, offline shell for the checklist screen), mobile-first layouts for checklist and all renter pages. Camera and geolocation both work in iOS Safari and Android Chrome PWAs — verified as part of Phase 5 exit criteria on real devices.

## 10. Legal disclaimer placement (hard constraint)

VenueDash is not a law firm; templates are not legal advice. Disclaimer appears: in the onboarding contract-preview step, in the contract footer, and on the landing page footer. ToS contains the binding dispute-decision framework the claim flow references.

## 11. Design system

Port the prototype's tokens into Tailwind config:
- Owner surface (dark): bg `#0b0c0f`, panel `#16171c`/`#16181e`, border `#26272e`, text `#e9eaee`/`#9a9ca8`, accent `#7a86ff`, success `#5fd68b`, warning `#e6b054`, danger `#ef6f54`
- Renter surface (warm light): bg `#f7f5f0`, ink `#211f1a`, border `#ddd7c6`, ok `#4d7c4a`
- Fonts: Instrument Sans (UI), Instrument Serif (renter display), IBM Plex Mono (metadata)
- The prototype is the visual reference of record; screens are ported, not redesigned.

## 12. Explicitly out of scope for V1 (do not build)

Google Calendar sync · dispute arbitration dashboard · rent payment processing · COI API verification (human review only) · SMS · custom contract editor · multi-studio accounts · renter accounts.

## 13. Environments & config

- Vercel: production + preview deploys per PR. Neon branch databases for previews.
- Secrets: Clerk, Neon, Stripe (test + live), R2, DocuSign sandbox, Resend — all via Vercel env vars; `.env.example` committed.
- Stripe test mode until first real customer; DocuSign stays on sandbox until envelope volume forces migration.
- Fixed infra cost target: ~$0/mo at MVP (all free tiers), per spec economics.
