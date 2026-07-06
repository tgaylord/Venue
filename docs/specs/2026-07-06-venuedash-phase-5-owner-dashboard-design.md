# VenueDash Phase 5 — Owner Dashboard + Booking Detail — Design

Status: **Approved for planning** · Date: 2026-07-06
Implements: v0.5 spec ([`2026-07-05-venuedash-v0.5-design.md`](./2026-07-05-venuedash-v0.5-design.md)) §5 Phase 5

## 1. Goal & context

Give the studio owner the in-app surface to *act on* booking requests — the first place the domain spine is driven from the owner's side. Today an owner can only receive a `pending` booking (Phase 4) and read the empty dashboard (Phase 3); every state change still requires a script. Phase 5 delivers the owner dashboard (a grouped booking list) and the booking-detail screen (lifecycle rail + state-derived action cards), wiring the owner-facing transitions and the two manual metadata toggles.

Owner surface = **dark palette**, ported from the prototype's Studio Dashboard + Booking Detail screens (`prototype/VenueDash_Prototype.dc.html`), with all v1.0 money-layer UI (held deposits, COI review, claim window, auto-refund, e-sign) dropped or rewritten to v0.5 truth.

This is the owner's half of the state machine built in Phase 2 and exercised by the renter in Phase 4. It stops short of contract generation (Phase 6) and the day-of checklist (Phase 7).

## 2. Decisions made in brainstorming

- **Lifecycle gap at `awaiting_contract` — dead-end placeholder (no bridge).** Approve parks a booking in `awaiting_contract`; the forward step (`awaiting_contract → awaiting_signature`, "contract PDF generated + sent") is Phase 6. Phase 5 renders a muted "Contract generation — next phase" placeholder there, no forward button. The `awaiting_signature → confirmed` mark-signed action *is* in Phase 5 and is fully testable against seeded `awaiting_signature` rows. No temporary bridge is built (Phase 6 follows immediately with no demo in between, so single-booking continuity buys nothing).
- **Owner chrome — full two-pane sidebar now.** Replace the current minimal header with the prototype's sidebar shell. The prototype's "This week" summary cards (held-deposit + claim-window, both v1.0) are dropped as redundant with the main metric strip; the sidebar is studio badge + `/book/{slug}` + nav.
- **Dashboard metric strip — money-free, deposit-action count.** Three cards: *Needs action*, *Upcoming*, *Deposits to act on*. No dollar amounts, no "held" language (VenueDash holds nothing).
- **Approach A — pure view-model layer.** A new DB-free `lib/domain/booking-view.ts` computes effective state, dashboard group, legal owner actions, and display fields from a raw `Booking` + `now`. Server components stay thin; the clock/grouping/legality logic is unit-testable with plain objects (mirrors `states.ts` / `effective-state.ts` / `availability.ts`).
- **No "close out" action (`post_event → closed`) in Phase 5.** Not in the v0.5-spec Phase-5 list; and because clock transitions are not persisted yet, a naturally-elapsed booking is only *effectively* `post_event` (stored `confirmed`), so `post_event → closed` would be illegal anyway — only seeded rows are truly `post_event`. `closed` stays a terminal display state until the clock-persistence phase. `post_event` shows an "event finished / return the deposit" state with the deposit control, no close button.
- **Three dashboard groups, not the prototype's four.** v0.5 has no renter-side action in the loop (signing is manual/off-platform), so a literal "Waiting on renter" section would always be empty. `awaiting_contract`/`confirmed`/`event_day` merge into one **In progress** group. See §8 — "Waiting on renter" is a documented v1.0 forward-step, reintroduced (as data, not a rewrite) when renter-side signing lands.
- **Routes nest under `/dashboard`.** No `proxy.ts` change — the existing `/dashboard(.*)` matcher covers the new detail route.

## 3. Routes, gating, data flow

- **`/dashboard`** — `(owner)` route group, dark layout. Server component:
  1. `auth()` → `getStudioByClerkUserId(db, userId)`; no user → `/sign-in`, no studio → `/settings` (existing pattern).
  2. `listBookingsForStudio(db, studio.id)` (new) → raw `Booking[]`.
  3. Map each through `toBookingView(booking, now)` (`lib/domain/booking-view.ts`); group and render metric strip + sections.
  4. Zero bookings → keep the Phase-3 share-link empty state. Copy-link stays in the header regardless.
- **`/dashboard/bookings/[id]`** — `(owner)` route group. Server component:
  1. `auth()` → studio (as above).
  2. `getBookingForOwner(db, id, studio.id)` (new) — **studio-scoped**; null → `notFound()`.
  3. `getBookingEvents(db, id)` (new) → append-only history for the lifecycle rail.
  4. `toBookingView(booking, now)` drives the conditional cards + legal actions.
- **`proxy.ts`** unchanged: `isProtected = ["/dashboard(.*)", "/settings(.*)"]` already covers both routes. (Do **not** add `middleware.ts`.)

## 4. The view-model layer (`lib/domain/booking-view.ts`, pure, no DB)

The single brain for clock/grouping/legality. Consumes a raw `Booking` + `now: Date`, emits everything the components render.

```ts
type DashboardGroup = "needs_action" | "in_progress" | "past";
// "waiting_on_renter" reserved for v1.0 (see §8) — do not repurpose the slot.
type OwnerAction = "approve" | "decline" | "cancel" | "mark_signed";
// deposit control is handled separately (not a state transition).

type BookingView = {
  id: string;
  storedState: BookingState;
  effectiveState: BookingState;      // deriveEffectiveState(booking, now)
  group: DashboardGroup;
  legalActions: OwnerAction[];       // which action buttons render
  depositControlActive: boolean;     // is the collect/return control live?
  chip: { label: string; tone: "success" | "warning" | "danger" | "muted" };
  // display fields: title (eventType ?? "Event request"), renterName, contact,
  //   formatted date/time range (formatAtlantaRange), headcount, byob, outsideVendors,
  //   depositAmount (formatCents(depositCents)), depositStatus.
};
```

**Effective state** — always `deriveEffectiveState(booking, now)` from `lib/domain/effective-state.ts`; never raw `booking.state`.

**Group mapping (by effective state):**

| Group | Effective states |
|---|---|
| `needs_action` | `pending`, `awaiting_signature` |
| `in_progress` | `awaiting_contract`, `confirmed`, `event_day` |
| `past` | `post_event`, `closed`, `declined`, `canceled` |

**Legal actions** = `LEGAL_TRANSITIONS[storedState]` filtered to owner-driven targets, then gated by effective state:

| Effective state | `legalActions` |
|---|---|
| `pending` | `approve`, `decline`, `cancel` |
| `awaiting_contract` | `cancel` |
| `awaiting_signature` | `mark_signed`, `cancel` |
| `confirmed` | `cancel` |
| `event_day` | *(none)* |
| `post_event` | *(none)* |
| `closed` / `declined` / `canceled` | *(none)* |

- **Safety rule:** `cancel` is suppressed once effective state is `event_day` or `post_event`, so the owner cannot cancel an event that is actually in progress or already over. Stored state lags (clock transitions aren't persisted in Phase 5), so `LEGAL_TRANSITIONS[confirmed]` still *contains* `canceled` at the DB layer — the effective-state gate in the view-model is the guard the UI honors. (Residual clock-race edge accepted; see §6.)
- Legality is derived from **stored** state for the transition itself (that's what `transitionBooking` validates), but **offered** to the owner only when effective state agrees.

**Deposit control** — `depositControlActive` is true only when effective state ∈ {`confirmed`, `event_day`, `post_event`}. When active, the control lets the owner **set any of the three `deposit_status` values directly** (`uncollected` / `collected` / `returned`) — a segmented control, not a forced forward-only cycle, so a mistaken status is correctable. The deposit *amount* always displays as a contract term regardless. On `closed` the final status shows read-only; on `declined`/`canceled` deposit is N/A (no event occurred).

## 5. The two screens (prototype-faithful, v0.5-truthful)

### 5a. Dashboard (`/dashboard`)

- **Sidebar** (from `app/(owner)/layout.tsx` + `_components/Sidebar.tsx`): gradient studio avatar + name, mono `/book/{slug}`, nav — **Dashboard** (active) · **Day-of checklist** (muted/disabled until Phase 7) · **Settings & policies** (→ `/settings`).
- **Header:** `h2` "Dashboard" + subtitle (today's date · Atlanta) + copy-link button top-right (reuse `_components/CopyLinkButton.tsx`).
- **Metric strip** — 3 cards:
  - *Needs action* = count of the `needs_action` group.
  - *Upcoming* = count of bookings effectively `confirmed` or `event_day`.
  - *Deposits to act on* = count where `depositControlActive && depositStatus !== "returned"` (still needs a collect or return).
- **Grouped list** — sections **Needs your action** / **In progress** / **Past**, each gated on non-empty, mono uppercase header + count pill. Rows: 3px left-border tinted by chip tone, title (`eventType ?? "Event request"`), `renterName · date`, status chip, CTA hint + chevron on actionable rows. Whole row links to the detail route.
- **Empty state** (zero bookings): the Phase-3 share-link card.

### 5b. Booking detail (`/dashboard/bookings/[id]`)

- **Header:** "← Dashboard" back link · title · `renterName · email/phone` · effective-state chip · meta pill row (date·time range · N guests · BYOB · outside vendors).
- **Left rail — `LifecycleRail`:** the 9-state spine as a vertical timeline; past steps filled, current bold/accent, future muted. Current position from **effective** state. Off-spine terminals (`declined`/`canceled`) render as a distinct terminal marker rather than being forced onto the linear path; actual path history comes from `booking_events`.
- **Right column — conditional primary card by effective state:**

  | Effective state | Primary card | Actions |
  |---|---|---|
  | `pending` | "New booking request" + **Intake details** + **Agreed terms** (from snapshot) | Approve · Decline |
  | `awaiting_contract` | Muted "Contract generation — next phase" placeholder | Cancel |
  | `awaiting_signature` | "Mark contract signed" (one-way → confirmed) | Mark signed · Cancel |
  | `confirmed` | "Confirmed" status | Cancel · deposit control |
  | `event_day` | "Event today" banner (checklist = Phase 7 note) | deposit control |
  | `post_event` | "Event finished — return the deposit" | deposit control |
  | `closed` / `declined` / `canceled` | Terminal presentation (muted) | deposit read-only (closed) |

- **Status grid** (COI card dropped for v0.5): **Contract** (Standard Event Rental · GA jurisdiction; "generated next phase" placeholder) · **Deposit** (amount + status + control) · **Documentation** (pre/post walkthrough — Phase 7 placeholder).
- **Agreed terms** panel reads the full `rateSnapshot` — the reason the seed is aligned to the 8-field snapshot (§7).

**Copy discipline (mandatory rewrites from the v1.0 prototype):** no "held by VenueDash" / "secured" / "released on schedule"; no COI card or "$1M per occurrence"; no claim window, countdown, or "auto-refunds"; no "sends the contract and COI automatically" / "pay the deposit — you're booked"; **"timestamped documentation," never "immutable evidence."** Deposit language reflects an off-platform, owner-arranged deposit that VenueDash only records.

## 6. Server actions & error handling

`app/(owner)/dashboard/bookings/[id]/actions.ts` (`"use server"`) + colocated pure `forms.ts` (parsers + form-state constant — async-export rule: no `const` export from the `"use server"` file). Established Phase-3 shape: `requireUserId()` → `getStudioByClerkUserId` → `getBookingForOwner(db, id, studio.id)` → pure parse → domain call → `revalidatePath`. Actions **stay on the page** (`revalidatePath('/dashboard/bookings/[id]')` + `revalidatePath('/dashboard')`), not `redirect()`.

| Action | Domain call |
|---|---|
| `approveBooking` | `transitionBooking(id, "awaiting_contract", owner)` |
| `declineBooking` | `transitionBooking(id, "declined", owner)` |
| `cancelBooking` | `transitionBooking(id, "canceled", owner)` — parser + view-model gate reject unless effective state is pre-event |
| `markSigned` | `transitionBooking(id, "confirmed", owner, { meta:{ contractSignedAt } })` **then** stamp `contract_signed_at` |
| `setDeposit` | `setDepositStatus(db, id, status)` — updates `deposit_status` + `deposit_status_at` |

- **Actor** is always `{ type: "owner", id: userId }`.
- Client action cards use `useActionState` with `BookingActionState = { status: "idle" | "error"; message?: string }` (+ idle constant in `forms.ts`) for pending state and inline errors.
- **`markSigned` atomicity (conscious call):** transition first (guarded CAS), then the `contract_signed_at` column update; the timestamp also rides in the transition `meta` for the audit row. If the second write fails, the booking is `confirmed` with a null timestamp — accepted (informational timestamp, single-owner tool). `transitionBooking` is not forked to carry extra columns.
- **Deposit changes write no `booking_events` row** (not a state transition); `deposit_status_at` is the record. Deposit-history auditing is a v1.0 nicety.

**Error handling:**
- **Ownership is the security boundary.** `getBookingForOwner` filters `where(and(eq(id), eq(studioId)))`; another studio's booking → null → `notFound()`. Enforced server-side in every action and in the detail page — never trusting the UI (contrast: the public status page is token-scoped).
- Not signed in → `/sign-in` (middleware also gates); no studio → `/settings`.
- `IllegalTransitionError` / `ConcurrentTransitionError` / `BookingNotFoundError` are caught → friendly inline error via form-state, then `revalidatePath` so the UI resnaps to true state. No crash, no unhandled throw reaching the client.
- **Clock-race edge (accepted):** a booking ticking into `event_day` between render and a cancel click — `transitionBooking` validates *stored* state, so a stored-`confirmed` cancel would still succeed. The effective-state UI gate is the primary guard; this residual edge is the same clock-lag reality as any un-persisted derivation and disappears when clock-persistence lands.

## 7. New helpers & data alignment

**`lib/booking.ts` (add):**
- `listBookingsForStudio(db, studioId)` → `Booking[]` for the studio (grouping/effective-state derivation happens in the view-model, not SQL). The helper returns a stable order; per-section sort is applied in the view/render layer — **Needs your action** and **In progress** by soonest `startsAt` first, **Past** by most-recent `startsAt` first.
- `getBookingForOwner(db, bookingId, studioId)` → `Booking | null`, studio-scoped ownership check.
- `getBookingEvents(db, bookingId)` → `BookingEvent[]` ordered ascending for the lifecycle rail.
- `setDepositStatus(db, bookingId, status)` → updates `deposit_status` + `deposit_status_at = now`.

**Reused unchanged:** `transitionBooking`, `deriveEffectiveState`, `LEGAL_TRANSITIONS`, `formatAtlantaRange`, `formatCents`, `getStudioByClerkUserId`, `CopyLinkButton`.

**Seed alignment (`scripts/seed.ts`):** widen `rateSnapshot` from the narrow 3-field shape to the full 8-field `TermsSnapshot` (`hourlyRateCents, minHours, cancellationLadder, alcoholPolicy, vendorPolicy, noiseCurfew, cleanupWindowMin, maxOccupancy`) so the detail "Agreed terms" panel renders for seeded rows; and fix the two policy-enum mismatches (`byob_with_agreement` → `byob_with_acknowledgment`, `approved_in_advance` → `pre_approval`) to match the wizard's canonical enums. Dev data only — no migration.

## 8. Deferred to v1.0 (documented forward-steps)

- **"Waiting on renter" dashboard group.** The `DashboardGroup` type reserves the concept; the group repopulates (as data, not a UI rewrite) once renter-side action re-enters the loop. Reintroducing renter-side contract signing (in-app e-sign / renter acknowledgment token) is the expected **first post-v0.5 step** and is what fills this section.
- **Clock-state persistence** (`confirmed → event_day → post_event`) via a scheduler — Phase 5 derives these at read time only. Persisting them is what makes `post_event → closed` (owner "close out") reachable for naturally-elapsed bookings and removes the cancel clock-race edge.
- **Deposit-status audit history** — v0.5 records only the latest `deposit_status_at`.
- **COI, claims/disputes, held deposits, automated e-sign** — per the v0.5 spec, unchanged.

## 9. Testing

- **Pure unit (no DB):** `lib/domain/booking-view.ts` — every one of the 9 states → correct group; `legalActions` per state including `cancel` suppression at `event_day`/`post_event`; `depositControlActive` rule; chip tones. `forms.ts` parsers — invalid uuid, out-of-set action/deposit-status values.
- **PGlite (`lib/domain/test-db.ts`):** the four new `lib/booking.ts` helpers — `listBookingsForStudio` (studio isolation: another studio's rows excluded), `getBookingForOwner` (other-studio → null), `getBookingEvents` (ordered), `setDepositStatus` (sets status + timestamp). Integration: each action drives `transitionBooking` correctly and appends a `booking_events` row; `markSigned` yields `confirmed` + non-null `contract_signed_at`; ownership rejection; illegal-transition caught and surfaced.
- **Render verification** (the "render, don't curl" lesson): render `/dashboard` (grouped list, metric strip) and the detail screen across representative states via an authenticated preview walk plus a local unauthenticated debug render of the client action cards. The seed's all-9-states coverage makes every branch reachable without hand-crafting data.
- Each domain unit lands with its tests; the preview deploy is exercised before merge (per-phase PR discipline).

## 10. Out of scope (explicit)

Contract PDF generation and the real sign flow (Phase 6); the day-of photo checklist and its nav target (Phase 7); any Stripe/deposit-money handling, COI, or claims (v1.0); clock-state persistence and "close out"; per-studio timezone. The `awaiting_contract → awaiting_signature` transition is intentionally left with no Phase-5 trigger (§2).
