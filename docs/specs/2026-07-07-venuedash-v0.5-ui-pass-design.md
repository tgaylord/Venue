# VenueDash v0.5 — UI/Flow Pass Design

Status: **Approved for build** · Date: 2026-07-07
Companion plan: [`../plans/2026-07-07-venuedash-v0.5-ui-pass.md`](../plans/2026-07-07-venuedash-v0.5-ui-pass.md)

> **North star:** v0.5 must be *practically easier for a studio owner than not using it* — the baseline being a text thread plus a PDF attachment. Every flow decision in this pass was tested against that bar.

This is the final pre-ship pass over v0.5. It is a **flow pass, not a redesign**: workflows are restructured where they have friction, plus a broad polish sweep — but the visual language (dark owner/marketing, warm-light renter) is unchanged.

## Constraints

- **Prototype demoted to reference** (ADR-0001). `prototype/` is no longer the visual spec of record; the built app's actual v0.5 workflow is what we optimize. Still never edit the prototype files.
- **Brand-investment freeze.** A rename ("VenueDash" is not final) and full brand/design refresh may follow this pass. Nothing in this pass invests in branding: PWA icons get a simple *neutral* glyph (no wordmark), marketing gets consistency fixes but no repaint, Clerk pages get palette-matched via the appearance prop only, and no new surface hardcodes the product name where avoidable.
- **v0.5 scope guardrails hold.** No in-app e-signature, no held deposits, no COI/claims, no Stripe. The state machine's states and legal transitions are untouched (two actions now *traverse* multiple transitions in one user gesture — see below — but every hop goes through `transitionBooking`).
- **Copy discipline holds:** "timestamped documentation," never "immutable evidence."
- The attorney-review banners on `/terms` and `/privacy` **stay** — that launch gate is genuinely open.

## Flow changes (the heart of the pass)

Ranked by observed friction; #1 was confirmed as the worst seam in the product.

### 1. Close the contract gap

The old flow (approve → separate "Generate & send contract" click → leave the app for e-sign → return → find booking → mark signed) was *harder* than the text-thread baseline at the exact step that is the product. Three levers, all pulled:

- **Approve & send contract — one action.** The intermediate stop at `awaiting_contract` is pure friction: the contract is built mechanically from terms already snapshotted and already reviewed during approval. Approving now runs `pending → awaiting_contract → awaiting_signature` (generate + store + email in between) as one owner gesture. An owner who wants different terms declines and asks the renter to re-request; that path is unchanged.
- **The `awaiting_signature` card becomes a signing kit.** Instead of silently waiting, the booking-detail state card narrates the off-platform step: the renter already has their download link by email; the owner gets the PDF, a short "how to get it signed" (free e-sign tool of choice, or print-and-sign at the pre-event walkthrough), and **Mark signed** right there, with copy that makes clear this is the step that confirms the booking.
- **Fix the renter-side promise.** `/status/[token]` and `ContractReadyRenter` stop claiming "a separate signing request will arrive by email" (it never does — signing is manual). New copy: review the agreement now; *your host will arrange signing.*

### 2. Owner "what now?" guidance — narrate existing surfaces, no new screens

- Every dashboard row shows its true next step as a label ("Review request", "Get contract signed", "Pre-event walkthrough due", "Post-event walkthrough due", "Close out"), replacing the two-action `ACTION_HINT` map. Clicking goes to the booking detail where the action lives — **except walkthrough-due rows, which deep-link straight to the capture screen** (event day, phone in hand, must be one tap).
- The dead "Day-of checklist" sidebar item (disabled since Phase 7, stale `// Phase 7` marker) is **removed**. With per-row next-step labels, the needs-action group *is* the today view; a second view would mean two places to check. A dedicated "Today" view was considered and rejected at solo-owner volume.

### 3. Renter status page: narration, not just a badge

`/status/[token]` gains per-state "what happens next" narration alongside event details, agreed terms, and the contract download. Decided boundaries:

- **No deposit status shown to the renter.** `deposit_status` is a manual owner toggle; showing it invites "why does it say uncollected?" texts when the owner is slow to flip it — creating owner work, the opposite of the goal. Returns in v1.0 when it derives from real money movement.
- **No walkthrough/photo visibility** (already deferred to v1.0). One passive line post-confirmation: the host documents the space's condition before and after — timestamped documentation — so the renter isn't surprised by photography.

### 4. Close out — the lifecycle's open end (ADR-0002)

As built, no real booking could ever finish: clock states are derived at read time (stored state stays `confirmed`), and `post_event → closed` was only legal from a *stored* `post_event` that nothing ever wrote. Every booking was a zombie accumulating in the roster.

**Owner "Close out" action:** when a booking's *effective* state is `post_event`, the detail page (and the row, once the post-walkthrough is locked or skipped) offers **Close out**. The action persists the pending clock transitions and closes: `confirmed → event_day → post_event → closed`, each hop via `transitionBooking`, full audit history. Owner-triggered (not auto-on-lock) because "truly done" includes the off-platform deposit return — the owner decides when that moment is, and skipped-walkthrough bookings need the same exit.

### 5. Walkthrough timing

The reminder cron route is live but nothing calls it. A **GitHub Actions schedule** (every 15 min, free tier, in-repo) hits `POST /api/cron/walkthrough-reminders` with the bearer secret. The route is idempotent (`pre_reminder_sent_at`), so cadence is low-risk.

## Polish sweep (scope-in list)

- **Route states:** `loading.tsx` + `error.tsx` per route group (today: none anywhere — blank screens on slow DB, framework crash page on error).
- **Accessibility baseline:** global `focus-visible` styling; `aria-pressed`/roles on BookingFlow's color-only selectors; deposit control rebuilt as its promised full-width labeled segmented control (radiogroup); sidebar `aria-disabled` + `pathname.startsWith` prefix fix; in-app dialogs replacing native `confirm()`/`alert()` in CaptureFlow; text alternatives for emoji-status glyphs; contrast check on the status page's muted tones.
- **`POLICY_LABELS`:** BookingFlow's existing alcohol/vendor label maps promoted to a shared module; owner "Agreed terms" stops rendering raw enums.
- **Capture flow:** upload-failure retry affordance; a "not due yet" explanation instead of the silent redirect; distinct not-found error type (ends the `WalkthroughLockedError` semantic overload).
- **Session expiry:** lapsed Clerk session on an owner action → clear re-auth prompt, not "unexpected response."
- **Cosmetics:** lifecycle-rail genesis-`pending` fix; status-page inline hex/tones onto `renter-*` tokens; light token consolidation where a literal duplicates an existing token (zero visual change intended).
- **Emails:** shared style-constant module; the signing-promise copy fix; delete `TestEmail`.
- **PWA icons:** neutral-glyph icon set replacing the flat `#7a86ff` tiles; add a maskable 192.
- **Auth pages:** Clerk `<SignIn/>`/`<SignUp/>` palette-matched to the dark shell via the appearance prop. No logo work (brand freeze).
- **Public contact:** privacy page's personal Gmail replaced with `venuedash.app@gmail.com`. No domain purchase; Resend's shared sender stays (revisit at brand refresh).
- **Settings:** minimal "save and stay" fix only. No wizard flow changes — customer #1 is founder-onboarded.

## Out of scope (explicit no-s)

- In-app e-signature or any renter-side signing/acknowledgment (v1.0).
- Renter-visible deposit status or walkthrough photos (v1.0).
- Auto-close on walkthrough lock (rejected — see §4 and ADR-0002).
- A "Today"/day-of dashboard view (rejected — see §2).
- Marketing repaint, logo, wordmark, domain purchase, Resend domain verification (brand freeze).
- Service worker / offline shell (v1.0).
- Wizard restructuring beyond save-and-stay.

## Ship after this pass

Onboard a real studio, run a booking end-to-end through close-out, hand-invoice customer #1. Launch gate still open (not code): Georgia attorney review of the contract template.
