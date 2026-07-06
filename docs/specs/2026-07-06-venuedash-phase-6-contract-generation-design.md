# VenueDash Phase 6 — Contract Generation — Design

Status: **Approved for build (independent, superpowers)** · Date: 2026-07-06
Parent spec (source of truth): [`2026-07-05-venuedash-v0.5-design.md`](./2026-07-05-venuedash-v0.5-design.md) §2, §4, §5 (Phase 6), §7, §9
Predecessor: Phase 5 — Owner dashboard + booking detail (PR #13)

> **One line:** *The owner clicks "Generate & send contract" on an approved booking → a Standard Georgia Event-Rental PDF is rendered from the snapshotted terms, stored to R2, downloadable forever by owner and renter, and the booking advances `awaiting_contract → awaiting_signature`. Signing stays manual (a free e-sign tool); the owner marks it signed.*

---

## 1. Why this phase exists

The contract **is** the v0.5 product (v0.5 spec §1: "paperwork infrastructure — a proper Georgia contract and a locked, timestamped condition-photo record"). Phase 5 wired every state edge around it and deliberately left **one** open: `awaiting_contract → awaiting_signature`, rendered today as a muted *"contract generation — next phase"* placeholder with no forward button. Phase 6 fills exactly that middle. Everything downstream already works: `mark_signed` drives `awaiting_signature → confirmed` and stamps `contract_signed_at`.

Phase 6 is intentionally narrow. It does **not** add e-signature, deposit charging, or the photo checklist. It renders a mechanically-interpolated PDF, stores it, delivers it, and advances one state edge.

## 2. Scope

### In scope
| Capability | Notes |
|---|---|
| **Contract content model** | A pure typed template function `buildStandardContract(input) → ContractDoc`. Mechanical interpolation of names/dates/amounts only. Policy enums → clauses via a **fixed lookup table** — no clause *selection* by legal reasoning (v0.5 §7). |
| **PDF rendering** | Thin, swappable renderer (`@react-pdf/renderer`) turning `ContractDoc` → PDF `Buffer`. Plain-English per-section summaries + a prominent disclaimer. |
| **Storage** | Server-side `putObject` to the private R2 bucket at a deterministic key. New `contracts.pdf_r2_key` column + a UNIQUE index on `contracts.booking_id`. |
| **Generate action** | Owner action on an `awaiting_contract` booking: render → upload → upsert `contracts` row (`status=sent`) → `transitionBooking(awaiting_signature)` → best-effort renter email. Idempotent/self-healing. |
| **Downloads** | Owner: `GET /dashboard/bookings/[id]/contract` (Clerk + studio-scoped) → presigned R2 GET redirect. Renter: `GET /status/[token]/contract` (existing status token) → presigned redirect. |
| **UI** | Replace the Phase-5 placeholder: `awaiting_contract` → generate card; `awaiting_signature` → "contract sent, download + mark-signed" card; contract status tile reflects sent/signed. Renter status page gains a download link when a contract exists. |
| **Sign coherence** | On `mark_signed`, also flip the `contracts` row to `status=signed, signedAt` so the table stays honest. |
| **Renter email** | One new React Email: informational ("agreement ready; a separate signing request will follow"). |

### Out of scope (deferred)
- **Automated e-signature** (DocuSign/Dropbox Sign) — v1.0. Signing is manual via a free third-party tool (v0.5 §9).
- **Signed-PDF upload** — the owner does not upload the countersigned copy in v0.5. `contracts.signed_pdf_r2_key` stays null (column exists for v1.0).
- **Contract regeneration UI / versioning** — one contract per booking. A terms change post-approval is handled by cancel + rebook (rare; note as a limitation).
- **Owner-emailed PDF attachment** — the owner downloads in-app to feed their e-sign tool; no attachment needed.
- **Obtaining the actual attorney review** — a launch gate (v0.5 §7), not a build gate. The template ships behind a prominent "pending Georgia attorney review / not legal advice" disclaimer.

## 3. Architecture

Mirrors the established domain-layer discipline: a **pure, fully-tested core** with a **thin I/O shell**.

```
lib/contract/
  template.ts   buildStandardContract(input: ContractInput): ContractDoc   ── PURE, unit-tested
  input.ts      contractInputFromBooking(booking, studioIdentity): ContractInput
  pdf.tsx       renderContractPdf(doc: ContractDoc): Promise<Buffer>        ── thin react-pdf shell
  labels.ts     POLICY_CLAUSES / plain-English map (plain module — no "use server")
lib/storage.ts  + putObject(key, body, contentType)                          ── server-side R2 write
lib/contract.ts createContractRecord / getContractForBooking / markContractSigned  ── DB access (PGlite-tested)
```

### Data flow (generate)
```
owner clicks "Generate & send contract"  (awaiting_contract)
  → server action: ownerContext (Clerk auth + studio-scoped getBookingForOwner)
  → guard: stored state === awaiting_contract  (else "refresh and try again")
  → input     = contractInputFromBooking(booking, {studioName, studioAddress})   // terms from snapshot, identity live
  → doc       = buildStandardContract(input)                                       // pure
  → pdfBytes  = await renderContractPdf(doc)                                        // Buffer
  → putObject("contracts/{bookingId}/agreement.pdf", pdfBytes, "application/pdf")   // deterministic → idempotent
  → upsert contracts row (booking_id unique): template=standard, status=sent, pdf_r2_key, sent_at=now
  → transitionBooking(db, id, "awaiting_signature", {type:"owner", id:userId}, {meta:{contractId}})   // CAS = race guard
  → best-effort renter email (informational + status link)                         // never fails the transition
  → revalidatePath + stay on page
```

### Ordering & idempotency rationale
- **Render + upload happen before any DB write.** The R2 key is deterministic, so a retry overwrites rather than orphans.
- **`transitionBooking` is the single race/idempotency guard.** Its compare-and-swap makes a second concurrent generate fail cleanly; a double-click from `awaiting_signature` throws `IllegalTransitionError`, caught and surfaced as "already generated — refresh."
- **The contract row is upserted (unique `booking_id`).** If the transition fails after the row is written, the booking stays in `awaiting_contract` and the next click upserts + retries — self-healing. The UI gates the download on booking **state**, not contract-row existence, so a prepared-but-unadvanced row never misleads.
- **`bookings.state` is only ever written by `transitionBooking`** (v0.5 §6) — the contract row insert is a normal write in the action, not smuggled into the state machine.

### Snapshot discipline — identity vs. terms
The contract needs **legal terms** (rate, minimum, deposit amount, alcohol/vendor policy, noise curfew, cleanup window, occupancy, cancellation ladder) and **party identity** (studio legal name + address, renter name + contact, dates).

- **All legal terms are read from `booking.rateSnapshot` + booking columns** (`depositCents`, `startsAt/endsAt`, renter fields) — never re-joined from live `studios` (v0.5 §6). This is what guarantees the printed contract matches what the renter agreed to at request time.
- **Party identity (studio name/address) is read live from `studios`.** A studio's legal name/address is entity identity, not a negotiable term; reflecting a rename on a freshly-generated contract is correct, and contracts are generated close to approval. Documented as a known, acceptable boundary. (If v1.0 wants frozen identity, snapshot it at `createBooking` time.)

### Contract content (mechanical, lawyer-gated)
`ContractDoc` is an ordered list of sections `{ heading, body: string[], plainEnglish?: string }` plus a `disclaimer`. Sections (interpolated mechanically):

1. **Parties & premises** — studio name/address (live), renter name/contact.
2. **Term** — event date + start/end (Atlanta wall-clock via `lib/tz`), cleanup window.
3. **Fees** — hourly rate, minimum hours (from snapshot). *No total is computed as a legal figure beyond what was snapshotted.*
4. **Damage deposit** — the stated amount, **"collected and refunded by the studio directly; VenueDash does not hold deposit funds."** (v0.5 §2 — no held deposits.)
5. **Occupancy** — max-occupancy cap (from snapshot).
6. **Alcohol policy** — fixed clause selected by enum (`prohibited` / `byob_with_acknowledgment` / `licensed_bartender_only`) via `labels.ts`; includes a **dram-shop acknowledgment** worded per O.C.G.A. § 51-1-40 as an acknowledgment of the host's own liability, **not** a waiver (which largely cannot be contracted away — v0.5 §7).
7. **Outside vendors** — fixed clause by `vendorPolicy` enum.
8. **Noise & conduct** — noise curfew if set + reference to **Atlanta Code § 74-133**.
9. **Equipment** — hands-off clause (+ equipment list if provided).
10. **Cancellation** — the snapshotted cancellation ladder (full/half/none day thresholds).
11. **Liability & indemnification** — standard mutual clause; renter assumes responsibility for their guests.
12. **Governing law** — Georgia jurisdiction.
13. **Signatures** — owner + renter blocks (manual; "sign via the signing request you receive separately").

Each substantive section carries a one-line **"In plain English: …"** summary. A **disclaimer block** (prominent, first page): *"VenueDash is not a law firm and does not provide legal advice. This is a template pending review by a licensed Georgia attorney before launch; have your own attorney review anything you sign."* Copy discipline: **"timestamped documentation," never "immutable evidence"**; no held-deposit / COI / claim language.

Optional fields degrade gracefully: no address → omit the address line; no curfew → omit the curfew sentence but keep the § 74-133 reference; missing rate → "as agreed."

## 4. Data model delta

Migration `0003_*` (drizzle-generated):
- `contracts.pdf_r2_key text` — R2 key of the generated (unsigned) PDF. *(Existing `signed_pdf_r2_key` remains for the v1.0 countersigned copy.)*
- **UNIQUE index on `contracts.booking_id`** — enforces one contract per booking; enables `onConflictDoUpdate` upsert.

No other schema changes. `contract_status` enum (`sent|signed|voided`) and `contract_template` enum (`standard`) already exist.

Run `npm run db:generate` then `npm run db:migrate` (Neon `DATABASE_URL` in `.env.local` — same DB the deploy reads) before deploying code that reads `pdf_r2_key`.

## 5. Storage

`lib/storage.ts` gains:
```ts
export async function putObject(key: string, body: Buffer, contentType: string): Promise<void>
```
A plain server-side `PutObjectCommand` (no presign). The bucket stays **private**; both download routes presign short-lived GET URLs (`getSignedDownloadUrl`, existing). Key layout: `contracts/{bookingId}/agreement.pdf` — deterministic, so regeneration overwrites in place.

Runtime: `storage.ts` (aws-sdk) and react-pdf both run on the **Node runtime** — the generate action and both download routes stay off Edge (v0.5 architecture rule).

## 6. Downloads & delivery

- **Owner:** `GET /dashboard/bookings/[id]/contract` route handler — Clerk `auth()` → `getStudioByClerkUserId` → `getBookingForOwner` (studio-scoped; `notFound()` on a foreign id) → `getContractForBooking` → `getSignedDownloadUrl(pdf_r2_key)` → 302 redirect. Covered by the existing `proxy.ts` `/dashboard(.*)` matcher.
- **Renter:** `GET /status/[token]/contract` route handler — validate the existing `purpose="status"` token → resolve booking → contract → presign → 302 redirect. Reuses the durable status link minted at `createBooking`; no new token purpose. If the token is invalid/expired or no contract exists → 404.
- **Renter email** (`ContractReadyRenter`): sent best-effort from the generate action, worded informationally — the agreement is ready to review, a signing request will arrive separately, and a copy is viewable from their status page. Uses the `baseUrl()` helper (APP_URL or request host).

## 7. UI (owner detail + renter status)

**Owner booking detail** (`dashboard/bookings/[id]/page.tsx`) — replace the two Phase-5 placeholders:
- `awaiting_contract`: a **"Generate & send contract"** card — one line explaining what happens, the `generate_contract` action button, plus the existing cancel. On success the page revalidates into the next card.
- `awaiting_signature`: a **"Contract sent"** card — "Download the agreement, run it through your e-sign tool, then mark it signed once the renter signs." A **Download PDF** link (owner route) + the existing **Mark contract signed** action.
- Contract status tile (status grid): reflects real state — *Generated & sent* (with download) / *Signed {date}* — instead of "generated next release."

**Owner action wiring** (`lib/domain/booking-view.ts`):
- `OwnerAction` gains `"generate_contract"`.
- `TARGET_TO_ACTION[awaiting_signature] = "generate_contract"`.
- `ACTION_ORDER` includes it (before `mark_signed`).
- `ActionButtons` META: label **"Generate & send contract"**, accent styling, bound to the new `generateContract` action.

**Renter status page** (`status/[token]/page.tsx`): when the booking has a contract, show a **"Download rental agreement (PDF)"** button → `/status/[token]/contract`, with a one-line note that a signing request follows separately. Copy discipline maintained (no held-deposit language).

**Seed tolerance:** seeded `awaiting_signature`/`confirmed` bookings have **no** contract row. All UI gates the download on contract-row existence, so these render cleanly (no download link, no crash). No re-seed required.

## 8. Testing strategy

Following the phase's TDD discipline:
- **`template.test.ts` (pure):** interpolation of renter/studio names, dates (Atlanta), rate, deposit (shown as a term "collected by the studio"); policy enum → correct fixed clause; graceful degradation of optional fields (no address / no curfew); disclaimer always present; **no forbidden phrases** ("immutable evidence", held-deposit/escrow, "we hold"); dram-shop worded as acknowledgment, § 74-133 present.
- **`input.test.ts`:** `contractInputFromBooking` reads legal terms from `rateSnapshot`/booking columns, identity from the passed studio object; never reads live studio terms.
- **`pdf` smoke:** `renderContractPdf(doc)` returns a non-empty Buffer starting with `%PDF`; a text extraction asserts the renter name and deposit amount appear. (Guards the react-pdf boundary.)
- **`lib/contract.ts` (PGlite):** create/upsert contract row (unique `booking_id` upsert), `getContractForBooking`, `markContractSigned` flips status/signedAt.
- **Action test (PGlite):** `generateContract` advances `awaiting_contract → awaiting_signature`, writes a contract row, is idempotent on a second call, and rejects from a wrong state; `markSigned` additionally flips the contract row. (R2 `putObject` and PDF render are stubbed/injected or the action is factored so the storage+render calls are behind an interface, keeping the DB-transition logic unit-testable without R2 creds.)
- **Storage `putObject`:** thin; not unit-tested against R2 (no creds in CI). Verified on the **preview deploy** by rendering + downloading a real contract (the "render in verification, not curl" lesson).

**Factoring for testability:** the generate action's side effects (render, upload) are injected or isolated so the state-machine path is PGlite-testable. The pure `template.ts` carries the bulk of the assertions.

## 9. Risks & mitigations

- **react-pdf on Vercel Node/Next 16 bundling** (yoga-wasm + fontkit). *Mitigation:* **first plan task is a render-to-Buffer spike** deployed to preview and downloaded end-to-end. If it fails to build/run, swap the `pdf.tsx` shell to `pdfkit` (pure JS, standard fonts) — the pure content model insulates every other module. The renderer boundary is a single function.
- **Legal exposure of the template.** *Mitigation:* mechanical interpolation + fixed clause lookup (no legal reasoning); prominent "pending attorney review / not legal advice" disclaimer; dram-shop as acknowledgment not waiver. **Attorney review remains a launch gate (v0.5 §7)** — flagged in the ledger, not resolved by this build.
- **Orphaned R2 object on a failed transition.** *Mitigation:* deterministic key + upsert make it self-healing and bounded (one object per booking); no cleanup cron needed at MVP volume.
- **Large/slow render in a server action.** A few-page text PDF renders in well under a second and well under serverless body/time limits. Acceptable.
- **Renter download after token expiry** (120-day status token). Acceptable at MVP; re-mint path already exists. Route 404s gracefully.

## 10. Definition of done

- `awaiting_contract` booking → owner generates → PDF in R2, booking in `awaiting_signature`, owner + renter can download the same PDF; renter received the informational email.
- `mark_signed` still drives `awaiting_signature → confirmed`, stamps `contract_signed_at`, and now flips the contract row to `signed`.
- All new pure/DB logic unit- + PGlite-tested; `lint`/`typecheck`/`test`/`build` green in CI.
- The full flow **rendered and downloaded on the preview deploy** (authenticated owner walk), not just curl-checked.
- Lands as a single `feat/phase-6-*` PR; preview-deploy checks pass; **human UI review before merge to main.**
- Ledger (`.superpowers/sdd/progress.md`) updated; CLAUDE.md handoff updated for Phase 7.

## 11. Carry-forwards created by this phase

- **Signed-PDF upload** (`signed_pdf_r2_key`) — v1.0, when automated e-sign lands.
- **Contract regeneration/versioning** — deferred; terms change → cancel + rebook today.
- **Frozen studio identity on the snapshot** — if a rename-after-booking ever matters legally.
- **Attorney review of the template** — launch gate, still open (v0.5 §7).
- **R2 lifecycle/cleanup** for superseded contract objects — none needed at MVP volume.
