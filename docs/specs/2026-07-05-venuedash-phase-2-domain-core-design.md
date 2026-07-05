# VenueDash Phase 2 — Domain Core — Design

Status: **Approved for planning** · Date: 2026-07-05
Parent spec: [`2026-07-05-venuedash-v0.5-design.md`](./2026-07-05-venuedash-v0.5-design.md) (§4 architecture deltas, §5 Phase 2)
Reference: [`../v1.0-vision/ARCHITECTURE.md`](../v1.0-vision/ARCHITECTURE.md) §3 (state machine), §4 (data model)

> **One line:** *The product's spine: full v0.5 schema, the trimmed booking state machine behind a transactional `transitionBooking`, an append-only audit log, renter tokens, and a seeded dev database — all proven by a full transition-matrix test suite.*

---

## 1. Goal & context

Phases 0–1 are merged (foundation + landing). Phase 2 builds the domain layer every later feature hangs off: schema, state machine, audit log, tokens, seed data. No UI in this phase. Exit per the v0.5 spec: `npm test` covers the full transition matrix; a seeded dev DB is browsable.

## 2. Decisions made in brainstorming

| Decision | Choice |
|---|---|
| Schema scope | **Full v0.5 schema now** — all 10 tables in one migration (already designed in ARCHITECTURE §4 + v0.5 deltas) |
| Atomicity | **Neon websocket Pool driver + `db.transaction()`**, with a compare-and-swap on the from-state; `lib/db.ts` unified on this one driver (approach A, no dual drivers) |
| Test DB | **PGlite** (`@electric-sql/pglite`, devDependency) — in-memory Postgres applying the real generated migrations; CI needs no secrets |
| Delivery | One PR on `feat/phase-2-domain-core` |
| DI | `transitionBooking` and token functions take the Drizzle handle as a parameter so tests inject PGlite |

## 3. Schema (`db/schema.ts`, one generated migration)

All tables from ARCHITECTURE §4 with the v0.5 deltas from the parent spec §4:

| Table | Notes / v0.5 deltas |
|---|---|
| `studios` | As §4, **minus `stripe_account_id`** (no Stripe in v0.5). `coi_required` boolean default `false`. `slug` unique. `cancellation_ladder` jsonb. |
| `spaces` | `id, studio_id, name, max_occupancy`. |
| `checklist_items` | `id, studio_id, position, name, hint`. |
| `availability_blocks` | `id, studio_id, starts_at, ends_at, source (booking\|manual\|buffer)`. |
| `bookings` | Trimmed `state` enum (§4 below). Snapshot fields: `deposit_cents`, `rate_snapshot` jsonb (rate + policies copied at request time). `deposit_protected` boolean default `true`. Intake fields per §4 (renter name/email/phone, event_type, headcount, byob, outside_vendors, notes, starts_at, ends_at). **v0.5 additions:** `deposit_status` enum `uncollected\|collected\|returned` default `uncollected`, `deposit_status_at`, `contract_signed_at`. |
| `booking_events` | **Append-only audit:** `id, booking_id, from_state, to_state, actor_type (owner\|renter\|system), actor_id, metadata jsonb, created_at`. No update/delete path anywhere in code. |
| `walkthroughs` | `id, booking_id, kind (pre\|post), started_at, locked_at, acknowledged_at`. |
| `walkthrough_photos` | Per §4 **plus `sha256`** (v0.5 delta). |
| `contracts` | `id, booking_id, template ('standard' only for now), status (sent\|signed\|voided), signed_pdf_r2_key, sent_at, signed_at`. **No `envelope_id`** — e-sign is v1.0. |
| `renter_tokens` | `id, booking_id, purpose (text; only 'status' used in v0.5), token_hash, expires_at, used_at`. Unique on `(booking_id, purpose)` — single active token per purpose. |

**Not created:** `deposits`, `coi_documents`, `claims` (v1.0).

**Driver change:** `lib/db.ts` moves from `drizzle-orm/neon-http` to `drizzle-orm/neon-serverless` with a websocket `Pool` (same `@neondatabase/serverless` package) so `db.transaction()` works. `scripts/db-healthcheck.ts` updated to `pool.end()` so it exits.

## 4. State machine (`lib/domain/states.ts`)

Nine states, same names as the v1.0 enum (strict subset):

```
pending → declined | awaiting_contract
awaiting_contract → awaiting_signature
awaiting_signature → confirmed
confirmed → event_day            (clock)
event_day → post_event           (clock)
post_event → closed
pending | awaiting_contract | awaiting_signature | confirmed → canceled (owner-only)
declined, closed, canceled: terminal
```

Exported as a `BOOKING_STATES` const array, a `BookingState` type, and a `LEGAL_TRANSITIONS: Record<BookingState, readonly BookingState[]>` data table. The table is the single source of truth; tests iterate it.

## 5. Transition module (`lib/domain/transitions.ts`)

```ts
transitionBooking(db, bookingId, to, actor: { type: "owner"|"renter"|"system"; id?: string },
                  opts?: { meta?: Record<string, unknown>; expectedFrom?: BookingState }): Promise<Booking>
```

In one `db.transaction()`:
1. Read the booking's current state (`from`) — or use `opts.expectedFrom` when the caller already knows it (the future clock-cron's case; also makes the CAS branch deterministically testable). Missing booking → `BookingNotFoundError`.
2. `to ∉ LEGAL_TRANSITIONS[from]` → `IllegalTransitionError` (carries from/to).
3. Compare-and-swap: `UPDATE bookings SET state = to WHERE id = ? AND state = from`. Zero rows → `ConcurrentTransitionError` (another transition won the race).
4. Append the `booking_events` row (from, to, actor_type, actor_id, metadata).
5. After the transaction commits, invoke side-effect hooks from a registry keyed by the `to` state — **all no-op stubs in this phase**; later phases register email sends etc. Hooks run *after* commit deliberately: a failed side effect (e.g. email) must not roll back a legal transition; hook errors are logged, never thrown to the caller.

**Cross-cutting rule enforced from here on:** no code path outside `transitionBooking` ever writes `bookings.state`.

## 6. Effective-state derivation (`lib/domain/effective-state.ts`)

Pure function `deriveEffectiveState(booking, now): BookingState` — `confirmed` reads as `event_day` once `now >= starts_at`; `event_day` reads as `post_event` once `now > ends_at`; everything else passes through. Read-time only; persisting clock transitions (cron/reminder) is a later phase. This keeps the UI truthful between cron runs, per ARCHITECTURE §3.

## 7. Renter tokens (`lib/tokens.ts`)

- `mintRenterToken(db, bookingId, purpose, expiresAt): Promise<string>` — 32 random bytes → base64url raw token returned to the caller (for email links); only the SHA-256 hex hash is stored. Minting for an existing `(booking_id, purpose)` deletes the prior row first (rotation: re-sending an email invalidates the old link).
- `verifyRenterToken(db, rawToken, purpose): Promise<string | null>` — hash, look up by `(token_hash, purpose)`, require `expires_at > now`; returns `booking_id` or `null`.
- Only `purpose = "status"` is used in v0.5 (minted at booking creation, Phase 4); the utility is purpose-generic since the column and API cost nothing extra.

## 8. Seed script (`scripts/seed.ts`, `npm run db:seed`)

Idempotent (delete + recreate demo studio by slug). Creates:
- **Westview Studio** (`slug: westview`) matching the prototype: hourly rate, 4-hr minimum, **$400 deposit**, house-rule fields, 2 spaces, the prototype's 6 default checklist areas.
- **10 bookings covering all 9 states**, remapping prototype personas whose v1.0 states don't exist in v0.5: Maya→`pending`, Tasha (was `coi_review`)→`awaiting_contract`, Kelvin (was `contract`)→`awaiting_signature`, Dana (was `upcoming`)→`confirmed`, Lena (was `deposit`)→`confirmed`, Jordan (was `today`)→`event_day`, Andre (was `claim_window`)→`post_event`, Simone→`closed`, plus two new personas for `declined` and `canceled`.
- Each booking gets a **plausible `booking_events` history** from `pending` to its current state (written via `transitionBooking` so the seed itself exercises the machine), realistic dates relative to the seed run, and snapshot fields populated.

## 9. Testing (PGlite)

- Test helper `lib/domain/test-db.ts` creates an in-memory PGlite database per suite and **applies the actual generated SQL migrations from `drizzle/`** — tests exercise the real schema, not a parallel definition.
- **Transition matrix:** iterate all 9×9 (from, to) pairs from `LEGAL_TRANSITIONS`. Legal → succeeds, state updated, exactly one audit row with correct from/to/actor. Illegal → `IllegalTransitionError`, state unchanged, no audit row.
- **Concurrency:** two transitions racing from the same state → one succeeds, one throws `ConcurrentTransitionError`, exactly one audit row. (PGlite is single-connection; the race is simulated by interleaving, or the CAS path is unit-tested by pre-flipping state between read and update.)
- **Tokens:** mint→verify roundtrip; wrong purpose → null; expired → null; re-mint rotates (old raw token now fails).
- **Derivation:** boundary conditions at `starts_at` and `ends_at`.
- **Audit append-only:** no exported function updates or deletes `booking_events` (asserted by module API surface, not runtime).
- CI unchanged — PGlite needs no secrets. Existing 15 tests keep passing.

## 10. Error handling

Typed error classes exported from `lib/domain/transitions.ts`: `BookingNotFoundError`, `IllegalTransitionError`, `ConcurrentTransitionError` — later phases map them to HTTP responses / UI messages. Token verification returns `null` rather than throwing (absence is a normal outcome for expired links).

## 11. Explicitly out of scope

Any UI or routes · cron/persisted clock transitions · email side effects (hook stubs only) · availability/buffer writing logic (Phase 4) · walkthrough/photo logic (Phase 7) · contract generation (Phase 6) · `deposits`/`coi_documents`/`claims` tables (v1.0).

## 12. Exit criteria (from the v0.5 spec §5 Phase 2)

- `npm test` covers the full transition matrix (legal + illegal), tokens, and derivation — green in CI with no secrets.
- `npm run db:seed` against the dev Neon DB yields a browsable studio + 10 bookings across all 9 states with audit histories.
- Migration applies cleanly (`npm run db:migrate`); `db:healthcheck` works on the new driver.
- No code path outside `transitionBooking` writes `bookings.state`; `booking_events` has no update/delete path.
- Phases 0–1 behavior unchanged (landing, waitlist, auth all still work; existing tests pass).
