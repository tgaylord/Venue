# VenueDash Phase 1 — Landing + Disclaimer/ToS — Design

Status: **Approved for planning** · Date: 2026-07-05
Parent spec: [`2026-07-05-venuedash-v0.5-design.md`](./2026-07-05-venuedash-v0.5-design.md) (§5 Phase 1)
Visual spec of record: `prototype/VenueDash_Prototype.dc.html` (the Landing surface)

> **One line:** *An outreach-ready marketing landing page with a waitlist CTA, plus drafted ToS/privacy pages — all copy rewritten to what v0.5 actually delivers.*

---

## 1. Goal & context

Phase 0 (foundation) is merged: Next.js 16 skeleton, Clerk, Drizzle/Neon (schema empty), R2, Resend, CI, Vercel. Phase 1 was deliberately re-sequenced early so founder outreach to Atlanta studio owners can begin while the rest of v0.5 is built.

Deliverable: the `(marketing)` route group becomes a real landing page ported from the prototype, with a **mailing-list (waitlist) CTA** — per the v0.5 spec's resolved decision, the CTA collects emails until the onboarding wizard exists, then re-points to it.

## 2. Decisions made in brainstorming

| Decision | Choice |
|---|---|
| Waitlist storage | **Resend Audiences** via server action — no DB schema in this phase (tables arrive in Domain core) |
| Legal pages | **Drafted, real ToS + privacy** tailored to v0.5, visibly flagged as under review pending attorney sign-off |
| Copy | **Rewrite to v0.5 truth** — keep prototype structure/layout/voice; no claims about held deposits, auto-refunds, e-sign, or COI gates |
| Domain | **Vercel URL for now**; custom domain + Resend DNS verification deferred (so **no confirmation email** this phase) |
| Approach | **Faithful static port** (approach A) — 1:1 Tailwind port, one server action, static legal pages; no marketing component library, no MDX |

## 3. Routing & structure

```
app/(marketing)/
  layout.tsx            → switches to DARK surface (bg-owner-bg text-owner-text);
                          the prototype landing is dark — warm-light stays renter-only
  page.tsx              → landing (static server component) composing:
  _components/
    Header.tsx          → logo mark + "Join the waitlist" button
    Hero.tsx            → eyebrow, headline, subhead, CTAs
    ProblemCards.tsx    → 3 problem/solution cards
    HowItWorks.tsx      → 4-step "How a booking runs" rail
    PricingCta.tsx      → $60/mo flat + beta offer + waitlist CTA
    Footer.tsx          → disclaimer line + /terms + /privacy links + sign-off
    WaitlistForm.tsx    → the ONLY client component (email input + useActionState)
  actions.ts            → "use server" joinWaitlist action
  terms/page.tsx        → /terms   (static, narrow legal column)
  privacy/page.tsx      → /privacy (static, narrow legal column)
lib/waitlist.ts         → addWaitlistContact(email) via Resend Contacts API
lib/waitlist.test.ts    → unit tests (Resend mocked)
.env.example            → + RESEND_AUDIENCE_ID
```

Untouched: `(public)` and `(owner)` groups, `proxy.ts`, `db/schema.ts` (stays empty), `prototype/`. The landing and legal pages must build as **static** routes.

## 4. Copy plan (v0.5-truthful rewrite)

Port the prototype's sections, layout, and voice; rewrite any claim v0.5 can't back. Language discipline applies: "timestamped documentation," never "immutable evidence/proof."

- **Hero** — headline kept: *"Rent your studio for events without betting it on a handshake."* Subhead drops "damage deposits with real release rules": *"Signed contracts and timestamped condition photos — the paperwork side of event rentals, handled in one place."* The prototype's button pair ("Get started free" / "See the dashboard") is replaced by the inline **waitlist form** (see §5 Placement). Eyebrow ("For Atlanta studio owners…") and the "Atlanta-owned · HBCU-founded · First 60 days free" line are kept.
- **Problem cards** (structure kept, solutions rewritten):
  1. *"We agreed over DM"* → solution: every booking generates a Georgia venue agreement, signed before anyone gets a key. (No "auto…e-signed" claim — signing is manual in v0.5.)
  2. *Camera-roll "evidence"* → solution kept: guided pre/post walkthrough; every photo server-timestamped, geotagged, and locked.
  3. *Deposits over Zelle* → rewritten: your deposit terms printed in the contract and the deposit's status tracked on every booking — you collect it the way you already do. (No card capture, holds, or auto-refund claims.)
- **How a booking runs** — 01 Renter requests (from your public booking link; approve/decline in a tap) · 02 Contract signed (GA agreement generated per booking; you send it for signature) · 03 Photo walkthrough (before and after, locked when you finish) · 04 Close-out (locked record + deposit status on file).
- **Pricing** — kept: *"$60/month. Flat."*, "Cheaper than one undocumented damage dispute," first 60 days free for the first 10 Atlanta studios, no card required. CTA joins the waitlist.
- **Footer** — "VenueDash is not a law firm and its templates are not legal advice" disclaimer, links to `/terms` and `/privacy`, `VENUEDASH · MADE IN ATLANTA, GA` sign-off.

## 5. Waitlist flow

- `WaitlistForm` (client): email input + submit button, `useActionState` for pending/success/error. Hidden **honeypot** field for cheap bot protection.
- **Placement:** the form renders twice — inline in the Hero (replacing the prototype's button pair) and in the PricingCta section (replacing its "Get started free" button). The Header's "Join the waitlist" button anchors to the hero form. Both instances submit the same server action.
- Server action `joinWaitlist`:
  1. Honeypot filled → return success without calling Resend (silent drop).
  2. Validate email with a simple format check (no new dependencies).
  3. Call `addWaitlistContact(email)` (`lib/waitlist.ts`) → Resend SDK Contacts API, `audienceId` from `RESEND_AUDIENCE_ID`.
  4. **Duplicate contact → success** (idempotent; "You're on the list" either way).
  5. API/env failure → log server-side; return a friendly error with a `mailto:` fallback.
- **No confirmation email this phase** — no verified sending domain yet (Resend restricts unverified senders to the account owner's address). Signups simply land in the Audience.
- Console step (not code): create the Resend Audience; put its ID in `.env.local` and Vercel env vars.

## 6. Legal pages

- **/terms** covers what v0.5 actually is: contract *templates* provided as-is (not legal advice; no attorney-client relationship), photo/document storage, **no payment processing and no held funds** (owner handles all money), account/beta terms, as-is warranty + liability limits, Georgia governing law.
- **/privacy** covers: waitlist email collection (Resend), owner account data (Clerk), booking/renter data and condition photos (Neon/R2) as they come online, no sale of data, contact for deletion requests.
- Both pages show a visible "Beta terms — under legal review" note and a last-updated date. The attorney-review requirement from the v0.5 spec §7 stays on the launch critical path; these pages are drafted now for outreach credibility, not as a substitute.

## 7. Error handling & testing

- **Unit tests** (Vitest, mocked Resend): valid/invalid email handling; `addWaitlistContact` calls the Contacts API with the right audience + email; duplicate maps to success; honeypot short-circuits without an API call.
- **CI** unchanged (lint / typecheck / test / build) and must stay green; landing + legal pages compile as static routes.
- **Manual verification:** side-by-side visual check against the prototype landing; a real submit on the Vercel preview lands a contact in the Resend Audience; `/terms` and `/privacy` render; `/dashboard` auth gating unaffected.
- Ships as **one PR** with a preview deploy exercised before merge (per-phase PR discipline).

## 8. Explicitly out of scope

Custom domain + Resend domain verification (and therefore confirmation emails) · any DB schema · wizard CTA re-pointing (happens when the wizard ships) · roadmap/"coming soon" sections · blog or additional marketing pages · analytics tooling.

## 9. Exit criteria

- The deployed landing visually matches the prototype's landing surface with v0.5-truthful copy.
- Submitting the waitlist form adds a contact to the Resend Audience; duplicates and failures behave as specified.
- `/terms` and `/privacy` are live, linked from the footer, and flagged as under review.
- CI green; unit tests for the waitlist path pass; `prototype/` untouched.
