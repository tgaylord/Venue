# VenueDash Phase 1 — Landing + Disclaimer/ToS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an outreach-ready marketing landing page (faithful dark-theme port of the prototype, copy rewritten to v0.5 truth) with a waitlist form that stores emails as Resend contacts, plus drafted `/terms` and `/privacy` pages.

**Architecture:** Everything lives in the `(marketing)` route group of the existing Next.js 16 App Router app. The landing is a static server component composed of small section components; the only client component is `WaitlistForm`, which posts to a server action that calls `lib/waitlist.ts` (Resend `contacts.create`). Legal pages are static. No database, no new dependencies.

**Tech Stack:** Next.js 16 (App Router) · React 19 (`useActionState`) · Tailwind v4 (`@theme` tokens already in `app/globals.css`) · Resend SDK v6 (already installed) · Vitest.

## Global Constraints

_Copied from the Phase 1 spec (`docs/specs/2026-07-05-venuedash-phase-1-landing-design.md`) and v0.5 spec. Every task's requirements implicitly include this section._

- **Work on branch `feat/phase-1-landing`** (already exists, contains the spec). Ships as one PR.
- **Use Node 20:** run `nvm use 20` in every new shell before any npm command. The default shell Node is 24 and `engine-strict` will reject it.
- **No new npm dependencies.** Resend, Vitest, Tailwind are already installed.
- **Do NOT touch** `prototype/`, `(public)`, `(owner)`, `proxy.ts`, `db/schema.ts`, `drizzle/`.
- **Copy truth (v0.5):** no claims about held deposits, card capture, auto-refunds, e-signing, or COI gates. Language discipline: say "timestamped documentation", never "immutable evidence" or "proof". (The phrase *camera-roll "evidence"* in the problem-card headline is quoting the owner's current bad practice — that one is intentional and stays.)
- **Prototype fidelity:** `prototype/VenueDash_Prototype.dc.html` lines 39–130 are the visual spec for the landing. Port layout/spacing/colors faithfully; where a prototype hex has no `@theme` token, use a Tailwind arbitrary value (e.g. `bg-[#14151a]`), don't substitute a different color.
- **Design tokens available** (from `app/globals.css` `@theme`): `owner-bg #0b0c0f`, `owner-panel #16171c`, `owner-border #26272e`, `owner-text #e9eaee`, `owner-muted #9a9ca8`, `owner-accent #7a86ff`, `success #5fd68b`, `warning #e6b054`, `danger #ef6f54`; fonts `font-sans` (Instrument Sans), `font-serif` (Instrument Serif), `font-mono` (IBM Plex Mono).
- **The landing and legal pages must build as static routes** (`○` in the `next build` route table).
- **Resend SDK v6 note:** Audiences are deprecated; `resend.contacts.create({ email })` is account-level and needs only `RESEND_API_KEY`. No new env vars.
- **Contact email fallback** (used in error copy until a domain exists): `tgaylord2024@gmail.com`.

---

## File Structure

```
lib/waitlist.ts                              → isValidEmail + addWaitlistContact (Resend)
lib/waitlist.test.ts                         → unit tests, Resend mocked
app/(marketing)/actions.ts                   → "use server" joinWaitlist action
app/(marketing)/actions.test.ts              → unit tests, lib/waitlist mocked
app/(marketing)/layout.tsx                   → MODIFY: light wrapper → dark owner surface
app/(marketing)/page.tsx                     → MODIFY: placeholder → landing assembly
app/(marketing)/_components/WaitlistForm.tsx → the only client component
app/(marketing)/_components/Header.tsx       → logo + anchor button
app/(marketing)/_components/Hero.tsx         → eyebrow/headline/subhead + form
app/(marketing)/_components/ProblemCards.tsx → 3 problem/solution cards
app/(marketing)/_components/HowItWorks.tsx   → 4-step rail
app/(marketing)/_components/PricingCta.tsx   → $60/mo + form
app/(marketing)/_components/Footer.tsx       → disclaimer + legal links
app/(marketing)/terms/page.tsx               → /terms
app/(marketing)/privacy/page.tsx             → /privacy
```

---

### Task 1: `lib/waitlist.ts` — email validation + Resend contact creation

**Files:**
- Create: `lib/waitlist.ts`
- Test: `lib/waitlist.test.ts`

**Interfaces:**
- Consumes: `Resend` from the installed `resend` package; `process.env.RESEND_API_KEY`.
- Produces (used by Task 2):
  ```ts
  export function isValidEmail(email: string): boolean
  export type WaitlistResult = { ok: true } | { ok: false; reason: "invalid_email" | "api_error" }
  export async function addWaitlistContact(email: string): Promise<WaitlistResult>
  ```

- [ ] **Step 1: Write the failing test**

Create `lib/waitlist.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const createMock = vi.fn();
vi.mock("resend", () => ({
  Resend: class {
    contacts = { create: createMock };
  },
}));

import { isValidEmail, addWaitlistContact } from "@/lib/waitlist";

beforeEach(() => {
  createMock.mockReset();
  process.env.RESEND_API_KEY = "re_test_key";
});

describe("isValidEmail", () => {
  it("accepts a normal address", () => {
    expect(isValidEmail("owner@studio.com")).toBe(true);
  });
  it("accepts an address with surrounding whitespace", () => {
    expect(isValidEmail("  owner@studio.com  ")).toBe(true);
  });
  it("rejects garbage", () => {
    expect(isValidEmail("not-an-email")).toBe(false);
    expect(isValidEmail("a@b")).toBe(false);
    expect(isValidEmail("")).toBe(false);
    expect(isValidEmail("a b@c.com")).toBe(false);
  });
});

describe("addWaitlistContact", () => {
  it("creates a Resend contact with the trimmed, lowercased email", async () => {
    createMock.mockResolvedValue({ data: { id: "c_1" }, error: null });
    const result = await addWaitlistContact("  Owner@Studio.COM ");
    expect(result).toEqual({ ok: true });
    expect(createMock).toHaveBeenCalledExactlyOnceWith({ email: "owner@studio.com" });
  });

  it("returns invalid_email without calling Resend", async () => {
    const result = await addWaitlistContact("nope");
    expect(result).toEqual({ ok: false, reason: "invalid_email" });
    expect(createMock).not.toHaveBeenCalled();
  });

  it("treats an already-existing contact as success", async () => {
    createMock.mockResolvedValue({
      data: null,
      error: { name: "validation_error", message: "Contact already exists" },
    });
    const result = await addWaitlistContact("owner@studio.com");
    expect(result).toEqual({ ok: true });
  });

  it("maps other API errors to api_error", async () => {
    createMock.mockResolvedValue({
      data: null,
      error: { name: "internal_server_error", message: "boom" },
    });
    const result = await addWaitlistContact("owner@studio.com");
    expect(result).toEqual({ ok: false, reason: "api_error" });
  });

  it("returns api_error when RESEND_API_KEY is missing", async () => {
    delete process.env.RESEND_API_KEY;
    const result = await addWaitlistContact("owner@studio.com");
    expect(result).toEqual({ ok: false, reason: "api_error" });
    expect(createMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `nvm use 20 && npm test -- lib/waitlist.test.ts`
Expected: FAIL — cannot resolve `@/lib/waitlist`.

- [ ] **Step 3: Implement `lib/waitlist.ts`**

```ts
import { Resend } from "resend";

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

export type WaitlistResult =
  | { ok: true }
  | { ok: false; reason: "invalid_email" | "api_error" };

export async function addWaitlistContact(email: string): Promise<WaitlistResult> {
  if (!isValidEmail(email)) return { ok: false, reason: "invalid_email" };

  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.error("addWaitlistContact: RESEND_API_KEY is not set");
    return { ok: false, reason: "api_error" };
  }

  const resend = new Resend(key);
  const { error } = await resend.contacts.create({
    email: email.trim().toLowerCase(),
  });

  // A duplicate signup is a success from the visitor's point of view.
  if (error && !/already exist/i.test(error.message)) {
    console.error("addWaitlistContact: Resend contacts.create failed:", error);
    return { ok: false, reason: "api_error" };
  }
  return { ok: true };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- lib/waitlist.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Run the full suite (storage + email tests must still pass)**

Run: `npm test`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add lib/waitlist.ts lib/waitlist.test.ts
git commit -m "feat: add waitlist contact helper backed by Resend contacts (tested)"
```

---

### Task 2: `joinWaitlist` server action + `WaitlistForm` client component

**Files:**
- Create: `app/(marketing)/actions.ts`, `app/(marketing)/actions.test.ts`, `app/(marketing)/_components/WaitlistForm.tsx`

**Interfaces:**
- Consumes: `addWaitlistContact` from Task 1 (exact signature above).
- Produces (used by Tasks 3–4):
  ```ts
  // actions.ts
  export type WaitlistFormState = { status: "idle" | "success" | "error"; message: string }
  export async function joinWaitlist(_prev: WaitlistFormState, formData: FormData): Promise<WaitlistFormState>
  // WaitlistForm.tsx — default export
  export default function WaitlistForm(props: { id?: string }): JSX.Element
  ```

- [ ] **Step 1: Write the failing test for the action**

Create `app/(marketing)/actions.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const addMock = vi.fn();
vi.mock("@/lib/waitlist", () => ({
  addWaitlistContact: addMock,
}));

import { joinWaitlist, type WaitlistFormState } from "@/app/(marketing)/actions";

const idle: WaitlistFormState = { status: "idle", message: "" };

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

beforeEach(() => addMock.mockReset());

describe("joinWaitlist", () => {
  it("returns success and never calls Resend when the honeypot is filled", async () => {
    const state = await joinWaitlist(idle, form({ email: "bot@spam.com", company: "Bot Inc" }));
    expect(state.status).toBe("success");
    expect(addMock).not.toHaveBeenCalled();
  });

  it("returns success when the contact is added", async () => {
    addMock.mockResolvedValue({ ok: true });
    const state = await joinWaitlist(idle, form({ email: "owner@studio.com", company: "" }));
    expect(state.status).toBe("success");
    expect(state.message).toMatch(/on the list/i);
    expect(addMock).toHaveBeenCalledExactlyOnceWith("owner@studio.com");
  });

  it("surfaces an invalid email as a field error", async () => {
    addMock.mockResolvedValue({ ok: false, reason: "invalid_email" });
    const state = await joinWaitlist(idle, form({ email: "nope", company: "" }));
    expect(state.status).toBe("error");
    expect(state.message).toMatch(/email address/i);
  });

  it("gives a mailto fallback on API failure", async () => {
    addMock.mockResolvedValue({ ok: false, reason: "api_error" });
    const state = await joinWaitlist(idle, form({ email: "owner@studio.com", company: "" }));
    expect(state.status).toBe("error");
    expect(state.message).toContain("tgaylord2024@gmail.com");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- "app/(marketing)/actions.test.ts"`
Expected: FAIL — cannot resolve `@/app/(marketing)/actions`.

- [ ] **Step 3: Implement `app/(marketing)/actions.ts`**

```ts
"use server";

import { addWaitlistContact } from "@/lib/waitlist";

export type WaitlistFormState = {
  status: "idle" | "success" | "error";
  message: string;
};

const SUCCESS = "You're on the list — we'll be in touch when onboarding opens.";
// Swap for a venuedash.com address once the domain exists.
const CONTACT_EMAIL = "tgaylord2024@gmail.com";

export async function joinWaitlist(
  _prev: WaitlistFormState,
  formData: FormData
): Promise<WaitlistFormState> {
  // Honeypot: real users never see or fill the "company" field.
  if (String(formData.get("company") ?? "").length > 0) {
    return { status: "success", message: SUCCESS };
  }

  const result = await addWaitlistContact(String(formData.get("email") ?? ""));
  if (result.ok) return { status: "success", message: SUCCESS };
  if (result.reason === "invalid_email") {
    return { status: "error", message: "That doesn't look like an email address — mind checking it?" };
  }
  return {
    status: "error",
    message: `Something went wrong on our end. Email ${CONTACT_EMAIL} and we'll add you by hand.`,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- "app/(marketing)/actions.test.ts"`
Expected: PASS (4 tests).

- [ ] **Step 5: Create `app/(marketing)/_components/WaitlistForm.tsx`**

```tsx
"use client";

import { useActionState } from "react";
import { joinWaitlist, type WaitlistFormState } from "../actions";

const initialState: WaitlistFormState = { status: "idle", message: "" };

export default function WaitlistForm({ id }: { id?: string }) {
  const [state, formAction, pending] = useActionState(joinWaitlist, initialState);

  if (state.status === "success") {
    return (
      <p id={id} className="rounded-lg border border-success/40 bg-success/10 px-4 py-3 text-sm text-success">
        {state.message}
      </p>
    );
  }

  return (
    <form id={id} action={formAction} className="flex max-w-md flex-col gap-2">
      <div className="flex gap-2">
        {/* Honeypot — hidden from real users, tempting to bots */}
        <input
          type="text"
          name="company"
          tabIndex={-1}
          autoComplete="off"
          aria-hidden="true"
          className="hidden"
        />
        <input
          type="email"
          name="email"
          required
          placeholder="you@yourstudio.com"
          aria-label="Email address"
          className="min-w-0 flex-1 rounded-[9px] border border-[#2c2d35] bg-[#101116] px-4 py-3 text-sm text-owner-text placeholder:text-[#5e6070] focus:border-owner-accent focus:outline-none"
        />
        <button
          type="submit"
          disabled={pending}
          className="shrink-0 rounded-[9px] bg-owner-accent px-5 py-3 text-sm font-bold text-[#0d0e14] disabled:opacity-60"
        >
          {pending ? "Joining…" : "Join the waitlist"}
        </button>
      </div>
      {state.status === "error" && (
        <p className="text-xs text-danger" role="alert">
          {state.message}
        </p>
      )}
    </form>
  );
}
```

- [ ] **Step 6: Verify typecheck and full test suite**

Run: `npm run typecheck && npm test`
Expected: both succeed.

- [ ] **Step 7: Commit**

```bash
git add "app/(marketing)/actions.ts" "app/(marketing)/actions.test.ts" "app/(marketing)/_components/WaitlistForm.tsx"
git commit -m "feat: add joinWaitlist server action and WaitlistForm client component (tested)"
```

---

### Task 3: Dark marketing layout, Header, Hero, and page assembly

**Files:**
- Modify: `app/(marketing)/layout.tsx`, `app/(marketing)/page.tsx`
- Create: `app/(marketing)/_components/Header.tsx`, `app/(marketing)/_components/Hero.tsx`

**Interfaces:**
- Consumes: `WaitlistForm` (Task 2, default export, `{ id?: string }` prop).
- Produces: `Header` and `Hero` default-export components (no props); a landing page that renders them. Tasks 4 adds the remaining sections to `page.tsx`.

- [ ] **Step 1: Switch the marketing layout to the dark surface**

Replace `app/(marketing)/layout.tsx`:

```tsx
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-owner-bg font-sans text-owner-text">{children}</div>;
}
```

- [ ] **Step 2: Create `app/(marketing)/_components/Header.tsx`**

```tsx
export default function Header() {
  return (
    <header className="flex items-center justify-between py-[22px]">
      <div className="flex items-center gap-[9px]">
        <div className="flex size-[22px] items-center justify-center rounded-md bg-gradient-to-br from-[#7a86ff] to-[#5560e0] text-xs font-bold text-white">
          V
        </div>
        <span className="text-base font-bold tracking-tight">VenueDash</span>
      </div>
      <a
        href="#waitlist"
        className="rounded-lg bg-owner-text px-4 py-[9px] text-[12.5px] font-semibold text-owner-bg"
      >
        Join the waitlist
      </a>
    </header>
  );
}
```

- [ ] **Step 3: Create `app/(marketing)/_components/Hero.tsx`**

Copy is the v0.5-truthful rewrite from the spec §4 — do not reintroduce deposit/e-sign claims.

```tsx
import WaitlistForm from "./WaitlistForm";

export default function Hero() {
  return (
    <section className="max-w-[640px] pb-14 pt-[72px]">
      <div className="mb-[18px] font-mono text-[11px] uppercase tracking-[.12em] text-owner-accent">
        For Atlanta studio owners who rent for events
      </div>
      <h1 className="mb-5 text-[52px] font-bold leading-[1.05] tracking-[-.03em] text-pretty">
        Rent your studio for events without betting it on a handshake.
      </h1>
      <p className="mb-8 max-w-[540px] text-[17px] leading-relaxed text-owner-muted text-pretty">
        Signed contracts and timestamped condition photos — the paperwork side of event
        rentals, handled in one place.
      </p>
      <WaitlistForm id="waitlist" />
      <div className="mt-[14px] font-mono text-[10.5px] tracking-[.04em] text-[#5e6070]">
        Atlanta-owned · HBCU-founded · First 60 days free
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Assemble the page (partial — remaining sections arrive in Task 4)**

Replace `app/(marketing)/page.tsx`:

```tsx
import Header from "./_components/Header";
import Hero from "./_components/Hero";

export default function LandingPage() {
  return (
    <div className="mx-auto max-w-[960px] px-8">
      <Header />
      <Hero />
    </div>
  );
}
```

- [ ] **Step 5: Verify in the browser**

Run: `npm run dev`, open `http://localhost:3000`.
Expected: dark page (`#0b0c0f`), indigo eyebrow, 52px headline, waitlist form. Submit a real email (with `.env.local` populated) → success banner appears; check the Resend dashboard → Contacts for the new contact. Submitting `not-an-email` past the browser's `type=email` check isn't possible — that's fine; the server path is unit-tested. Stop the server.

- [ ] **Step 6: Verify build + commit**

Run: `npm run build`
Expected: success; route table shows `/` with `○` (static).

```bash
git add "app/(marketing)/layout.tsx" "app/(marketing)/page.tsx" "app/(marketing)/_components/Header.tsx" "app/(marketing)/_components/Hero.tsx"
git commit -m "feat: dark marketing layout with header, hero, and waitlist form"
```

---

### Task 4: ProblemCards, HowItWorks, PricingCta, Footer + full page

**Files:**
- Create: `app/(marketing)/_components/ProblemCards.tsx`, `app/(marketing)/_components/HowItWorks.tsx`, `app/(marketing)/_components/PricingCta.tsx`, `app/(marketing)/_components/Footer.tsx`
- Modify: `app/(marketing)/page.tsx`

**Interfaces:**
- Consumes: `WaitlistForm` (Task 2); page skeleton from Task 3.
- Produces: four default-export, prop-less section components; the complete landing page.

- [ ] **Step 1: Create `app/(marketing)/_components/ProblemCards.tsx`**

Solutions rewritten to v0.5 truth (spec §4): no "e-signed", no card capture/auto-refund.

```tsx
const CARDS = [
  {
    problem: '"We agreed over DM"',
    pain: "A verbal agreement won't hold up when a renter's guest cracks your cyc wall.",
    solution:
      "every booking generates a Georgia venue agreement, signed before anyone gets a key.",
  },
  {
    problem: 'Camera-roll "evidence"',
    pain: "Photos with no verified timestamp are your word against theirs.",
    solution:
      "a guided pre/post walkthrough — every photo server-timestamped, geotagged, and locked.",
  },
  {
    problem: "Deposit chaos",
    pain: "Who paid, who got refunded, and what were the terms? It's scattered across three text threads.",
    solution:
      "your deposit terms printed in the contract and the deposit's status tracked on every booking — you collect it the way you already do.",
  },
];

export default function ProblemCards() {
  return (
    <section className="grid grid-cols-1 gap-[14px] pb-16 md:grid-cols-3">
      {CARDS.map((card) => (
        <div key={card.problem} className="rounded-xl border border-[#23242b] bg-[#14151a] p-[22px]">
          <div className="mb-[10px] font-mono text-[10px] uppercase tracking-[.1em] text-[#e46a5a]">
            The problem
          </div>
          <div className="mb-2 text-[15px] font-semibold">{card.problem}</div>
          <p className="mb-[14px] text-[12.5px] leading-relaxed text-owner-muted">{card.pain}</p>
          <div className="border-t border-[#23242b] pt-3 text-[12.5px] leading-relaxed text-[#c9cad2]">
            <span className="font-semibold text-success">VenueDash:</span> {card.solution}
          </div>
        </div>
      ))}
    </section>
  );
}
```

- [ ] **Step 2: Create `app/(marketing)/_components/HowItWorks.tsx`**

Steps rewritten per spec §4 (contract signing is manual; close-out replaces "deposit resolves itself").

```tsx
const STEPS = [
  {
    n: "01",
    title: "Renter requests",
    body: "From your public booking link. You approve or decline in one tap.",
  },
  {
    n: "02",
    title: "Contract signed",
    body: "A Georgia venue agreement is generated for the booking; you send it for signature.",
  },
  {
    n: "03",
    title: "Photo walkthrough",
    body: "Document the space before and after — locked the moment you finish.",
  },
  {
    n: "04",
    title: "Close-out",
    body: "A locked photo record and the deposit's status, on file for every event.",
  },
];

export default function HowItWorks() {
  return (
    <section className="border-t border-[#1d1e24] pb-16 pt-12">
      <div className="mb-[26px] font-mono text-[10.5px] uppercase tracking-[.12em] text-[#5e6070]">
        How a booking runs on VenueDash
      </div>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-4 md:gap-0">
        {STEPS.map((step, i) => (
          <div key={step.n} className={i < STEPS.length - 1 ? "md:pr-[14px]" : ""}>
            <div className="mb-[10px] flex items-center gap-[10px]">
              <div className="min-w-5 font-mono text-[11px] font-semibold text-owner-accent">
                {step.n}
              </div>
              {i < STEPS.length - 1 && (
                <div className="hidden flex-1 border-t-[1.5px] border-dashed border-[#2c2d35] md:block" />
              )}
            </div>
            <div className="mb-[5px] text-[13.5px] font-semibold">{step.title}</div>
            <div className="text-xs leading-relaxed text-owner-muted">{step.body}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 3: Create `app/(marketing)/_components/PricingCta.tsx`**

```tsx
import WaitlistForm from "./WaitlistForm";

export default function PricingCta() {
  return (
    <section className="mx-auto max-w-[520px] border-t border-[#1d1e24] pb-20 pt-14 text-center">
      <div className="mb-[10px] text-[32px] font-bold tracking-[-.02em]">$60/month. Flat.</div>
      <div className="mb-7 text-sm leading-[1.7] text-owner-muted">
        Cheaper than one undocumented damage dispute. First 60 days free for the first 10
        Atlanta studios — no card required.
      </div>
      <div className="flex justify-center">
        <WaitlistForm />
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Create `app/(marketing)/_components/Footer.tsx`**

```tsx
import Link from "next/link";

export default function Footer() {
  return (
    <footer className="border-t border-[#1d1e24] pb-8 pt-5">
      <p className="mb-3 text-[11px] leading-relaxed text-[#5e6070]">
        VenueDash is not a law firm and does not provide legal advice. Contract templates are
        provided as-is; have your own attorney review anything you sign.
      </p>
      <div className="flex items-center justify-between">
        <div className="font-mono text-[10px] tracking-[.05em] text-[#43444d]">
          VENUEDASH · MADE IN ATLANTA, GA
        </div>
        <div className="flex gap-4 font-mono text-[10px] tracking-[.05em]">
          <Link href="/terms" className="text-[#5e6070] hover:text-owner-muted">
            Terms
          </Link>
          <Link href="/privacy" className="text-[#5e6070] hover:text-owner-muted">
            Privacy
          </Link>
        </div>
      </div>
    </footer>
  );
}
```

- [ ] **Step 5: Complete the page assembly**

Replace `app/(marketing)/page.tsx`:

```tsx
import Header from "./_components/Header";
import Hero from "./_components/Hero";
import ProblemCards from "./_components/ProblemCards";
import HowItWorks from "./_components/HowItWorks";
import PricingCta from "./_components/PricingCta";
import Footer from "./_components/Footer";

export default function LandingPage() {
  return (
    <div className="mx-auto max-w-[960px] px-8">
      <Header />
      <Hero />
      <ProblemCards />
      <HowItWorks />
      <PricingCta />
      <Footer />
    </div>
  );
}
```

- [ ] **Step 6: Visual check against the prototype**

Run: `npm run dev`. Open `http://localhost:3000` next to `prototype/VenueDash_Prototype.dc.html` (Landing tab).
Expected: section order, spacing, card styling, step rail, and pricing block match; copy differs only where the spec rewrote it. Check a narrow window (~390px): cards stack, step rail stacks, form stays usable. Stop the server.

- [ ] **Step 7: Verify gates + commit**

Run: `npm run lint && npm run typecheck && npm test && npm run build`
Expected: all pass; `/` still `○` (static).

```bash
git add "app/(marketing)/page.tsx" "app/(marketing)/_components/ProblemCards.tsx" "app/(marketing)/_components/HowItWorks.tsx" "app/(marketing)/_components/PricingCta.tsx" "app/(marketing)/_components/Footer.tsx"
git commit -m "feat: complete landing page port — problem cards, how-it-works, pricing, footer"
```

---

### Task 5: `/terms` and `/privacy` pages

**Files:**
- Create: `app/(marketing)/terms/page.tsx`, `app/(marketing)/privacy/page.tsx`

**Interfaces:**
- Consumes: dark marketing layout (Task 3); linked from `Footer` (Task 4).
- Produces: static `/terms` and `/privacy` routes.

- [ ] **Step 1: Create `app/(marketing)/terms/page.tsx`**

```tsx
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Terms of Service — VenueDash",
};

export default function TermsPage() {
  return (
    <main className="mx-auto max-w-[680px] px-8 py-16">
      <Link href="/" className="font-mono text-[11px] text-[#5e6070] hover:text-owner-muted">
        ← VenueDash
      </Link>
      <h1 className="mb-2 mt-6 text-3xl font-bold tracking-tight">Terms of Service</h1>
      <p className="mb-1 font-mono text-[11px] text-[#5e6070]">Last updated: July 5, 2026</p>
      <p className="mb-10 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-[12.5px] leading-relaxed text-warning">
        Beta terms — under review by a Georgia attorney. They govern the free beta and will be
        finalized before paid service begins.
      </p>

      <div className="space-y-8 text-[14px] leading-[1.75] text-owner-muted [&_h2]:mb-2 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-owner-text">
        <section>
          <h2>1. What VenueDash is</h2>
          <p>
            VenueDash is software for studio owners who rent their spaces for private events. It
            generates rental contract documents from templates, stores timestamped condition
            photos, and tracks the status of bookings. VenueDash is currently offered as a free
            beta; features may change or be withdrawn while in beta.
          </p>
        </section>
        <section>
          <h2>2. Not a law firm; no legal advice</h2>
          <p>
            VenueDash is not a law firm and does not provide legal advice. Contract templates are
            general-purpose documents provided as-is. You are responsible for having your own
            attorney review any contract before you rely on it. Using VenueDash does not create an
            attorney-client relationship.
          </p>
        </section>
        <section>
          <h2>3. VenueDash never handles your money</h2>
          <p>
            VenueDash does not process payments, hold deposits, or move funds of any kind. Rent
            and damage deposits are collected, held, and refunded directly by you, outside the
            platform. Deposit information shown in VenueDash is a record you maintain, not a
            payment instrument. Any dispute about money is between you and your renter.
          </p>
        </section>
        <section>
          <h2>4. Photos and documents</h2>
          <p>
            Condition photos you capture are stored with a server-assigned timestamp and, where
            permitted, location data, and are locked against edits once a walkthrough is
            completed. VenueDash provides timestamped documentation; it does not guarantee that
            any record will be sufficient or admissible for a particular legal purpose.
          </p>
        </section>
        <section>
          <h2>5. Your account and acceptable use</h2>
          <p>
            You are responsible for activity under your account and for the accuracy of the
            information you enter. You may not use VenueDash for unlawful activity, to store
            unlawful content, or to misrepresent the condition of a space.
          </p>
        </section>
        <section>
          <h2>6. Warranty disclaimer and limitation of liability</h2>
          <p>
            VenueDash is provided &quot;as is&quot; and &quot;as available,&quot; without
            warranties of any kind, express or implied. To the maximum extent permitted by law,
            VenueDash&apos;s total liability arising out of the service will not exceed the
            amounts you paid for the service in the twelve months before the claim (during the
            free beta, $0).
          </p>
        </section>
        <section>
          <h2>7. Termination</h2>
          <p>
            You may stop using VenueDash at any time and request deletion of your data. We may
            suspend or terminate beta accounts that violate these terms, with notice where
            practical.
          </p>
        </section>
        <section>
          <h2>8. Governing law</h2>
          <p>These terms are governed by the laws of the State of Georgia, USA.</p>
        </section>
        <section>
          <h2>9. Changes</h2>
          <p>
            We may update these terms as the beta evolves. We will post the updated terms here
            and change the date above; material changes will be emailed to account holders.
          </p>
        </section>
        <section>
          <h2>10. Contact</h2>
          <p>
            Questions about these terms: <a href="mailto:tgaylord2024@gmail.com" className="text-owner-accent">tgaylord2024@gmail.com</a>.
          </p>
        </section>
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Create `app/(marketing)/privacy/page.tsx`**

```tsx
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy — VenueDash",
};

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-[680px] px-8 py-16">
      <Link href="/" className="font-mono text-[11px] text-[#5e6070] hover:text-owner-muted">
        ← VenueDash
      </Link>
      <h1 className="mb-2 mt-6 text-3xl font-bold tracking-tight">Privacy Policy</h1>
      <p className="mb-1 font-mono text-[11px] text-[#5e6070]">Last updated: July 5, 2026</p>
      <p className="mb-10 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-[12.5px] leading-relaxed text-warning">
        Beta policy — under review by a Georgia attorney.
      </p>

      <div className="space-y-8 text-[14px] leading-[1.75] text-owner-muted [&_h2]:mb-2 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-owner-text">
        <section>
          <h2>1. What we collect</h2>
          <p>
            <strong className="text-owner-text">Waitlist:</strong> your email address, when you
            join the waitlist. <strong className="text-owner-text">Studio owners:</strong> account
            details (name, email) and the studio, policy, and booking information you enter.{" "}
            <strong className="text-owner-text">Renters:</strong> contact and event details
            submitted with a booking request. <strong className="text-owner-text">Photos:</strong>{" "}
            condition photos captured during walkthroughs, with server timestamps and, where you
            permit it, location data.
          </p>
        </section>
        <section>
          <h2>2. How we use it</h2>
          <p>
            To run the product: creating contracts, storing condition documentation, tracking
            bookings, and sending transactional email about your bookings and the waitlist. We do
            not sell personal data, and we do not use it for third-party advertising.
          </p>
        </section>
        <section>
          <h2>3. Where it lives</h2>
          <p>
            VenueDash runs on established infrastructure providers: Vercel (hosting), Neon
            (database), Cloudflare R2 (photo and document storage), Clerk (owner sign-in), and
            Resend (email). Each processes data on our behalf under their own security terms.
          </p>
        </section>
        <section>
          <h2>4. Retention and deletion</h2>
          <p>
            Booking records and locked walkthrough photos are retained while the associated
            studio account is active, because they are the documentation the product exists to
            keep. To delete your waitlist entry or your account and its data, email{" "}
            <a href="mailto:tgaylord2024@gmail.com" className="text-owner-accent">tgaylord2024@gmail.com</a>.
          </p>
        </section>
        <section>
          <h2>5. Changes</h2>
          <p>
            We will post any updates here and change the date above; material changes will be
            emailed to account holders.
          </p>
        </section>
      </div>
    </main>
  );
}
```

- [ ] **Step 3: Verify in the browser**

Run: `npm run dev`. Visit `/terms` and `/privacy`.
Expected: dark pages, amber "under review" notes, readable narrow column; footer links from `/` navigate to both; "← VenueDash" returns home. Stop the server.

- [ ] **Step 4: Verify gates + commit**

Run: `npm run lint && npm run typecheck && npm test && npm run build`
Expected: all pass; `/terms` and `/privacy` are `○` (static) in the route table.

```bash
git add "app/(marketing)/terms/page.tsx" "app/(marketing)/privacy/page.tsx"
git commit -m "feat: add drafted terms and privacy pages flagged for attorney review"
```

---

### Task 6: Final verification + PR

**Files:**
- No new files. Verification and PR only.

**Interfaces:**
- Consumes: everything above.
- Produces: an open PR from `feat/phase-1-landing` with CI green and a preview deploy exercised.

- [ ] **Step 1: Run all four gates clean**

Run: `nvm use 20 && npm run lint && npm run typecheck && npm test && npm run build`
Expected: all pass. Route table shows `/`, `/terms`, `/privacy` static (`○`).

- [ ] **Step 2: Confirm protected surfaces are untouched**

Run: `git diff main --stat -- prototype/ "app/(owner)" "app/(public)" proxy.ts db/ drizzle/`
Expected: no output (zero changes).

- [ ] **Step 3: Push and open the PR**

```bash
git push -u origin feat/phase-1-landing
gh pr create --title "Phase 1: landing page + waitlist + terms/privacy" --body "$(cat <<'EOF'
## Summary
- Ports the prototype's marketing landing into `(marketing)` (dark surface), with all copy rewritten to v0.5 truth — no held-deposit / e-sign / auto-refund claims
- Waitlist CTA: `WaitlistForm` → `joinWaitlist` server action → Resend `contacts.create` (honeypot, duplicate-as-success, mailto fallback on failure)
- Drafted `/terms` and `/privacy`, visibly flagged as pending attorney review
- Spec: `docs/specs/2026-07-05-venuedash-phase-1-landing-design.md` · Plan: `docs/plans/2026-07-05-venuedash-phase-1-landing.md`

## Test plan
- [ ] CI green (lint / typecheck / test / build)
- [ ] Preview deploy: landing matches prototype visually; mobile width OK
- [ ] Waitlist submit on preview lands a contact in Resend Contacts; duplicate submit still shows success
- [ ] `/terms` + `/privacy` render and are linked from the footer
- [ ] `/dashboard` still redirects to sign-in when signed out

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4: Exercise the Vercel preview deploy**

On the PR's preview URL, walk the test plan above — especially a **real waitlist submit** (this is the one thing unit tests can't cover: the live Resend call with the production env var). Check the Resend dashboard → Contacts.

- [ ] **Step 5: Confirm exit criteria (spec §9)**

- [ ] Landing visually matches the prototype with v0.5-truthful copy.
- [ ] Waitlist form adds a contact in Resend; duplicates and failures behave as specified.
- [ ] `/terms` and `/privacy` live, linked, flagged under review.
- [ ] CI green; waitlist unit tests pass; `prototype/` untouched.

---

## Self-Review

**1. Spec coverage** (Phase 1 spec §3–§9):
- Dark `(marketing)` layout → Task 3 Step 1. ✓
- Landing page composed of section components; `WaitlistForm` the only client component → Tasks 3–4. ✓
- Copy plan §4 (hero rewrite, three cards, four steps, pricing, footer disclaimer) → Task 3 Step 3 (hero), Task 4 Steps 1–4. One deliberate change: the third card's headline "Deposits over Zelle" became "Deposit chaos" because the prototype's pain line ("no hold rules, no claim window") described v1.0 behavior; the replacement pain line stays truthful. ✓
- Waitlist flow §5: honeypot → Task 2; validation → Task 1; duplicate-as-success → Task 1; mailto fallback → Task 2; form placement (hero + pricing, header anchors) → Tasks 3–4; no confirmation email → nothing sends one. ✓
- Legal pages §6 with beta-review flag and last-updated → Task 5. ✓
- Testing §7: unit tests Tasks 1–2; CI gates every task; manual visual + live-submit verification → Tasks 3–6; single PR → Task 6. ✓
- Out of scope §8 respected: no domain work, no schema, no analytics, no extra pages. ✓

**2. Placeholder scan:** every code step contains complete, compilable code; every command has an expected result; legal pages contain full drafted text, not stubs. ✓

**3. Type consistency:** `WaitlistResult` and `addWaitlistContact(email: string)` match between Task 1 impl/test and Task 2 mock/action. `WaitlistFormState` (`status`/`message`) matches between `actions.ts`, its test, and `WaitlistForm`. `WaitlistForm({ id }: { id?: string })` matches its uses (`id="waitlist"` in Hero, prop-less in PricingCta; Header anchors `#waitlist`). ✓

**Known judgment call:** duplicate detection matches on `/already exist/i` in the Resend error message (SDK v6 has no dedicated conflict code in its error union). If Resend's message wording differs in practice, the failure mode is a visible "something went wrong" on a duplicate — caught in Task 6's preview-deploy duplicate-submit check.
