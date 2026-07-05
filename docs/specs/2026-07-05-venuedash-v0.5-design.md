# VenueDash v0.5 — Design

Status: **Approved for build** · Date: 2026-07-05
Supersedes (for the first release only): the full-scope plan in [`../v1.0-vision/`](../v1.0-vision/README.md)

> **One line:** *Signed contract + tamper-evident condition record. The studio owner handles the money.*

---

## 1. Why v0.5 exists

The full-scope plan ([`v1.0-vision/ARCHITECTURE.md`](../v1.0-vision/ARCHITECTURE.md), [`IMPLEMENTATION_PLAN.md`](../v1.0-vision/IMPLEMENTATION_PLAN.md)) is well-architected but mis-sequenced for the founder's #1 constraint: **solo student, get to first paying customer fast.**

A four-lens pressure-test (technical soundness, sequencing, legal/compliance, solo-founder ops) converged — independently — on one conclusion: the deposit-escrow layer (VenueDash charging a deposit into its own balance, holding it, then deciding who gets it) is the wrong thing to build first. It is:

- **The highest legal exposure.** Holding and adjudicating third-party funds is textbook escrow / money transmission — likely a Stripe Connect ToS violation ("you may not use Stripe to hold funds on behalf of third parties") *and* potentially unlicensed money transmission under Georgia law / FinCEN, which is a criminal exposure an LLC does not shield.
- **The heaviest ongoing operational burden.** It makes the founder the permanent on-call payments desk, insurance reviewer, and **sole binding arbiter of "did $400 of damage happen"** on a 72-hour clock — unsustainable for a student with classes.
- **The slowest to build** (Stripe Connect Express + transfers/splits + webhook idempotency, plus the claim-settlement plumbing — the two hardest phases in the original plan).
- **The least differentiated.** A studio owner who already collects rent off-platform can collect a deposit off-platform too.

**Deferring the money layer removes or de-fangs four of the top five legal risks and the two hardest build phases.** What remains is what a studio owner actually can't replicate in a text thread, and what the product's own tagline promises: **paperwork infrastructure** — a proper Georgia contract and a locked, timestamped condition-photo record.

## 2. What v0.5 delivers (scope IN)

| Capability | Notes |
|---|---|
| **Onboarding wizard** | Studio profile, spaces (+ occupancy caps), house rules, pricing, **deposit amount as a contract term (a number that prints — not a charge)**, photo-checklist config. Produces a live `/book/[slug]`. Revisitable as Settings. |
| **Landing + disclaimer/ToS** | Iterated from the existing HTML mock into the `(marketing)` route group. Standalone; built **early** so founder outreach can begin during the build. Legal disclaimers + ToS/privacy placed here. |
| **Public booking page + intake** | Renter, **no account**. Mobile-first, warm-light theme. Creates a `pending` request, snapshots terms, emails owner + tokenized status link to renter. |
| **Owner dashboard + booking detail** | State-derived sections. Two **manual toggles**: *deposit collected / returned* and *contract signed*. |
| **Contract generation** | Standard GA template as a typed template function → rendered PDF with "in plain English" summaries + disclaimer. **Signing is manual** in v0.5 (owner marks signed); no e-sign integration. |
| **Photo checklist PWA — the differentiator** | In-app `getUserMedia` capture **with a mobile capture-file fallback**; per-photo **server timestamp + geotag + SHA-256 content hash**; immediate per-capture R2 write; pre + post walkthroughs; **lock/immutability** step. |
| **Ship** | Hand-invoice customer #1 (60-day free beta ⇒ no billing code needed yet). |

### Deposit handling (the core risk decision)
**VenueDash never touches deposit money in v0.5.** The contract states the deposit amount; the owner collects and refunds it themselves (their own Stripe, Zelle, cash, etc.). VenueDash records only a status: `deposit_status ∈ {uncollected, collected, returned}` with a timestamp, owner-toggled. This is what removes the money-transmission / escrow-ToS exposure entirely.

### Contract signing
VenueDash generates the correct GA contract **PDF**; signing happens via a manual/free e-sign tool or typed acknowledgment; the owner marks the booking signed (`contract_signed_at`). This removes the DocuSign integration (a ~3-week build) and the sandbox-validity problem from the critical path. Automated e-sign returns in v1.0.

### Camera / chain of custody
Live in-app capture stays **primary**; a mobile `capture` file-input is a **fallback** when `getUserMedia` is blocked (email-opened webviews, older iOS). Either path still yields a fresh photo + server timestamp + geotag + hash. Copy says **"timestamped documentation,"** never "immutable evidence" — the hash provides genuine tamper-evidence without over-promising a courtroom standard. The `deposit_protected` flag and the skip-warning are retained; without escrow the flag now means "no defensible record exists," not "no frozen refund."

## 3. What v0.5 defers to v1.0 (scope OUT)

Preserved in [`../v1.0-vision/`](../v1.0-vision/README.md), added back only once a paying customer validates demand:

- **Stripe Connect, deposit charge/capture, refund cron, held/split/transfer** — the entire money layer.
- **In-app claim/dispute flow + founder-as-arbiter** — the locked photos + signed contract *are* the owner's evidence; they enforce off-platform.
- **COI collection** — `coi_required` defaults false, path hidden. Returns as "collect & pass to owner" (never "verify/approve").
- **Automated e-sign** (DocuSign/Dropbox Sign), **Recurring-Client** template, renter acknowledgment token, offline service-worker shell, referral hook, day-60 subscription billing automation.

## 4. Architecture (deltas from the full-scope doc)

The system shape is unchanged — a single Next.js (App Router) app on Vercel, route groups `(marketing)` / `(public)` / `(owner)`, Clerk for owner auth, Drizzle + Neon Postgres, Cloudflare R2 for photos, Resend for email. v0.5 changes:

- **Drop from the stack for now:** Stripe (all), DocuSign. **Keep:** Clerk, Neon/Drizzle, R2, Resend.
- **Trimmed state machine** — a strict subset of the full enum, **same state names** so v1.0 extends rather than renames:
  ```
  pending
    → declined                 (owner declines; terminal)
    → awaiting_contract        (owner approves)
  awaiting_contract
    → awaiting_signature        (contract PDF generated + sent)
  awaiting_signature
    → confirmed                 (owner marks contract signed)
  confirmed
    → event_day                 (clock: event date reached — checklist due)
  event_day
    → post_event                (clock: event end passed — post-walkthrough due)
  post_event
    → closed                    (owner closes out; or auto after post-walkthrough lock)
  canceled                      (owner-only manual action from any pre-event state)
  ```
  Dropped for v0.5: `awaiting_coi`, `coi_review`, `awaiting_deposit`, `claim_window`, `claim_filed`, `claim_resolved`. The transition module (`transitionBooking`) and the **append-only `booking_events` audit log** are kept — cheap, and the audit trail is worth having from day one.
- **Data-model deltas:** `bookings` gains `deposit_status` + `deposit_status_at` and `contract_signed_at` (manual toggles). The `deposits`, `coi_documents`, and `claims` tables are **not created** in v0.5. `walkthrough_photos` gains a `sha256` column. Snapshot discipline (rate/deposit/policies copied onto the booking at request time) is retained.
- **No Stripe cron.** `event_day` derivation (for the checklist reminder) is kept; the `claim_window`/auto-refund sweep is removed.
- **Contract templates:** Standard Event Rental only. Interpolation is strictly mechanical (names/dates/amounts) — no clause *selection* by legal reasoning.

## 5. Re-sequenced build phases

Landing moved early (per founder request) so studio-owner outreach can start during the build; the full paperwork flow is walkable before the heavy photo-checklist build.

| # | Phase | Goal / notes |
|---|---|---|
| 0 | **Foundation** | Next.js + TS + Tailwind (port design tokens); Clerk middleware on `(owner)`; Drizzle + Neon; R2 + Resend clients; `.env.example`; CI (lint/typecheck/build) + Vercel previews. **No Stripe/DocuSign.** |
| 1 | **Landing + disclaimer/ToS** | Port & iterate the existing HTML mock into `(marketing)`. Standalone; CTA to a waitlist/email now, wired to the wizard later. Disclaimers + ToS/privacy placed. **Early — enables outreach.** |
| 2 | **Domain core** | Trimmed state machine + transition module + append-only audit log; renter-token utility (status link); seed script; full transition-matrix tests. |
| 3 | **Onboarding wizard** | 5-step wizard; deposit as contract term; checklist config; contract preview + disclaimer; slug + empty-dashboard state. |
| 4 | **Public booking page + intake** | `/book/[slug]`, availability picker, intake, review, submit → `pending`; owner email + renter status link. |
| 5 | **Owner dashboard + booking detail** | State-derived sections; lifecycle rail; approve/decline; **manual deposit-status & contract-signed toggles**; copy-booking-link. |
| 6 | **Contract generation** | Standard GA template → PDF with plain-English summaries; manual-sign flow; stored to R2, downloadable forever. **Lawyer-vetted template required before launch.** |
| 7 | **Photo checklist PWA** | The differentiator. Manifest/install; one-area-per-screen capture (getUserMedia + capture-file fallback); per-capture R2 upload with server timestamp + geotag + SHA-256; review → **lock** (immutable); pre + post; skip → `deposit_protected=false` + warning; 3h-before reminder email. |
| → | **Ship** | Onboard a studio, receive a real request, run it through a locked post-event walkthrough. Hand-invoice customer #1. |

## 6. Cross-cutting rules (unchanged from full-scope where applicable)

- **State discipline:** no direct writes to `bookings.state` outside `transitionBooking()`.
- **Evidence discipline:** no update/delete paths on locked walkthroughs or their photos, ever. Store a SHA-256 per photo.
- **Snapshot discipline:** terms (deposit amount, rate, policies) copied onto the booking at request time.
- **Prototype fidelity:** `prototype/VenueDash_Prototype.dc.html` is the visual spec; port screens, don't redesign.
- **Language discipline:** "timestamped documentation," never "immutable evidence"/"proof." COI (when it returns) is "collect & pass to owner," never "verify/approve."
- Each phase lands as its own PR with tests for its domain logic; preview deploy exercised before merge.

## 7. External dependency to resolve before launch

**A licensed Georgia attorney must review the contract template** — dram-shop language (O.C.G.A. § 51-1-40, which largely cannot be contracted away) and the Atlanta noise-ordinance citation (§ 74-133) especially. Disclaimers are one layer, not a shield, and the contract *is* the v0.5 product, so this is on the critical path. Keep interpolation mechanical; do not auto-select clauses by legal reasoning.

Also form an **LLC** and consider **tech E&O / general-liability insurance** before the first customer. (Neither shields the deferred money-transmission exposure — which is exactly why that layer stays deferred.)

## 8. Known technical risks carried into the build

From the pressure-test, to keep on the radar even in v0.5:

- **Camera in webviews:** reminders/links opened inside Gmail/iOS Mail in-app browsers may block `getUserMedia`; gate with an "open in the installed app / Safari" interstitial, and rely on the capture-file fallback otherwise. **Decide explicitly who performs the walkthrough (owner vs. renter)** — it changes the reliability profile. *(Assumed: the owner. Confirm during Phase 7.)*
- **Vercel free-tier cron** can't run sub-daily; the 3h-before reminder should use an external free scheduler (GitHub Actions / cron-job.org) hitting a protected route, or be accepted as best-effort at MVP volume.
- **R2 direct upload:** use presigned direct-to-R2 PUT (Vercel serverless caps request bodies at 4.5MB, below a modern phone JPEG); configure bucket CORS; compress client-side.
- **Resend deliverability:** verify the sending domain's DNS early — booking/contract links are business-critical transactional email.

## 9. Open items for the implementation plan

- Confirm walkthrough performer (owner assumed).
- Landing CTA target for the interim (waitlist form vs. mailto vs. early wizard link).
- Exact interim manual-signing mechanism (free e-sign tool vs. typed acknowledgment page).
