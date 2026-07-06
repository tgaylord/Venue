# VenueDash Phase 3 — Onboarding Wizard — Design

Status: **Approved for planning** · Date: 2026-07-05
Parent spec: [`2026-07-05-venuedash-v0.5-design.md`](./2026-07-05-venuedash-v0.5-design.md) (§5 Phase 3)
Reference: [`../v1.0-vision/IMPLEMENTATION_PLAN.md`](../v1.0-vision/IMPLEMENTATION_PLAN.md) Phase 2 (wizard details) · Visual spec: `prototype/VenueDash_Prototype.dc.html` (Onboarding Wizard screens, ~lines 594–720)

> **One line:** *A studio owner signs up, walks a 5-step wizard, and comes out with a configured studio, a live `/book/[slug]` link, and a dashboard that tells them to share it.*

---

## 1. Goal & context

Phases 0–2 are merged (foundation, landing + waitlist, domain core with full schema + seeded state machine). Phase 3 is the first owner-facing feature: the onboarding wizard that populates `studios`, `spaces`, and `checklist_items`, doubling permanently as the "Settings & policies" page. Exit per the v0.5 spec: completing the wizard yields a working (if minimal) `/book/[slug]` target and a dashboard in its empty state.

## 2. Decisions made in brainstorming

| Decision | Choice |
|---|---|
| Contract step (step 4) | **Clause-summary card only**, computed from live answers + legal disclaimer. No full-text preview (Phase 6), no COI toggle (hidden in v0.5), no 48-hour-claim-window line (v1.0). |
| DB lifecycle | **Keep the lazy `getDb()` singleton.** Neon Pool re-checkout recovers thawed-context sockets; acceptable at beta volume. Revisit only if connection errors appear in logs. |
| Landing CTA re-point | **Yes:** header + hero CTAs become "Get started free" → `/sign-up`; waitlist form remains only in the pricing section as secondary capture. |
| Architecture | **Server-first wizard with client islands** (approach A): per-step server actions, URL-addressed steps, minimal client JS. |
| Validation | Hand-rolled per-action (no new dependencies), same style as the waitlist action. |

## 3. Routes, gating, data flow

- **`/settings`** (new page in `app/(owner)/settings/`): 5-step wizard; active step from `?step=1..5` (default 1, clamped); progress dots per prototype. Revisitable forever — the wizard *is* the Settings page.
- **`proxy.ts` matcher broadens** to protect `/settings(.*)` alongside `/dashboard(.*)` (closes the Phase 0 review note about future owner routes shipping unprotected).
- **One studio per owner:** each server action calls Clerk's `auth()` and resolves the studio by `clerk_user_id` (already unique in the schema). Step 1's action creates the row (and seeds defaults); steps 2–5 update it. Visiting steps 2–5 with no studio redirects to step 1.
- **Server actions** in `app/(owner)/settings/actions.ts`, one per step, each: validate → persist → return `{ status, message, fieldErrors? }` for `useActionState`. Dynamic lists serialize as indexed FormData fields (`spaces[0][name]`, …).
- **Persistence functions** (the testable core) live in `lib/studio.ts` and take the `Db` handle as their first parameter (same DI pattern as `transitionBooking`), so PGlite tests cover them without mocking.
- **Client islands only:** `PillSelect` (policies), `SpacesEditor`, `ChecklistEditor`. Everything else server-rendered.

## 4. The five steps (prototype-faithful, v0.5-truthful)

| Step | Title | Fields → storage |
|---|---|---|
| 1 | Your studio | `name` (required), `address`, `equipment_list` → `studios`; spaces list (name + max_occupancy) → `spaces` (replace-all on save) |
| 2 | House rules | `alcohol_policy` ∈ `byob_with_acknowledgment` \| `prohibited` \| `licensed_bartender_only`; `vendor_policy` ∈ `pre_approval` \| `allowed`; `noise_curfew` (text, e.g. "10:00 PM"); `cleanup_window_min` (integer minutes). § 74-133 helper text kept. |
| 3 | Pricing & deposit | `hourly_rate_cents`, `min_hours`, `deposit_cents` (dollar inputs parsed to cents); standard cancellation-ladder card (read-only; the standard ladder jsonb `{ full: 30, half: 14, none: 0 }` is stored at creation). **Copy rewrite:** prototype's "VenueDash only processes the deposit" → "The deposit is a term in your contract — you collect and return it the way you already do." |
| 4 | Your contract | Read-only clause-summary card computed from the studio's current values: equipment hands-off (their list), max occupancy (largest space cap), alcohol policy, curfew + Atlanta Code § 74-133, deposit amount as a contract term, cancellation ladder, Georgia jurisdiction. Legal disclaimer displayed (hard constraint). No COI toggle; no full-text link; no claim-window line. |
| 5 | Photo checklist | `checklist_items` editor (reorder implicit via list order; add/edit/remove; 1–20 items). Six defaults seeded at studio creation (Cyc wall, Floors, Lighting equipment, Furniture & props, Bathroom, Entryway & door — matching the Phase 2 seed). "You're live" card: `/book/[slug]` + copy button. First save sets `onboarding_completed_at`. |

## 5. Slug & completion semantics

- Slug generated **once at studio creation**: slugified name, uniqueness via numeric suffix (`westview`, `westview-2`, …). **Immutable thereafter** — booking links must never break; renames don't re-slug.
- `onboarding_completed_at` set on first step-5 save; never cleared or reset by later edits.

## 6. Dashboard empty state + landing CTA re-point

- `/dashboard`: no studio → `redirect("/settings")`. Studio exists → empty-state card per the spec/brief: "Share your booking link" with the `/book/[slug]` URL, copy button, and a muted note that requests will appear here (real dashboard is Phase 5; seeded dev bookings are deliberately not rendered in this phase).
- Landing `(marketing)`: Header CTA and Hero primary become **"Get started free" → `/sign-up`** (button pair restored to the prototype's shape); the waitlist form moves out of the hero and remains only in `PricingCta` with secondary copy ("Not ready yet? Join the list and we'll check in."). Footer/terms unchanged.

## 7. Validation & errors

- Step 1: `name` required nonempty; spaces: nonempty name required for each row, cap optional positive integer.
- Step 2: enum membership enforced server-side; curfew free text (≤ 40 chars); cleanup window positive integer ≤ 720.
- Step 3: money inputs accept `$165`, `165`, `165.00` → cents; positive integers; min_hours 1–24.
- Step 5: 1–20 items, each name nonempty (≤ 60 chars), hint optional (≤ 120 chars).
- All errors flow back through the action's form-state (`fieldErrors` keyed by field); nothing user-facing throws. Unauthenticated action calls redirect to sign-in (Clerk default).

## 8. Testing

- **PGlite unit tests** for `lib/studio.ts`: creation seeds slug/ladder/checklist defaults; slug collision → `-2` suffix; per-step updates persist independently (saving step 2 doesn't clobber step 1 fields); enum rejection; money parsing (`"$165"` → 16500, `"abc"` → error); spaces/checklist replace-all preserves order; completion timestamp set once, not reset by later saves.
- Money parser as a pure exported function with its own tests.
- Existing 119 tests keep passing; CI needs no secrets.
- **Manual verification on preview:** full wizard walk; `/settings` and `/dashboard` gated signed-out; no-studio redirect; landing CTA flow into sign-up → wizard; copy button works.
- One PR on `feat/phase-3-onboarding-wizard`.

## 9. Explicitly out of scope

The `/book/[slug]` page itself (Phase 4 — the link card just shows the URL) · contract full text/PDF (Phase 6) · COI anything (v1.0) · availability/manual blocks · photo uploads for the booking page · dashboard booking list (Phase 5) · studio photo uploads · multi-studio accounts (v1.0 boundary).

## 10. Exit criteria (v0.5 spec §5 Phase 3 + v1.0 plan Phase 2 exit)

- A new owner signing up walks steps 1–5 and ends with: a `studios` row with all wizard fields, spaces, 6+ checklist items, a unique immutable slug, and `onboarding_completed_at` set.
- The wizard is revisitable as Settings with values pre-filled; each step saves independently.
- `/dashboard` shows the share-your-link empty state (or redirects to the wizard when no studio exists).
- Landing CTAs point to `/sign-up`; waitlist capture still available in the pricing section.
- CI green; new PGlite tests pass with no secrets; protected paths (`prototype/`, `(public)`) untouched.
