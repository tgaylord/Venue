# VenueDash v0.5 — UI/Flow Pass Implementation Plan

Spec: [`../specs/2026-07-07-venuedash-v0.5-ui-pass-design.md`](../specs/2026-07-07-venuedash-v0.5-ui-pass-design.md) — read it first; it carries the decisions and the explicit out-of-scope list.

Structure: **two PRs off sequential branches.** PR A (flow) lands first so PR B's copy/a11y sweep runs over final screens. Follow the established per-phase process (branch → tests-first for domain logic → whole-branch review → PR with preview-deploy walk → merge). Reminder: use Node 20 (`nvm use 20`).

---

## PR A — Flow changes (`feat/ui-pass-flow`)

### A1. Approve & send contract (one action)

- `lib/` — new orchestration: `approveAndSendContract(db, booking, identity, deps, actor)` = `transitionBooking(awaiting_contract)` → existing `generateAndAdvance(...)` (which itself CAS-transitions to `awaiting_signature`). Reuse `generateAndAdvance` as-is; the CAS on each hop remains the race guard (double-click ⇒ caught IllegalTransition). PGlite tests: happy path writes two `booking_events` rows + contract row; double-fire idempotence; failure after first hop leaves booking in `awaiting_contract` with a working standalone "Generate & send" recovery path.
- `app/(owner)/dashboard/bookings/[id]/_components/ActionButtons.tsx` + owner actions file — the approve action becomes **"Approve & send contract"**; keep the existing standalone generate action wired for the recovery case (a booking parked in `awaiting_contract` after a partial failure still shows the old button).
- `lib/domain/booking-view.ts` — `approve` OwnerAction label/semantics updated; `generate_contract` remains for stored-`awaiting_contract` bookings. Unit tests updated.
- Renter email timing note: approval and contract-ready emails now fire in the same gesture — send only `ContractReadyRenter` (it announces both), don't double-email.

### A2. Signing kit (`awaiting_signature` card)

- Booking detail state card for `awaiting_signature`: contract download link, short "how to get it signed" copy (own e-sign tool, or print & sign at the pre-event walkthrough), **Mark signed** button colocated with copy stating this confirms the booking. Pure UI + copy; no domain change.

### A3. Renter status page narration + copy fix

- `app/(public)/status/[token]/page.tsx` — per-state "what happens next" narration block (a small state→copy map, unit-testable as a plain module); remove the "signing request will arrive by email" sentence; add the one-line condition-documentation note (post-confirmation states); event details/terms/contract download unchanged. **No deposit status, no photos** (spec §3).
- `emails/ContractReadyRenter.tsx` — same copy fix ("your host will arrange signing").

### A4. Dashboard next-step labels + walkthrough deep-links

- `app/(owner)/_components/BookingRow.tsx` — replace the two-entry `ACTION_HINT` with a full next-step label map driven by `toBookingView` (review request / get contract signed / pre-walkthrough due / post-walkthrough due / close out). Walkthrough-due rows link to `/dashboard/bookings/[id]/walkthrough/[pre|post]` directly; all others to the detail page.
- `lib/domain/booking-view.ts` — expose a `nextStep` (label + href kind) on the view model so the row stays dumb. Unit-test across all 9 states × walkthrough presence.

### A5. Close out

- `lib/domain/` — `closeOutBooking(db, booking, actor)`: guard effective state is `post_event`; persist pending clock transitions then close (`confirmed → event_day → post_event → closed`, each via `transitionBooking`; skip hops whose stored state is already past). PGlite tests: from stored `confirmed`/`event_day`/`post_event`; audit rows for every hop; illegal from pre-event states; double-fire.
- `booking-view.ts` — `close_out` OwnerAction when effective `post_event` (detail always; row once post-walkthrough locked or skipped).
- Owner action + button on detail (and needs-action row label per A4).

### A6. Reminder scheduler

- `.github/workflows/walkthrough-reminders.yml` — `schedule: */15 * * * *` plus `workflow_dispatch:` (for manual verification), curl `POST https://venue-gold.vercel.app/api/cron/walkthrough-reminders` (hardcode the URL — it's public; changes with a commit at brand refresh) with `Authorization: Bearer ${{ secrets.CRON_SECRET }}`. **Ops already done (2026-07-07):** `CRON_SECRET` was rotated, set on Vercel Production (redeployed) and as a GitHub repo secret, and verified live (curl with the shared value → 200). No secret setup needed — just commit the workflow and do a manual `workflow_dispatch` run to confirm green. Route already idempotent.

**PR A verification:** full preview-deploy walk — request → approve&send (renter email received, one email only) → signing kit → mark signed → seeded event-day booking deep-link → close out a stored-`confirmed` past booking and confirm the audit rail shows all hops.

---

## PR B — Polish sweep (`feat/ui-pass-polish`, branched after A merges)

### B1. Route states
`loading.tsx` + `error.tsx` for `(owner)`, `(public)`, `(marketing)` route groups (palette-appropriate). Error boundaries are client components — keep them dumb.

### B2. Accessibility baseline
- `app/globals.css`: global `:focus-visible` ring (both palettes); stop pairing `focus:outline-none` with border-only cues.
- `BookingFlow.tsx`: `aria-pressed` on date/time/duration selectors; BYOB/vendor toggles → real checkbox/switch semantics; label/`aria-describedby` wiring on headcount + error text.
- `DepositControl.tsx`: rebuild as full-width labeled segmented control (radiogroup) — this is also the promised layout fix out of the cramped 3-col grid.
- `Sidebar.tsx`: remove dead "Day-of checklist" item (spec §2); `aria-disabled` pattern for any future disabled items; active-link match `pathname === href || pathname.startsWith(href + "/")`.
- `CaptureFlow.tsx`: in-app confirm dialog replacing `confirm()`/`window.location.href` bail; text alternatives beside emoji glyphs.
- Contrast-check status-page muted tones (`#8a867c` on `#f7f5f0`); darken if failing WCAG AA.

### B3. Labels & copy
- `lib/labels.ts` (or similar): promote `ALCOHOL_LABEL`/`VENDOR_LABEL` from BookingFlow to shared `POLICY_LABELS`; consume in owner "Agreed terms" and keep BookingFlow on the shared module.
- Privacy page: `tgaylord2024@gmail.com` → `venuedash.app@gmail.com`.
- Attorney banners on terms/privacy: keep.

### B4. Capture flow robustness
- Upload failure → visible retry button (re-run presign+PUT for the failed item).
- Not-yet-due walkthrough: render an explanation ("available on the event date") instead of the silent redirect.
- `lib/walkthrough.ts`: distinct `WalkthroughNotFoundError`; `commitCapture` stops throwing `WalkthroughLockedError` on not-found. Tests updated.

### B5. Session expiry
Owner action wrappers detect an auth-failed action response and surface "session expired — sign in again" with a sign-in link, replacing the generic "unexpected response."

### B6. Cosmetics & tokens
- Lifecycle-rail genesis-`pending` rendering fix.
- `status/[token]`: inline `style={{color}}` tones → `renter-*` tokens/classes.
- Token consolidation only where a literal exactly duplicates an existing token (e.g. `#0d0e14` button-foreground → pick/add one token); **zero intended visual change** — no marketing repaint (brand freeze).

### B7. Emails & PWA
- `emails/_style.ts` shared constants; apply across the four production templates; delete `TestEmail.tsx`.
- Neutral-glyph icon set (no wordmark — brand freeze): regenerate `icon-192.png` (any + a maskable variant), `icon-512.png` (maskable), `apple-touch-icon.png`; update `app/manifest.ts` icon list.

### B8. Auth pages & settings
- Clerk appearance prop on `/sign-in` + `/sign-up` matching the dark owner palette. No logo.
- Settings steps: "save and stay" (success message in place of the redirect-to-next-step when editing post-onboarding). Minimal — no wizard restructuring.

**PR B verification:** preview walk of every surface in both palettes; keyboard-only pass over booking flow + deposit control; Lighthouse a11y run on `/book/[slug]`, `/status/[token]`, `/dashboard`; install the PWA and check icons on a real device.

---

## PR A status

**Merged** as PR #20 (2026-07-07). All 6 tasks (A1–A6) landed. 266 tests (23 new), lint + typecheck clean, 5 CI checks green.

### PR A review carry-forwards (acceptable for v0.5, candidates for future work)

1. **N+1 dashboard query** — `dashboard/page.tsx` fetches walkthrough summaries per-booking inside `Promise.all(bookings.map(...))`. Fine at current scale; batch with a single `WHERE booking_id IN (...)` when row counts grow.
2. **Error-mapping duplication** — owner server actions each map domain errors to user-facing strings independently. Known tech debt; extract a shared `mapDomainError` helper when actions multiply.
3. **Hardcoded close-out chain** — `close-out.ts` has a literal `["confirmed","event_day","post_event","closed"]` array. Acceptable: the chain mirrors the state machine and a mismatch would be caught by `transitionBooking`'s guard. Could derive from `LEGAL_TRANSITIONS` if the machine grows.

### Deviations from plan

- **A6 workflow_dispatch verification** deferred to post-merge (can't trigger `workflow_dispatch` until the file is on the default branch). Verify manually after docs PR merges.
- **Sidebar dead-item removal** (`"Day-of checklist"`) done in PR A rather than PR B (B2) — it was a one-liner adjacent to A4 work.

---

## Carry-forwards (unchanged, for the ledger)
Attorney review of contract template (launch gate); Resend domain verification + `EMAIL_FROM` (deferred to brand refresh — remember the unquoted-value footgun); `rate_limits` TTL cleanup; `availableStartHours` half-open-edge tests; share-link gating on `onboarding_completed_at`; `createStudio` unique-violation retry; service worker.
