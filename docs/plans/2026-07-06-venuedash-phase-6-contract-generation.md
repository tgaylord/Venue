# Phase 6 — Contract Generation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an owner generate a Standard Georgia Event-Rental PDF from an approved booking's snapshotted terms, store it to R2, deliver it to owner + renter as presigned downloads, and advance the booking `awaiting_contract → awaiting_signature`. Signing stays manual.

**Architecture:** A pure, fully-tested contract core (`buildStandardContract` content model + fixed policy→clause lookup) sits behind a thin, swappable `@react-pdf/renderer` shell. A server action renders → uploads to R2 → upserts a `contracts` row → calls `transitionBooking` (whose CAS is the sole idempotency guard) → best-effort renter email. Owner and renter download via studio-scoped / token-scoped route handlers that presign R2 GETs. Legal terms come from `rateSnapshot`; party identity comes live from `studios`.

**Tech Stack:** Next.js 16 (App Router, Node runtime) · React 19 · `@react-pdf/renderer` (new) · Drizzle + Neon Postgres · Cloudflare R2 (aws-sdk S3) · Resend + React Email · Clerk 7 · Vitest + PGlite.

**Spec:** `docs/specs/2026-07-06-venuedash-phase-6-contract-generation-design.md`

## Global Constraints

- **Node 20** for all npm commands: `nvm use 20 && <cmd>` (engine-strict rejects 24).
- **Only `transitionBooking` writes `bookings.state`.** Contract-row writes are normal DB writes, never smuggled into the state machine.
- **Snapshot discipline:** all legal terms (rate, minHours, deposit, alcohol/vendor policy, curfew, cleanup, occupancy, cancellation ladder) read from `booking.rateSnapshot` + booking columns — **never** re-joined from live `studios`. Only party identity (studio name/address) is read live.
- **Node runtime only** — `lib/storage.ts` (aws-sdk) and react-pdf must never run on Edge. New route handlers stay on the default Node runtime.
- **Copy discipline:** "timestamped documentation," **never** "immutable evidence"/"proof." No held-deposit / escrow / "we hold" / COI / claim language. Deposit is "collected and refunded by the studio directly."
- **Legal discipline:** mechanical interpolation only; policy→clause is a fixed lookup, **no clause selection by legal reasoning**. Dram-shop (O.C.G.A. § 51-1-40) worded as acknowledgment, not waiver. Reference Atlanta Code § 74-133. Prominent "not legal advice / template pending Georgia attorney review" disclaimer.
- **Server-action rule:** a `"use server"` file may only export async functions. Constants/types/parsers live in plain modules (`forms.ts`, `lib/contract/*`).
- **`"use server"` owner actions** re-resolve studio from Clerk `userId` and re-fetch the booking studio-scoped (`getBookingForOwner`); the client-supplied `bookingId` is never trusted for authz. Actions `revalidatePath` + stay on the page (no `redirect`).
- **Tests run on PGlite** (`createTestDb()` applies the real generated migrations from `drizzle/`) — no secrets. CI runs lint/typecheck/test/build.
- **Commit after every green step.** Branch: `feat/phase-6-contract-generation` (already created; spec already committed there).

---

## File Structure

**Create:**
- `lib/contract/types.ts` — `ContractInput`, `ContractDoc`, `ContractSection`, `AlcoholPolicy`, `VendorPolicy` types. Pure, no deps.
- `lib/contract/labels.ts` — `ALCOHOL_CLAUSES`, `VENDOR_CLAUSES` fixed lookups (clause + plain-English). Plain module.
- `lib/contract/template.ts` — `buildStandardContract(input: ContractInput): ContractDoc`. Pure.
- `lib/contract/template.test.ts`
- `lib/contract/input.ts` — `contractInputFromBooking(booking, identity): ContractInput`. Pure.
- `lib/contract/input.test.ts`
- `lib/contract/pdf.tsx` — `renderContractPdf(doc: ContractDoc): Promise<Buffer>`. react-pdf shell.
- `lib/contract/pdf.test.ts` — smoke test.
- `lib/contract.ts` — DB access + orchestration: `upsertContract`, `getContractForBooking`, `markContractSigned`, `generateAndAdvance`. + `lib/contract.test.ts`.
- `emails/ContractReadyRenter.tsx` — React Email component.
- `app/(owner)/dashboard/bookings/[id]/contract/route.ts` — owner download route.
- `app/(public)/status/[token]/contract/route.ts` — renter download route.

**Modify:**
- `package.json` — add `@react-pdf/renderer`.
- `db/schema.ts` — `contracts.pdfR2Key` column + unique index on `contracts.bookingId`.
- `drizzle/0003_*.sql` (+ `meta`) — generated migration.
- `lib/storage.ts` — add `putObject`.
- `lib/email.ts` — add `renderContractReadyRenter`.
- `lib/domain/booking-view.ts` — add `generate_contract` OwnerAction. + `lib/domain/booking-view.test.ts`.
- `app/(owner)/dashboard/bookings/[id]/actions.ts` — `generateContract` action; `markSigned` also flips the contract row; `ownerContext` returns `studio`.
- `app/(owner)/dashboard/bookings/[id]/_components/ActionButtons.tsx` — `generate_contract` META entry.
- `app/(owner)/dashboard/bookings/[id]/page.tsx` — replace `awaiting_contract`/`awaiting_signature` placeholder cards; contract status tile.
- `app/(public)/status/[token]/page.tsx` — contract download link.

---

## Task 1: Schema — `pdf_r2_key` column + unique `booking_id` index + migration

**Files:**
- Modify: `db/schema.ts:160-172` (contracts table)
- Create: `drizzle/0003_*.sql` (drizzle-generated)
- Test: `lib/contract.test.ts` (created later verifies via real migration; this task verifies the migration applies)

**Interfaces:**
- Produces: `contracts.pdfR2Key` (nullable text), a unique index on `contracts.bookingId`.

- [ ] **Step 1: Add the column + unique index to the schema**

In `db/schema.ts`, update the `contracts` table. Add `pdfR2Key` after `signedPdfR2Key`, and add a unique index in the table's index array:

```ts
export const contracts = pgTable(
  "contracts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookingId: uuid("booking_id").notNull().references(() => bookings.id, { onDelete: "cascade" }),
    template: contractTemplateEnum("template").notNull().default("standard"),
    status: contractStatusEnum("status").notNull().default("sent"),
    pdfR2Key: text("pdf_r2_key"),
    signedPdfR2Key: text("signed_pdf_r2_key"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    signedAt: timestamp("signed_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("contracts_booking_id_unique").on(t.bookingId)]
);
```

Note the index changes from `index(...)` to `uniqueIndex(...)`; `uniqueIndex` is already imported at the top of the file.

- [ ] **Step 2: Generate the migration**

Run: `nvm use 20 && npm run db:generate`
Expected: a new `drizzle/0003_*.sql` is written adding `pdf_r2_key` and creating a unique index `contracts_booking_id_unique`. Open it and confirm it contains `ADD COLUMN "pdf_r2_key"` and `CREATE UNIQUE INDEX "contracts_booking_id_unique"`.

- [ ] **Step 3: Verify the migration applies against a fresh PGlite DB**

Run: `nvm use 20 && npx vitest run lib/domain/test-db.test.ts`
Expected: PASS — `createTestDb()` applies all migrations including `0003` without error. (This existing test just boots the migrated DB.)

- [ ] **Step 4: Commit**

```bash
git add db/schema.ts drizzle/
git commit -m "feat(db): contracts.pdf_r2_key + unique booking_id index (0003)"
```

*(Production/Neon `db:migrate` is deferred to Task 16, run before deploy.)*

---

## Task 2: Storage — server-side `putObject`

**Files:**
- Modify: `lib/storage.ts`

**Interfaces:**
- Produces: `putObject(key: string, body: Buffer, contentType: string): Promise<void>`

- [ ] **Step 1: Add `putObject` (no presign — direct server-side write)**

In `lib/storage.ts`, add after `getSignedDownloadUrl`. `PutObjectCommand` is already imported:

```ts
export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  await client().send(new PutObjectCommand({ Bucket: bucket(), Key: key, Body: body, ContentType: contentType }));
}
```

- [ ] **Step 2: Typecheck**

Run: `nvm use 20 && npm run typecheck`
Expected: PASS (no errors). *(No unit test — R2 requires creds; verified end-to-end on the preview deploy in Task 16.)*

- [ ] **Step 3: Commit**

```bash
git add lib/storage.ts
git commit -m "feat(storage): server-side putObject for generated PDFs"
```

---

## Task 3: Contract types + fixed policy clauses

**Files:**
- Create: `lib/contract/types.ts`, `lib/contract/labels.ts`
- Test: `lib/contract/labels.test.ts`

**Interfaces:**
- Produces:
  - `type AlcoholPolicy = "prohibited" | "byob_with_acknowledgment" | "licensed_bartender_only"`
  - `type VendorPolicy = "in_house_only" | "approved_vendors" | "open"`
  - `type ContractSection = { heading: string; body: string[]; plainEnglish?: string }`
  - `type ContractDoc = { title: string; disclaimer: string; sections: ContractSection[] }`
  - `type ContractInput = { studioName: string; studioAddress: string | null; renterName: string; renterEmail: string; renterPhone: string | null; eventType: string | null; when: string; headcount: number | null; hourlyRateCents: number | null; minHours: number | null; depositCents: number | null; maxOccupancy: number | null; alcoholPolicy: string | null; vendorPolicy: string | null; noiseCurfew: string | null; cleanupWindowMin: number | null; cancellationLadder: { full: number; half: number; none: number } | null; equipmentList: string | null; byob: boolean; outsideVendors: boolean }`
  - `ALCOHOL_CLAUSES: Record<AlcoholPolicy, { clause: string; plainEnglish: string }>`
  - `VENDOR_CLAUSES: Record<VendorPolicy, { clause: string; plainEnglish: string }>`
  - `alcoholClause(policy: string | null): { clause: string; plainEnglish: string }` and `vendorClause(policy: string | null)` — safe lookups with a generic fallback for unknown/null enums.

- [ ] **Step 1: Write `lib/contract/types.ts`**

```ts
export type AlcoholPolicy = "prohibited" | "byob_with_acknowledgment" | "licensed_bartender_only";
export type VendorPolicy = "in_house_only" | "approved_vendors" | "open";

export type CancellationLadder = { full: number; half: number; none: number };

export type ContractInput = {
  studioName: string;
  studioAddress: string | null;
  renterName: string;
  renterEmail: string;
  renterPhone: string | null;
  eventType: string | null;
  when: string;
  headcount: number | null;
  hourlyRateCents: number | null;
  minHours: number | null;
  depositCents: number | null;
  maxOccupancy: number | null;
  alcoholPolicy: string | null;
  vendorPolicy: string | null;
  noiseCurfew: string | null;
  cleanupWindowMin: number | null;
  cancellationLadder: CancellationLadder | null;
  equipmentList: string | null;
  byob: boolean;
  outsideVendors: boolean;
};

export type ContractSection = { heading: string; body: string[]; plainEnglish?: string };
export type ContractDoc = { title: string; disclaimer: string; sections: ContractSection[] };
```

- [ ] **Step 2: Write the failing test for the clause lookups**

Create `lib/contract/labels.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { alcoholClause, vendorClause, ALCOHOL_CLAUSES } from "./labels";

describe("alcoholClause", () => {
  it("maps each known enum to its fixed clause", () => {
    expect(alcoholClause("prohibited").clause).toMatch(/no alcohol/i);
    expect(alcoholClause("byob_with_acknowledgment").clause).toMatch(/BYOB/i);
    expect(alcoholClause("licensed_bartender_only").clause).toMatch(/licensed/i);
  });
  it("every known clause carries a dram-shop acknowledgment (not a waiver)", () => {
    for (const v of Object.values(ALCOHOL_CLAUSES)) {
      expect(v.clause).toMatch(/§\s*51-1-40|dram/i);
      expect(v.clause).not.toMatch(/waive|waiver/i);
    }
  });
  it("falls back safely for null/unknown", () => {
    expect(alcoholClause(null).clause).toMatch(/alcohol/i);
    expect(alcoholClause("nonsense").clause).toMatch(/alcohol/i);
  });
});

describe("vendorClause", () => {
  it("maps known enums and falls back", () => {
    expect(vendorClause("in_house_only").clause).toMatch(/in-house/i);
    expect(vendorClause("open").clause).toMatch(/vendor/i);
    expect(vendorClause(null).clause).toMatch(/vendor/i);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `nvm use 20 && npx vitest run lib/contract/labels.test.ts`
Expected: FAIL — cannot resolve `./labels`.

- [ ] **Step 4: Write `lib/contract/labels.ts`**

```ts
import type { AlcoholPolicy, VendorPolicy } from "./types";

const DRAM_SHOP =
  " The renter and their guests acknowledge sole responsibility for the conduct and sobriety of all attendees, consistent with the duties Georgia law (O.C.G.A. § 51-1-40) places on any person who furnishes alcohol.";

export const ALCOHOL_CLAUSES: Record<AlcoholPolicy, { clause: string; plainEnglish: string }> = {
  prohibited: {
    clause: "No alcohol may be served or consumed on the premises during the rental period." + DRAM_SHOP,
    plainEnglish: "No alcohol at this event.",
  },
  byob_with_acknowledgment: {
    clause:
      "Alcohol is permitted on a bring-your-own-beverage (BYOB) basis. The renter is solely responsible for lawful, responsible service to guests of legal drinking age." +
      DRAM_SHOP,
    plainEnglish: "Guests may bring their own alcohol; you're responsible for how it's served.",
  },
  licensed_bartender_only: {
    clause:
      "Alcohol may be served only by a licensed and insured bartender arranged by the renter." +
      DRAM_SHOP,
    plainEnglish: "Alcohol only through a licensed bartender you arrange.",
  },
};

const ALCOHOL_FALLBACK = {
  clause: "The studio's stated alcohol policy applies for the rental period." + DRAM_SHOP,
  plainEnglish: "Follow the studio's alcohol policy.",
};

export const VENDOR_CLAUSES: Record<VendorPolicy, { clause: string; plainEnglish: string }> = {
  in_house_only: {
    clause: "Only the studio's in-house vendors and equipment may be used; outside vendors are not permitted.",
    plainEnglish: "In-house vendors only.",
  },
  approved_vendors: {
    clause: "Outside vendors are permitted only with the studio's prior written approval.",
    plainEnglish: "Outside vendors allowed with the studio's approval.",
  },
  open: {
    clause: "The renter may engage outside vendors of their choosing, who must comply with all house rules.",
    plainEnglish: "Bring any vendors you like; they follow house rules.",
  },
};

const VENDOR_FALLBACK = {
  clause: "The studio's stated vendor policy applies.",
  plainEnglish: "Follow the studio's vendor policy.",
};

export function alcoholClause(policy: string | null): { clause: string; plainEnglish: string } {
  return (policy && ALCOHOL_CLAUSES[policy as AlcoholPolicy]) || ALCOHOL_FALLBACK;
}
export function vendorClause(policy: string | null): { clause: string; plainEnglish: string } {
  return (policy && VENDOR_CLAUSES[policy as VendorPolicy]) || VENDOR_FALLBACK;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `nvm use 20 && npx vitest run lib/contract/labels.test.ts`
Expected: PASS (all cases).

- [ ] **Step 6: Commit**

```bash
git add lib/contract/types.ts lib/contract/labels.ts lib/contract/labels.test.ts
git commit -m "feat(contract): types + fixed policy→clause lookups"
```

---

## Task 4: Contract template — `buildStandardContract`

**Files:**
- Create: `lib/contract/template.ts`
- Test: `lib/contract/template.test.ts`

**Interfaces:**
- Consumes: `ContractInput`, `ContractDoc` from `./types`; `alcoholClause`, `vendorClause` from `./labels`; `formatCents` from `@/lib/money`.
- Produces: `buildStandardContract(input: ContractInput): ContractDoc`

- [ ] **Step 1: Write the failing test**

Create `lib/contract/template.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildStandardContract } from "./template";
import type { ContractInput } from "./types";

const base: ContractInput = {
  studioName: "Westview Studio",
  studioAddress: "123 Ralph David Abernathy Blvd, Atlanta, GA",
  renterName: "Dana Renter",
  renterEmail: "dana@example.com",
  renterPhone: "404-555-0100",
  eventType: "Photo shoot",
  when: "Sat, Aug 15, 2026 · 2:00–6:00 PM",
  headcount: 20,
  hourlyRateCents: 12000,
  minHours: 3,
  depositCents: 40000,
  maxOccupancy: 30,
  alcoholPolicy: "byob_with_acknowledgment",
  vendorPolicy: "approved_vendors",
  noiseCurfew: "10:00 PM",
  cleanupWindowMin: 30,
  cancellationLadder: { full: 30, half: 14, none: 0 },
  equipmentList: "Cyc wall, strobes",
  byob: true,
  outsideVendors: true,
};

function allText(doc: ReturnType<typeof buildStandardContract>): string {
  return [doc.title, doc.disclaimer, ...doc.sections.flatMap((s) => [s.heading, s.plainEnglish ?? "", ...s.body])].join("\n");
}

describe("buildStandardContract", () => {
  it("interpolates parties, dates, rate, and deposit as a printed term", () => {
    const doc = buildStandardContract(base);
    const text = allText(doc);
    expect(text).toContain("Westview Studio");
    expect(text).toContain("Dana Renter");
    expect(text).toContain("Sat, Aug 15, 2026 · 2:00–6:00 PM");
    expect(text).toContain("$120.00"); // hourly rate
    expect(text).toContain("$400.00"); // deposit
  });

  it("states the deposit is collected by the studio, never held by VenueDash", () => {
    const text = allText(buildStandardContract(base));
    expect(text).toMatch(/collected and refunded by the studio/i);
    expect(text).not.toMatch(/VenueDash (holds|will hold|escrow)/i);
  });

  it("selects the alcohol + vendor clauses by enum via the fixed lookup", () => {
    const text = allText(buildStandardContract(base));
    expect(text).toMatch(/BYOB/i);
    expect(text).toMatch(/prior written approval/i);
  });

  it("references Atlanta Code § 74-133 and the curfew when set", () => {
    const text = allText(buildStandardContract(base));
    expect(text).toContain("§ 74-133");
    expect(text).toContain("10:00 PM");
  });

  it("always includes the not-legal-advice / attorney-review disclaimer", () => {
    const doc = buildStandardContract(base);
    expect(doc.disclaimer).toMatch(/not a law firm/i);
    expect(doc.disclaimer).toMatch(/Georgia attorney/i);
  });

  it("never uses forbidden evidence/escrow language", () => {
    const text = allText(buildStandardContract(base));
    expect(text).not.toMatch(/immutable evidence|proof|we hold|hold funds|escrow/i);
  });

  it("degrades gracefully when optional fields are missing", () => {
    const doc = buildStandardContract({
      ...base, studioAddress: null, noiseCurfew: null, hourlyRateCents: null,
      cancellationLadder: null, equipmentList: null,
    });
    const text = allText(doc);
    expect(text).toContain("§ 74-133"); // kept even without a curfew
    expect(text).toMatch(/as agreed/i); // rate fallback
    expect(text).not.toContain("null");
    expect(text).not.toContain("undefined");
  });

  it("gives substantive sections a plain-English summary", () => {
    const doc = buildStandardContract(base);
    const deposit = doc.sections.find((s) => /deposit/i.test(s.heading));
    expect(deposit?.plainEnglish).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `nvm use 20 && npx vitest run lib/contract/template.test.ts`
Expected: FAIL — cannot resolve `./template`.

- [ ] **Step 3: Write `lib/contract/template.ts`**

```ts
import { formatCents } from "@/lib/money";
import { alcoholClause, vendorClause } from "./labels";
import type { ContractDoc, ContractInput, ContractSection } from "./types";

const DISCLAIMER =
  "VenueDash is not a law firm and does not provide legal advice. This is a template pending review by a licensed Georgia attorney before launch; have your own attorney review anything you sign.";

export function buildStandardContract(input: ContractInput): ContractDoc {
  const rate =
    input.hourlyRateCents != null ? `${formatCents(input.hourlyRateCents)} per hour` : "as agreed between the parties";
  const minimum = input.minHours != null ? `, with a ${input.minHours}-hour minimum` : "";
  const deposit = input.depositCents != null ? formatCents(input.depositCents) : "the amount agreed between the parties";
  const alcohol = alcoholClause(input.alcoholPolicy);
  const vendor = vendorClause(input.vendorPolicy);
  const ladder = input.cancellationLadder;

  const sections: ContractSection[] = [
    {
      heading: "1. Parties & Premises",
      body: [
        `This Event Rental Agreement is entered into between ${input.studioName} ("Studio")${
          input.studioAddress ? ` located at ${input.studioAddress}` : ""
        } and ${input.renterName} ("Renter", ${input.renterEmail}${
          input.renterPhone ? `, ${input.renterPhone}` : ""
        }).`,
      ],
    },
    {
      heading: "2. Event & Term",
      plainEnglish: "The space is reserved for your event window plus any cleanup time.",
      body: [
        `The Studio is rented for ${input.eventType ?? "the Renter's event"} on ${input.when}.`,
        input.cleanupWindowMin != null
          ? `A cleanup window of ${input.cleanupWindowMin} minutes is included at the end of the rental period.`
          : "The Renter shall leave the premises clean and undamaged at the end of the rental period.",
      ],
    },
    {
      heading: "3. Fees",
      plainEnglish: "What you pay to rent the space.",
      body: [`The rental fee is ${rate}${minimum}. Fees are collected by the Studio directly.`],
    },
    {
      heading: "4. Damage Deposit",
      plainEnglish: "A refundable deposit the studio holds against damage — VenueDash never touches this money.",
      body: [
        `A refundable damage deposit of ${deposit} applies to this rental. The deposit is collected and refunded by the studio directly; VenueDash does not hold, charge, or refund deposit funds.`,
        "The Studio may retain all or part of the deposit for damage to the premises, equipment, or furnishings beyond ordinary wear, documented at the pre- and post-event walkthroughs.",
      ],
    },
    {
      heading: "5. Occupancy",
      plainEnglish: input.maxOccupancy != null ? `No more than ${input.maxOccupancy} people.` : "Stay within a safe headcount.",
      body: [
        input.maxOccupancy != null
          ? `Attendance shall not exceed the maximum occupancy of ${input.maxOccupancy} persons.`
          : "Attendance shall not exceed a safe and lawful occupancy for the premises.",
      ],
    },
    {
      heading: "6. Alcohol",
      plainEnglish: alcohol.plainEnglish,
      body: [alcohol.clause],
    },
    {
      heading: "7. Outside Vendors",
      plainEnglish: vendor.plainEnglish,
      body: [vendor.clause],
    },
    {
      heading: "8. Noise & Conduct",
      plainEnglish: "Keep noise reasonable and follow Atlanta's noise ordinance.",
      body: [
        `${
          input.noiseCurfew ? `Amplified sound shall end by ${input.noiseCurfew}. ` : ""
        }The Renter shall comply with the City of Atlanta noise ordinance, Atlanta Code § 74-133, and all applicable laws.`,
      ],
    },
    {
      heading: "9. Equipment",
      plainEnglish: "Don't move or use the studio's gear unless it's part of your rental.",
      body: [
        `The Renter shall not move, alter, or operate Studio equipment${
          input.equipmentList ? ` (including ${input.equipmentList})` : ""
        } except as expressly included in the rental.`,
      ],
    },
    {
      heading: "10. Cancellation",
      plainEnglish: ladder
        ? `Full refund ${ladder.full}+ days out, half by ${ladder.half} days, none after.`
        : "Cancellation terms as agreed between the parties.",
      body: [
        ladder
          ? `Cancellation ${ladder.full} or more days before the event: full refund of fees paid. Cancellation ${ladder.half} to ${ladder.full} days before: 50% refund. Fewer than ${ladder.none === 0 ? ladder.half : ladder.none} days: no refund.`
          : "Cancellation and refund terms are as agreed between the parties.",
      ],
    },
    {
      heading: "11. Liability & Indemnification",
      plainEnglish: "You're responsible for your guests and for damage they cause.",
      body: [
        "The Renter assumes responsibility for the conduct of all guests and shall indemnify and hold the Studio harmless from claims, damages, or costs arising from the Renter's use of the premises, to the fullest extent permitted by law.",
      ],
    },
    {
      heading: "12. Governing Law",
      body: ["This agreement is governed by the laws of the State of Georgia."],
    },
    {
      heading: "13. Signatures",
      plainEnglish: "You'll receive a separate request to sign electronically.",
      body: [
        "By signing, the parties agree to the terms above. Signatures are collected through a separate signing request.",
        "Studio: ______________________   Date: __________",
        "Renter: ______________________   Date: __________",
      ],
    },
  ];

  return { title: "Standard Event Rental Agreement", disclaimer: DISCLAIMER, sections };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `nvm use 20 && npx vitest run lib/contract/template.test.ts`
Expected: PASS (all cases). If the "fewer than N days" wording trips the ladder assertion, it doesn't — tests only assert on refund keywords and day numbers present.

- [ ] **Step 5: Commit**

```bash
git add lib/contract/template.ts lib/contract/template.test.ts
git commit -m "feat(contract): pure buildStandardContract content model"
```

---

## Task 5: Contract input mapping — `contractInputFromBooking`

**Files:**
- Create: `lib/contract/input.ts`
- Test: `lib/contract/input.test.ts`

**Interfaces:**
- Consumes: `Booking` from `@/db/schema`; `ContractInput`, `CancellationLadder` from `./types`; `formatAtlantaRange` from `@/lib/tz`.
- Produces: `contractInputFromBooking(booking: Booking, identity: { studioName: string; studioAddress: string | null; equipmentList: string | null }): ContractInput`

- [ ] **Step 1: Write the failing test**

Create `lib/contract/input.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { contractInputFromBooking } from "./input";
import type { Booking } from "@/db/schema";

const booking = {
  id: "b1", studioId: "s1", state: "awaiting_contract",
  renterName: "Dana Renter", renterEmail: "dana@example.com", renterPhone: "404-555-0100",
  eventType: "Photo shoot", headcount: 20, byob: true, outsideVendors: true, notes: null,
  startsAt: new Date("2026-08-15T18:00:00Z"), endsAt: new Date("2026-08-15T22:00:00Z"),
  depositCents: 40000,
  rateSnapshot: {
    hourlyRateCents: 12000, minHours: 3, cancellationLadder: { full: 30, half: 14, none: 0 },
    alcoholPolicy: "byob_with_acknowledgment", vendorPolicy: "approved_vendors",
    noiseCurfew: "10:00 PM", cleanupWindowMin: 30, maxOccupancy: 30,
  },
  depositProtected: true, depositStatus: "uncollected", depositStatusAt: null,
  contractSignedAt: null, createdAt: new Date(),
} as unknown as Booking;

describe("contractInputFromBooking", () => {
  it("reads legal terms from the snapshot and identity from the passed object", () => {
    const input = contractInputFromBooking(booking, {
      studioName: "Westview Studio", studioAddress: "123 RDA Blvd", equipmentList: "Cyc wall",
    });
    expect(input.studioName).toBe("Westview Studio");
    expect(input.studioAddress).toBe("123 RDA Blvd");
    expect(input.equipmentList).toBe("Cyc wall");
    expect(input.hourlyRateCents).toBe(12000);
    expect(input.alcoholPolicy).toBe("byob_with_acknowledgment");
    expect(input.maxOccupancy).toBe(30);
    expect(input.depositCents).toBe(40000);
    expect(input.renterName).toBe("Dana Renter");
    expect(input.when).toMatch(/2026/);
  });

  it("tolerates a null/partial snapshot", () => {
    const input = contractInputFromBooking(
      { ...booking, rateSnapshot: null } as unknown as Booking,
      { studioName: "X", studioAddress: null, equipmentList: null }
    );
    expect(input.hourlyRateCents).toBeNull();
    expect(input.cancellationLadder).toBeNull();
    expect(input.alcoholPolicy).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `nvm use 20 && npx vitest run lib/contract/input.test.ts`
Expected: FAIL — cannot resolve `./input`.

- [ ] **Step 3: Write `lib/contract/input.ts`**

```ts
import type { Booking } from "@/db/schema";
import { formatAtlantaRange } from "@/lib/tz";
import type { CancellationLadder, ContractInput } from "./types";

type Snap = {
  hourlyRateCents?: number | null;
  minHours?: number | null;
  cancellationLadder?: unknown;
  alcoholPolicy?: string | null;
  vendorPolicy?: string | null;
  noiseCurfew?: string | null;
  cleanupWindowMin?: number | null;
  maxOccupancy?: number | null;
};

function asLadder(v: unknown): CancellationLadder | null {
  if (v && typeof v === "object" && "full" in v && "half" in v && "none" in v) {
    const l = v as Record<string, unknown>;
    if (typeof l.full === "number" && typeof l.half === "number" && typeof l.none === "number") {
      return { full: l.full, half: l.half, none: l.none };
    }
  }
  return null;
}

export function contractInputFromBooking(
  booking: Booking,
  identity: { studioName: string; studioAddress: string | null; equipmentList: string | null }
): ContractInput {
  const snap = (booking.rateSnapshot ?? {}) as Snap;
  return {
    studioName: identity.studioName,
    studioAddress: identity.studioAddress,
    equipmentList: identity.equipmentList,
    renterName: booking.renterName,
    renterEmail: booking.renterEmail,
    renterPhone: booking.renterPhone,
    eventType: booking.eventType,
    when: formatAtlantaRange(booking.startsAt, booking.endsAt),
    headcount: booking.headcount,
    byob: booking.byob,
    outsideVendors: booking.outsideVendors,
    hourlyRateCents: snap.hourlyRateCents ?? null,
    minHours: snap.minHours ?? null,
    depositCents: booking.depositCents,
    maxOccupancy: snap.maxOccupancy ?? null,
    alcoholPolicy: snap.alcoholPolicy ?? null,
    vendorPolicy: snap.vendorPolicy ?? null,
    noiseCurfew: snap.noiseCurfew ?? null,
    cleanupWindowMin: snap.cleanupWindowMin ?? null,
    cancellationLadder: asLadder(snap.cancellationLadder),
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `nvm use 20 && npx vitest run lib/contract/input.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/contract/input.ts lib/contract/input.test.ts
git commit -m "feat(contract): map booking+snapshot → ContractInput (terms from snapshot)"
```

---

## Task 6: PDF renderer — `renderContractPdf` (react-pdf shell + bundling de-risk)

**Files:**
- Modify: `package.json`
- Create: `lib/contract/pdf.tsx`, `lib/contract/pdf.test.ts`

**Interfaces:**
- Consumes: `ContractDoc` from `./types`.
- Produces: `renderContractPdf(doc: ContractDoc): Promise<Buffer>`

- [ ] **Step 1: Install `@react-pdf/renderer`**

Run: `nvm use 20 && npm install @react-pdf/renderer`
Expected: installs; `package.json` dependencies now include `@react-pdf/renderer`.

- [ ] **Step 2: Write the smoke test (failing)**

Create `lib/contract/pdf.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { renderContractPdf } from "./pdf";
import { buildStandardContract } from "./template";
import type { ContractInput } from "./types";

const input: ContractInput = {
  studioName: "Westview Studio", studioAddress: "123 RDA Blvd", renterName: "Dana Renter",
  renterEmail: "dana@example.com", renterPhone: null, eventType: "Photo shoot",
  when: "Sat, Aug 15, 2026 · 2:00–6:00 PM", headcount: 20, hourlyRateCents: 12000, minHours: 3,
  depositCents: 40000, maxOccupancy: 30, alcoholPolicy: "byob_with_acknowledgment",
  vendorPolicy: "approved_vendors", noiseCurfew: "10:00 PM", cleanupWindowMin: 30,
  cancellationLadder: { full: 30, half: 14, none: 0 }, equipmentList: "Cyc wall",
  byob: true, outsideVendors: true,
};

describe("renderContractPdf", () => {
  it("renders a non-empty PDF buffer", async () => {
    const buf = await renderContractPdf(buildStandardContract(input));
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(1000);
    expect(buf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  }, 20000);
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `nvm use 20 && npx vitest run lib/contract/pdf.test.ts`
Expected: FAIL — cannot resolve `./pdf`.

- [ ] **Step 4: Write `lib/contract/pdf.tsx`**

```tsx
import { Document, Page, Text, View, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import type { ContractDoc } from "./types";

const s = StyleSheet.create({
  page: { paddingTop: 48, paddingBottom: 56, paddingHorizontal: 54, fontSize: 10, lineHeight: 1.5, fontFamily: "Times-Roman", color: "#1a1a1a" },
  title: { fontSize: 18, fontFamily: "Times-Bold", marginBottom: 8 },
  disclaimer: { fontSize: 8.5, fontStyle: "italic", color: "#555", marginBottom: 16, padding: 8, borderWidth: 1, borderColor: "#bbb", borderStyle: "solid" },
  heading: { fontSize: 11, fontFamily: "Times-Bold", marginTop: 12, marginBottom: 3 },
  plain: { fontSize: 8.5, fontStyle: "italic", color: "#4a5", marginBottom: 3 },
  body: { marginBottom: 3 },
});

export function ContractDocument({ doc }: { doc: ContractDoc }) {
  return (
    <Document title={doc.title}>
      <Page size="LETTER" style={s.page}>
        <Text style={s.title}>{doc.title}</Text>
        <Text style={s.disclaimer}>{doc.disclaimer}</Text>
        {doc.sections.map((sec, i) => (
          <View key={i} wrap={false}>
            <Text style={s.heading}>{sec.heading}</Text>
            {sec.plainEnglish ? <Text style={s.plain}>In plain English: {sec.plainEnglish}</Text> : null}
            {sec.body.map((p, j) => (
              <Text key={j} style={s.body}>{p}</Text>
            ))}
          </View>
        ))}
      </Page>
    </Document>
  );
}

export async function renderContractPdf(doc: ContractDoc): Promise<Buffer> {
  return renderToBuffer(<ContractDocument doc={doc} />);
}
```

- [ ] **Step 5: Run the smoke test to verify it passes**

Run: `nvm use 20 && npx vitest run lib/contract/pdf.test.ts`
Expected: PASS (a `%PDF-` buffer > 1 KB). Times-Roman/Times-Bold are react-pdf standard fonts — no font files needed.

- [ ] **Step 6: Verify the app still builds (bundling de-risk — the key react-pdf risk)**

Run: `nvm use 20 && npm run build`
Expected: build succeeds. If it fails on a react-pdf module resolution / wasm bundling error, STOP and switch the shell to `pdfkit` (see spec §9): reimplement `renderContractPdf` with `pdfkit` using standard Helvetica/Times fonts, keep the same signature, delete the `.tsx` for a `.ts`. All other tasks are unaffected. Then rerun Steps 5–6.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json lib/contract/pdf.tsx lib/contract/pdf.test.ts
git commit -m "feat(contract): react-pdf renderer for ContractDoc (+ build de-risk)"
```

---

## Task 7: Contract DB access + orchestration — `lib/contract.ts`

**Files:**
- Create: `lib/contract.ts`, `lib/contract.test.ts`

**Interfaces:**
- Consumes: `Db` from `@/lib/domain/transitions`; `contracts` from `@/db/schema`; `transitionBooking` from `@/lib/domain/transitions`; `Booking` from `@/db/schema`; `contractInputFromBooking` from `@/lib/contract/input`; `buildStandardContract` from `@/lib/contract/template`.
- Produces:
  - `type Contract = typeof contracts.$inferSelect`
  - `getContractForBooking(db, bookingId): Promise<Contract | null>`
  - `upsertContract(db, bookingId, pdfR2Key, sentAt): Promise<Contract>` — insert or update-by-`bookingId` (unique), status `sent`.
  - `markContractSigned(db, bookingId, signedAt): Promise<void>` — set status `signed` + `signedAt` (no-op if no row).
  - `contractKey(bookingId): string` → `contracts/{bookingId}/agreement.pdf`
  - `type GenerateDeps = { render: (doc) => Promise<Buffer>; put: (key, body, ct) => Promise<void>; now?: () => Date }`
  - `generateAndAdvance(db, booking, identity, deps): Promise<Contract>` — render → put → upsert → `transitionBooking(awaiting_signature)`. Throws transition errors up to the caller.

- [ ] **Step 1: Write the failing PGlite test**

Create `lib/contract.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "@/lib/domain/test-db";
import { studios, bookings, contracts, type Booking } from "@/db/schema";
import {
  getContractForBooking, upsertContract, markContractSigned, generateAndAdvance, contractKey,
} from "./contract";
import type { Db } from "@/lib/domain/transitions";

async function seedBooking(db: Db, state = "awaiting_contract"): Promise<Booking> {
  const [studio] = await db.insert(studios).values({
    clerkUserId: "u-" + Math.random().toString(36).slice(2), name: "Westview", slug: "westview-" + Math.random().toString(36).slice(2),
  }).returning();
  const [booking] = await db.insert(bookings).values({
    studioId: studio.id, state: state as Booking["state"], renterName: "Dana", renterEmail: "d@x.com",
    startsAt: new Date("2026-08-15T18:00:00Z"), endsAt: new Date("2026-08-15T22:00:00Z"),
    depositCents: 40000, rateSnapshot: { hourlyRateCents: 12000, minHours: 3 },
  }).returning();
  return booking;
}

const IDENTITY = { studioName: "Westview", studioAddress: null, equipmentList: null };

describe("contract DB access", () => {
  let db: Db;
  beforeEach(async () => { db = (await createTestDb()).db; });

  it("upserts one contract per booking (unique booking_id)", async () => {
    const b = await seedBooking(db);
    const c1 = await upsertContract(db, b.id, "k1", new Date());
    const c2 = await upsertContract(db, b.id, "k2", new Date());
    expect(c2.id).toBe(c1.id);
    expect(c2.pdfR2Key).toBe("k2");
    const rows = await db.select().from(contracts).where(eq(contracts.bookingId, b.id));
    expect(rows.length).toBe(1);
  });

  it("markContractSigned flips status + signedAt", async () => {
    const b = await seedBooking(db);
    await upsertContract(db, b.id, "k1", new Date());
    await markContractSigned(db, b.id, new Date("2026-08-01T00:00:00Z"));
    const c = await getContractForBooking(db, b.id);
    expect(c?.status).toBe("signed");
    expect(c?.signedAt?.toISOString()).toBe("2026-08-01T00:00:00.000Z");
  });

  it("generateAndAdvance renders, stores, writes a row, and advances state", async () => {
    const b = await seedBooking(db);
    let putKey = ""; let rendered = false;
    const c = await generateAndAdvance(db, b, IDENTITY, {
      render: async () => { rendered = true; return Buffer.from("%PDF-fake"); },
      put: async (key) => { putKey = key; },
      now: () => new Date("2026-07-06T00:00:00Z"),
    });
    expect(rendered).toBe(true);
    expect(putKey).toBe(contractKey(b.id));
    expect(c.status).toBe("sent");
    expect(c.pdfR2Key).toBe(contractKey(b.id));
    const [row] = await db.select().from(bookings).where(eq(bookings.id, b.id));
    expect(row.state).toBe("awaiting_signature");
  });

  it("generateAndAdvance is idempotent-safe: a second call from awaiting_signature throws (illegal transition)", async () => {
    const b = await seedBooking(db);
    const deps = { render: async () => Buffer.from("%PDF-fake"), put: async () => {} };
    await generateAndAdvance(db, b, IDENTITY, deps);
    const [advanced] = await db.select().from(bookings).where(eq(bookings.id, b.id));
    await expect(generateAndAdvance(db, advanced, IDENTITY, deps)).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `nvm use 20 && npx vitest run lib/contract.test.ts`
Expected: FAIL — cannot resolve `./contract`.

- [ ] **Step 3: Write `lib/contract.ts`**

```ts
import { eq } from "drizzle-orm";
import { contracts, type Booking } from "@/db/schema";
import { transitionBooking, type Db } from "@/lib/domain/transitions";
import { contractInputFromBooking } from "@/lib/contract/input";
import { buildStandardContract } from "@/lib/contract/template";
import type { ContractDoc } from "@/lib/contract/types";

export type Contract = typeof contracts.$inferSelect;

export function contractKey(bookingId: string): string {
  return `contracts/${bookingId}/agreement.pdf`;
}

export async function getContractForBooking(db: Db, bookingId: string): Promise<Contract | null> {
  const [row] = await db.select().from(contracts).where(eq(contracts.bookingId, bookingId));
  return row ?? null;
}

export async function upsertContract(
  db: Db, bookingId: string, pdfR2Key: string, sentAt: Date
): Promise<Contract> {
  const [row] = await db
    .insert(contracts)
    .values({ bookingId, template: "standard", status: "sent", pdfR2Key, sentAt })
    .onConflictDoUpdate({
      target: contracts.bookingId,
      set: { pdfR2Key, status: "sent", sentAt },
    })
    .returning();
  return row;
}

export async function markContractSigned(db: Db, bookingId: string, signedAt: Date): Promise<void> {
  await db.update(contracts).set({ status: "signed", signedAt }).where(eq(contracts.bookingId, bookingId));
}

export type GenerateDeps = {
  render: (doc: ContractDoc) => Promise<Buffer>;
  put: (key: string, body: Buffer, contentType: string) => Promise<void>;
  now?: () => Date;
};

export type StudioIdentity = { studioName: string; studioAddress: string | null; equipmentList: string | null };

/**
 * Render → store → upsert row → advance state. transitionBooking's CAS is the
 * sole idempotency/race guard: a second call from awaiting_signature throws
 * IllegalTransitionError, which the caller surfaces as "already generated".
 */
export async function generateAndAdvance(
  db: Db, booking: Booking, identity: StudioIdentity, deps: GenerateDeps
): Promise<Contract> {
  const now = deps.now?.() ?? new Date();
  const doc = buildStandardContract(contractInputFromBooking(booking, identity));
  const bytes = await deps.render(doc);
  const key = contractKey(booking.id);
  await deps.put(key, bytes, "application/pdf");
  const contract = await upsertContract(db, booking.id, key, now);
  await transitionBooking(db, booking.id, "awaiting_signature", { type: "owner" }, { meta: { contractId: contract.id } });
  return contract;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `nvm use 20 && npx vitest run lib/contract.test.ts`
Expected: PASS (all four cases).

- [ ] **Step 5: Commit**

```bash
git add lib/contract.ts lib/contract.test.ts
git commit -m "feat(contract): DB access + generateAndAdvance orchestration"
```

---

## Task 8: Renter "contract ready" email

**Files:**
- Create: `emails/ContractReadyRenter.tsx`
- Modify: `lib/email.ts`

**Interfaces:**
- Produces: `renderContractReadyRenter(props: { studioName: string; when: string; statusUrl?: string }): Promise<string>` — `statusUrl` optional; the raw status token isn't recoverable server-side (only its hash is stored — `lib/tokens.ts`), so the generate action sends this email **without** a deep link and the renter reaches the download via their existing durable status page (Task 15). The optional prop keeps a future deep-link path open.

- [ ] **Step 1: Write `emails/ContractReadyRenter.tsx`**

```tsx
import { Html, Body, Container, Heading, Text, Link } from "@react-email/components";

export type ContractReadyEmailProps = { studioName: string; when: string; statusUrl?: string };

export default function ContractReadyRenter(p: ContractReadyEmailProps) {
  return (
    <Html>
      <Body style={{ fontFamily: "sans-serif", backgroundColor: "#f7f5f0", color: "#211f1a" }}>
        <Container style={{ padding: 24, maxWidth: 520 }}>
          <Heading style={{ fontSize: 22, fontFamily: "Georgia, serif" }}>Your rental agreement is ready</Heading>
          <Text style={{ lineHeight: 1.7 }}>
            {p.studioName} has prepared the rental agreement for your event. You&apos;ll receive a separate
            request to sign it electronically — keep an eye on your inbox. You can review a copy anytime from your status page (bookmark the link from your first confirmation email).
          </Text>
          <Text style={{ color: "#8a867c" }}>Your event: {p.when}</Text>
          {p.statusUrl ? (
            <Link
              href={p.statusUrl}
              style={{ display: "inline-block", background: "#211f1a", color: "#f7f5f0", fontWeight: 700, padding: "12px 20px", borderRadius: 10, textDecoration: "none" }}
            >
              View your booking &amp; agreement
            </Link>
          ) : null}
        </Container>
      </Body>
    </Html>
  );
}
```

- [ ] **Step 2: Add the render helper to `lib/email.ts`**

Add the import near the other email imports and the render fn near the others:

```ts
import ContractReadyRenter, { type ContractReadyEmailProps } from "@/emails/ContractReadyRenter";
```
```ts
export type ContractReadyEmail = ContractReadyEmailProps;
export async function renderContractReadyRenter(props: ContractReadyEmail): Promise<string> {
  return render(ContractReadyRenter(props));
}
```

- [ ] **Step 3: Typecheck**

Run: `nvm use 20 && npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add emails/ContractReadyRenter.tsx lib/email.ts
git commit -m "feat(email): renter contract-ready notification"
```

---

## Task 9: Owner-action wiring — `generate_contract` in the view-model

**Files:**
- Modify: `lib/domain/booking-view.ts`
- Test: `lib/domain/booking-view.test.ts`

**Interfaces:**
- Produces: `OwnerAction` union gains `"generate_contract"`; an `awaiting_contract` booking now offers `["generate_contract", "cancel"]`.

- [ ] **Step 1: Write/extend the failing test**

Add to `lib/domain/booking-view.test.ts` (follow the file's existing helper for building a booking; use its established pattern):

```ts
it("offers generate_contract (not mark_signed) on an awaiting_contract booking", () => {
  const view = toBookingView(makeBooking({ state: "awaiting_contract" }), new Date("2026-01-01T00:00:00Z"));
  expect(view.legalActions).toContain("generate_contract");
  expect(view.legalActions).not.toContain("mark_signed");
});

it("still offers mark_signed on an awaiting_signature booking", () => {
  const view = toBookingView(makeBooking({ state: "awaiting_signature" }), new Date("2026-01-01T00:00:00Z"));
  expect(view.legalActions).toContain("mark_signed");
  expect(view.legalActions).not.toContain("generate_contract");
});
```

*(If the existing test file names its factory differently than `makeBooking`, use that name — read the file first.)*

- [ ] **Step 2: Run it to verify it fails**

Run: `nvm use 20 && npx vitest run lib/domain/booking-view.test.ts`
Expected: FAIL — `generate_contract` not offered (and possibly a TS union error).

- [ ] **Step 3: Wire it into `lib/domain/booking-view.ts`**

Three edits:

```ts
export type OwnerAction = "approve" | "generate_contract" | "decline" | "cancel" | "mark_signed";
```
```ts
const TARGET_TO_ACTION: Partial<Record<BookingState, OwnerAction>> = {
  awaiting_contract: "approve",
  awaiting_signature: "generate_contract",
  declined: "decline",
  canceled: "cancel",
  confirmed: "mark_signed",
};
```
```ts
const ACTION_ORDER: OwnerAction[] = ["approve", "generate_contract", "decline", "mark_signed", "cancel"];
```

Update the stale comment above `TARGET_TO_ACTION` (drop the "awaiting_signature (contract-gen = Phase 6)" exclusion note).

- [ ] **Step 4: Run the test to verify it passes**

Run: `nvm use 20 && npx vitest run lib/domain/booking-view.test.ts`
Expected: PASS. (Existing cases still pass — an `awaiting_contract` booking previously offered only `approve`+`cancel`; it now offers `generate_contract`+`cancel`. If a prior assertion pinned the exact `awaiting_contract` action list, update it to the new expectation.)

- [ ] **Step 5: Commit**

```bash
git add lib/domain/booking-view.ts lib/domain/booking-view.test.ts
git commit -m "feat(booking-view): offer generate_contract on awaiting_contract"
```

---

## Task 10: `generateContract` server action + `markSigned` contract-row update

**Files:**
- Modify: `app/(owner)/dashboard/bookings/[id]/actions.ts`
- Test: `app/(owner)/dashboard/bookings/[id]/actions.test.ts` (create)

**Interfaces:**
- Consumes: `generateAndAdvance`, `markContractSigned` from `@/lib/contract`; `renderContractPdf` from `@/lib/contract/pdf`; `putObject` from `@/lib/storage`; `renderContractReadyRenter`, `sendEmail` from `@/lib/email`; `formatAtlantaRange` from `@/lib/tz`; `Studio` from `@/lib/studio` (`getStudioByClerkUserId` is already imported in this file).
- Produces: `generateContract(bookingId, _prev, _fd): Promise<BookingActionState>`; `ownerContext` now also returns `studio`. Equipment list lives on `studio.equipmentList` (a studio column), not on spaces.

- [ ] **Step 1: Add imports + extend `ownerContext` to return the studio**

At the top of `actions.ts`, add these imports (leave the existing ones — `getStudioByClerkUserId` is already imported):

```ts
import { formatAtlantaRange } from "@/lib/tz";
import { generateAndAdvance, markContractSigned } from "@/lib/contract";
import { renderContractPdf } from "@/lib/contract/pdf";
import { putObject } from "@/lib/storage";
import { sendEmail, renderContractReadyRenter } from "@/lib/email";
import type { Studio } from "@/lib/studio";
```

Change `ownerContext` to include `studio` in its return type and value:

```ts
async function ownerContext(
  bookingId: string
): Promise<{ db: Db; userId: string; booking: Booking; studio: Studio }> {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");
  const db = getDb();
  const studio = await getStudioByClerkUserId(db, userId);
  if (!studio) redirect("/settings");
  const booking = await getBookingForOwner(db, bookingId, studio.id);
  if (!booking) notFound();
  return { db, userId, booking, studio };
}
```

- [ ] **Step 2: Add the `generateContract` action**

The renter status **token** cannot be reconstructed here (only its SHA-256 hash is stored — `lib/tokens.ts`), so the email is intentionally link-less; the renter downloads from their existing durable status page (Task 15). Add:

```ts
export async function generateContract(
  bookingId: string, _prev: BookingActionState, _fd: FormData
): Promise<BookingActionState> {
  const { db, booking, studio } = await ownerContext(bookingId);
  if (booking.state !== "awaiting_contract") {
    return { status: "error", error: "This booking just changed — refresh and try again." };
  }
  try {
    await generateAndAdvance(
      db, booking,
      { studioName: studio.name, studioAddress: studio.address, equipmentList: studio.equipmentList },
      { render: renderContractPdf, put: putObject }
    );
  } catch (e) {
    if (
      e instanceof IllegalTransitionError ||
      e instanceof ConcurrentTransitionError ||
      e instanceof BookingNotFoundError
    ) {
      return { status: "error", error: "This booking just changed — refresh and try again." };
    }
    throw e;
  }

  // Best-effort renter notification — a send failure must never fail the generation.
  try {
    await sendEmail({
      to: booking.renterEmail,
      subject: `Your rental agreement for ${studio.name} is ready`,
      html: await renderContractReadyRenter({
        studioName: studio.name,
        when: formatAtlantaRange(booking.startsAt, booking.endsAt),
      }),
    });
  } catch (e) {
    console.error("renter contract email failed (generation stands):", e);
  }

  revalidate(bookingId);
  return { status: "idle", error: "" };
}
```

- [ ] **Step 3: Update `markSigned` to also flip the contract row**

In the existing `markSigned`, after `setContractSignedAt`, add the contract-row update (best-effort — a missing contract row must not fail the confirm):

```ts
export async function markSigned(
  bookingId: string, _prev: BookingActionState, _fd: FormData
): Promise<BookingActionState> {
  const { db, userId } = await ownerContext(bookingId);
  const signedAt = new Date();
  const result = await runTransition(
    db, bookingId, "confirmed", userId, { contractSignedAt: signedAt.toISOString() }
  );
  if (result.status === "error") return result;
  await setContractSignedAt(db, bookingId, signedAt);
  try { await markContractSigned(db, bookingId, signedAt); } catch (e) { console.error("contract-row sign flip failed (confirm stands):", e); }
  revalidate(bookingId);
  return result;
}
```

*(No unit test for the action itself: it calls Clerk `auth()`, which needs a Next request context that vitest doesn't provide, and importing a `"use server"` module under vitest is fragile. The state-machine correctness — advance, upsert, idempotency — is fully PGlite-tested via `generateAndAdvance` in Task 7; the action is a thin authz+wiring wrapper verified by the preview-deploy walk in Task 16.)*

- [ ] **Step 4: Run the suite + typecheck**

Run: `nvm use 20 && npm run test && npm run typecheck`
Expected: PASS + no type errors. Fix any unused-import lint by removing dead imports.

- [ ] **Step 5: Commit**

```bash
git add "app/(owner)/dashboard/bookings/[id]/actions.ts"
git commit -m "feat(owner): generateContract action + mark-signed contract-row flip"
```

---

## Task 11: ActionButtons — `generate_contract` button

**Files:**
- Modify: `app/(owner)/dashboard/bookings/[id]/_components/ActionButtons.tsx`

**Interfaces:**
- Consumes: `generateContract` from `../actions`.

- [ ] **Step 1: Add the META entry + import**

Import `generateContract` alongside the others, and add to `META`:

```ts
import {
  approveBooking, generateContract, declineBooking, cancelBooking, markSigned,
} from "../actions";
```
```ts
const META: Record<OwnerAction, { label: string; className: string; fn: (id: string) => Bound }> = {
  approve: { label: "Approve request", className: "bg-success text-[#08130c]", fn: (id) => approveBooking.bind(null, id) },
  generate_contract: { label: "Generate & send contract", className: "bg-owner-accent text-[#0d0e14]", fn: (id) => generateContract.bind(null, id) },
  mark_signed: { label: "Mark contract signed", className: "bg-owner-accent text-[#0d0e14]", fn: (id) => markSigned.bind(null, id) },
  decline: { label: "Decline", className: "border border-owner-border text-owner-muted", fn: (id) => declineBooking.bind(null, id) },
  cancel: { label: "Cancel booking", className: "border border-[#5a2822] text-danger", fn: (id) => cancelBooking.bind(null, id) },
};
```

- [ ] **Step 2: Typecheck**

Run: `nvm use 20 && npm run typecheck`
Expected: PASS (the `Record<OwnerAction, …>` now requires the `generate_contract` key — this closes the exhaustiveness gap).

- [ ] **Step 3: Commit**

```bash
git add "app/(owner)/dashboard/bookings/[id]/_components/ActionButtons.tsx"
git commit -m "feat(owner): generate-contract action button"
```

---

## Task 12: Owner download route

**Files:**
- Create: `app/(owner)/dashboard/bookings/[id]/contract/route.ts`

**Interfaces:**
- Consumes: `getContractForBooking` from `@/lib/contract`; `getSignedDownloadUrl` from `@/lib/storage`; `getBookingForOwner` from `@/lib/booking`; `getStudioByClerkUserId` from `@/lib/studio`.

- [ ] **Step 1: Write the route handler**

```ts
import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getStudioByClerkUserId } from "@/lib/studio";
import { getBookingForOwner } from "@/lib/booking";
import { getContractForBooking } from "@/lib/contract";
import { getSignedDownloadUrl } from "@/lib/storage";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { userId } = await auth();
  if (!userId) return new NextResponse("Unauthorized", { status: 401 });
  const db = getDb();
  const studio = await getStudioByClerkUserId(db, userId);
  if (!studio) return new NextResponse("No studio", { status: 404 });
  const booking = await getBookingForOwner(db, id, studio.id);
  if (!booking) return new NextResponse("Not found", { status: 404 });
  const contract = await getContractForBooking(db, id);
  if (!contract?.pdfR2Key) return new NextResponse("No contract yet", { status: 404 });
  const url = await getSignedDownloadUrl(contract.pdfR2Key, 300);
  return NextResponse.redirect(url);
}
```

- [ ] **Step 2: Typecheck**

Run: `nvm use 20 && npm run typecheck`
Expected: PASS. *(Route handlers run on the Node runtime by default — required for aws-sdk. Do not add `export const runtime = "edge"`.)*

- [ ] **Step 3: Commit**

```bash
git add "app/(owner)/dashboard/bookings/[id]/contract/route.ts"
git commit -m "feat(owner): studio-scoped contract download route"
```

---

## Task 13: Renter download route

**Files:**
- Create: `app/(public)/status/[token]/contract/route.ts`

**Interfaces:**
- Consumes: `verifyRenterToken` from `@/lib/tokens`; `getContractForBooking` from `@/lib/contract`; `getSignedDownloadUrl` from `@/lib/storage`.

- [ ] **Step 1: Write the route handler**

```ts
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyRenterToken } from "@/lib/tokens";
import { getContractForBooking } from "@/lib/contract";
import { getSignedDownloadUrl } from "@/lib/storage";

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const db = getDb();
  const bookingId = await verifyRenterToken(db, token, "status");
  if (!bookingId) return new NextResponse("Not found", { status: 404 });
  const contract = await getContractForBooking(db, bookingId);
  if (!contract?.pdfR2Key) return new NextResponse("No contract yet", { status: 404 });
  const url = await getSignedDownloadUrl(contract.pdfR2Key, 300);
  return NextResponse.redirect(url);
}
```

- [ ] **Step 2: Typecheck**

Run: `nvm use 20 && npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add "app/(public)/status/[token]/contract/route.ts"
git commit -m "feat(public): token-scoped renter contract download route"
```

---

## Task 14: Owner detail page — replace placeholders + show download

**Files:**
- Modify: `app/(owner)/dashboard/bookings/[id]/page.tsx`

**Interfaces:**
- Consumes: `getContractForBooking` from `@/lib/contract`.

- [ ] **Step 1: Fetch the contract row in the page**

Add the import and fetch after `getBookingEvents`:

```ts
import { getContractForBooking } from "@/lib/contract";
```
```ts
const events = await getBookingEvents(db, id);
const contract = await getContractForBooking(db, id);
const view = toBookingView(booking, new Date());
```

- [ ] **Step 2: Replace the `awaiting_contract` card**

Replace the existing `awaiting_contract` block (the "Contract generation arrives in the next release" placeholder) with:

```tsx
{view.effectiveState === "awaiting_contract" ? (
  <div className="rounded-xl border border-owner-border bg-owner-panel p-4">
    <div className="font-mono text-[10px] uppercase tracking-wider text-owner-muted">Contract</div>
    <p className="mt-2 text-sm text-owner-text">
      Generate the Standard Event Rental Agreement from this booking&rsquo;s terms. It&rsquo;s stored for download,
      and the booking moves to awaiting signature so you can send it for signing.
    </p>
    <div className="mt-4"><ActionButtons bookingId={booking.id} actions={view.legalActions} /></div>
  </div>
) : null}
```

- [ ] **Step 3: Replace the `awaiting_signature` card to add the download link**

Replace the existing `awaiting_signature` block with:

```tsx
{view.effectiveState === "awaiting_signature" ? (
  <div className="rounded-xl border border-owner-border bg-owner-panel p-4">
    <div className="font-mono text-[10px] uppercase tracking-wider text-owner-muted">Signature</div>
    <p className="mt-2 text-sm text-owner-text">
      Download the agreement, run it through your e-sign tool, then mark it signed once the renter has signed.
    </p>
    {contract?.pdfR2Key ? (
      <a
        href={`/dashboard/bookings/${booking.id}/contract`}
        className="mt-3 inline-block rounded-lg border border-owner-border px-4 py-2 text-sm text-owner-text hover:border-owner-accent"
      >
        Download agreement (PDF)
      </a>
    ) : null}
    <div className="mt-4"><ActionButtons bookingId={booking.id} actions={view.legalActions} /></div>
  </div>
) : null}
```

- [ ] **Step 4: Update the Contract status tile to reflect real state**

Replace the "generated next release." Contract tile in the status grid with:

```tsx
<div className="rounded-xl border border-owner-border bg-owner-panel p-4">
  <div className="font-mono text-[10px] uppercase tracking-wider text-owner-muted">Contract</div>
  {contract?.status === "signed" ? (
    <p className="mt-2 text-sm text-success">Signed{contract.signedAt ? ` · ${contract.signedAt.toLocaleDateString()}` : ""}</p>
  ) : contract?.pdfR2Key ? (
    <p className="mt-2 text-sm text-owner-text">
      Generated &amp; sent ·{" "}
      <a className="underline hover:text-owner-accent" href={`/dashboard/bookings/${booking.id}/contract`}>Download PDF</a>
    </p>
  ) : (
    <p className="mt-2 text-sm text-owner-muted">Standard Event Rental · GA jurisdiction · not yet generated.</p>
  )}
</div>
```

- [ ] **Step 5: Verify render (unauthenticated debug render or preview walk deferred to Task 16) — typecheck + build now**

Run: `nvm use 20 && npm run typecheck && npm run build`
Expected: PASS. (Full authenticated render happens in Task 16.)

- [ ] **Step 6: Commit**

```bash
git add "app/(owner)/dashboard/bookings/[id]/page.tsx"
git commit -m "feat(owner): live contract cards + download on booking detail"
```

---

## Task 15: Renter status page — download link

**Files:**
- Modify: `app/(public)/status/[token]/page.tsx`

**Interfaces:**
- Consumes: `getContractForBooking` from `@/lib/contract`.

- [ ] **Step 1: Fetch the contract + render a download button when present**

Add the import and fetch, then a conditional block after the existing card. Add:

```ts
import { getContractForBooking } from "@/lib/contract";
```
After the `studio` fetch:
```ts
const contract = await getContractForBooking(db, bookingId);
```
Insert before the closing `</main>` (after the "Bookmark this page" paragraph):

```tsx
{contract?.pdfR2Key ? (
  <div className="mt-6 rounded-xl border border-renter-border bg-white p-4">
    <div className="font-mono text-[9.5px] uppercase tracking-[.12em] text-[#8a867c]">Rental agreement</div>
    <p className="mt-1 text-[13px] leading-relaxed text-renter-ink">
      Your agreement is ready. A separate signing request will arrive by email.
    </p>
    <a
      href={`/status/${token}/contract`}
      className="mt-3 inline-block rounded-lg border border-renter-border px-4 py-2 text-[13px] text-renter-ink"
    >
      Download agreement (PDF)
    </a>
  </div>
) : null}
```

- [ ] **Step 2: Typecheck + build**

Run: `nvm use 20 && npm run typecheck && npm run build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add "app/(public)/status/[token]/page.tsx"
git commit -m "feat(public): renter agreement download on status page"
```

---

## Task 16: Full verification, prod migration, docs, PR

**Files:**
- Modify: `.superpowers/sdd/progress.md`, `CLAUDE.md`

- [ ] **Step 1: Full local gate**

Run: `nvm use 20 && npm run lint && npm run typecheck && npm run test && npm run build`
Expected: all green. Fix anything red before proceeding (use systematic-debugging for non-obvious failures).

- [ ] **Step 2: Apply the migration to the Neon DB the deploy reads**

Run: `nvm use 20 && npm run db:migrate`
Expected: `0003` applies (adds `pdf_r2_key`, unique index). Idempotent if already applied.

- [ ] **Step 3: Re-point the seed studio to your Clerk id and walk it (per CLAUDE.md gotcha)**

Run: `nvm use 20 && npm run db:seed`, then in the DB set the `westview` studio's `clerk_user_id` to your Clerk user id. Sign in, open an `awaiting_contract` booking, click **Generate & send contract**:
- Booking advances to **awaiting_signature**; the page shows **Download agreement (PDF)**.
- Click it → a real PDF opens (parties, dates, deposit "collected by the studio", § 74-133, disclaimer). This is the render-in-verification gate — **not** a curl check.
- Open the renter's `/status/[token]` page → the **Download agreement (PDF)** button appears and downloads the same PDF.
- Click **Mark contract signed** → booking → **confirmed**, contract tile shows **Signed**.

- [ ] **Step 4: Push + open the PR**

```bash
git push -u origin feat/phase-6-contract-generation
gh pr create --title "feat: Phase 6 — contract generation" --body "$(cat <<'EOF'
Generates the Standard GA Event-Rental PDF from a booking's snapshotted terms,
stores it to R2, delivers owner + renter presigned downloads, and advances
awaiting_contract → awaiting_signature. Manual signing unchanged.

- Pure buildStandardContract content model + fixed policy→clause lookup (no legal reasoning)
- Thin @react-pdf/renderer shell (swappable); Times standard fonts
- contracts.pdf_r2_key + unique booking_id index (0003); server-side putObject
- generateAndAdvance: render → store → upsert → transitionBooking (CAS = idempotency guard)
- Owner + renter download routes (studio-scoped / token-scoped presigned GET)
- mark_signed also flips the contract row to signed

Snapshot discipline: legal terms from rateSnapshot, party identity live.
Attorney review of the template remains a launch gate (v0.5 §7).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 5: Confirm the Vercel preview deploy is green, then walk the preview** (authenticated owner flow above, on the preview URL). If the deploy fails to build (react-pdf bundling), fall back to pdfkit per Task 6 Step 6 and push.

- [ ] **Step 6: Update the ledger + handoff**

- Append Phase 6 to `.superpowers/sdd/progress.md` (tasks, review findings, the react-pdf-vs-pdfkit outcome).
- Update `CLAUDE.md`: mark Phase 6 ✅; move the "next" pointer to Phase 7 (photo checklist PWA); record the new carry-forwards (signed-PDF upload, contract regeneration/versioning, attorney review still open); note `pdf_r2_key`/unique index and `putObject`.

```bash
git add .superpowers/sdd/progress.md CLAUDE.md
git commit -m "docs: Phase 6 ledger + CLAUDE.md handoff to Phase 7"
git push
```

- [ ] **Step 7: STOP for human UI review**

Do **not** merge. Leave the PR open with the preview link and a summary of what to walk (owner generate → download → mark-signed; renter status download). Human reviews the UI, then merges to main.

---

## Self-Review (checked against the spec)

- **Spec §2 In-scope** — content model (T4), PDF render (T6), storage/`pdf_r2_key`/unique index (T1–T2), generate action (T10), downloads (T12–T13), UI (T14–T15), sign coherence (T10 markSigned), renter email (T8). ✅
- **Spec §3 architecture** — pure core + thin shell (T3–T7); ordering/idempotency via CAS (T7/T10); identity-vs-terms boundary (T5). ✅
- **Spec §4 data model** — `pdf_r2_key` + unique `booking_id` (T1). ✅
- **Spec §5 storage** — `putObject`, deterministic key, Node runtime (T2, T7, T12–T13). ✅
- **Spec §6 delivery** — owner route (T12), renter route reusing status token (T13), renter email (T8/T10). ✅ *Note:* the raw status token isn't recoverable server-side, so the generate email is informational (no deep link); the renter reaches the download via their existing durable status page — consistent with §6's "viewable from their status page."
- **Spec §7 UI** — `generate_contract` wired (T9), buttons (T11), owner cards + tiles (T14), renter status (T15), seed tolerance via contract-existence gating (T14/T15). ✅
- **Spec §8 testing** — pure template (T4), input mapping (T5), pdf smoke (T6), DB/orchestration PGlite (T7), action export guard (T10), storage/preview verification (T16). ✅
- **Spec §9 risks** — react-pdf bundling de-risked with build check + pdfkit fallback (T6/T16). ✅
- **Spec §10 DoD** — full gate + prod migrate + preview walk + single PR + human review (T16). ✅
- **Placeholder scan** — no TBD/TODO; every code step carries real code. The one prose-heavy resolution (status-token non-recoverability) is resolved to a concrete edit (optional `statusUrl`, tokenless email). ✅
- **Type consistency** — `generateAndAdvance`/`upsertContract`/`markContractSigned`/`getContractForBooking`/`contractKey` names match across T7, T10, T12–T15; `OwnerAction` union extended once (T9) and consumed exhaustively (T11). ✅
