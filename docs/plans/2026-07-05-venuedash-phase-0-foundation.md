# VenueDash Phase 0 — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a deployable Next.js skeleton with owner auth, database, object storage, and email wired — so a signed-in owner sees an empty dashboard shell on a Vercel deploy with CI green.

**Architecture:** A single Next.js (App Router, TypeScript) app at the repo root. Three route groups partition the surfaces — `(marketing)` (public landing), `(public)` (renter, no account), `(owner)` (Clerk-gated). Postgres via Drizzle + Neon serverless driver; photos will live in Cloudflare R2 (S3-compatible); transactional email via Resend. This phase builds only the wiring and one smoke path through each dependency — no product features.

**Tech Stack:** Next.js 15 (App Router) · React 19 · TypeScript · Tailwind CSS v4 (CSS-first `@theme`) · Clerk (`@clerk/nextjs` v6) · Drizzle ORM + `@neondatabase/serverless` + `drizzle-kit` · AWS SDK v3 (`@aws-sdk/client-s3` + `s3-request-presigner`) for R2 · Resend + React Email · Vitest for unit tests · GitHub Actions CI · Vercel hosting.

## Global Constraints

_Every task's requirements implicitly include this section. Values copied verbatim from the v0.5 spec (`docs/specs/2026-07-05-venuedash-v0.5-design.md`) and full-scope `docs/v1.0-vision/ARCHITECTURE.md`._

- **Single app, three route groups:** one Next.js App Router app at repo root; route groups `(marketing)`, `(public)`, `(owner)`. The `(owner)` group is Clerk-gated; `(public)` and `(marketing)` are open.
- **Do NOT touch `prototype/`** — it is the visual spec of record. Leave `prototype/`, `README.md`, `LICENSE`, `.github/workflows/claude*.yml`, and `docs/` intact.
- **NOT in v0.5 (do not add these deps):** Stripe, DocuSign. This phase adds Clerk, Neon/Drizzle, R2 (AWS SDK), Resend only.
- **Owner surface design tokens (dark):** bg `#0b0c0f`, panel `#16171c` / `#16181e`, border `#26272e`, text `#e9eaee` / muted `#9a9ca8`, accent `#7a86ff`, success `#5fd68b`, warning `#e6b054`, danger `#ef6f54`.
- **Renter/public surface tokens (warm light):** bg `#f7f5f0`, ink `#211f1a`, border `#ddd7c6`, ok `#4d7c4a`.
- **Fonts:** Instrument Sans (UI), Instrument Serif (renter-facing display), IBM Plex Mono (metadata/labels). Load via `next/font/google`.
- **`.env.example` must name every secret** (no values). Infra target is ~$0/mo on free tiers.
- **Language discipline (product-wide):** user-facing copy says "timestamped documentation," never "evidence"/"immutable proof." (No user copy in Phase 0, but keep it in mind for any placeholder text.)
- **Node:** target Node 20 LTS (Vercel default) in CI and `package.json` `engines`.

---

## File Structure

Files created in this phase (each has one responsibility):

```
package.json, tsconfig.json, next.config.ts, postcss.config.mjs   → app config
.gitignore (merged), .env.example, .nvmrc                          → env/config
eslint.config.mjs, vitest.config.ts                                → lint + test
middleware.ts                                                      → Clerk route protection
app/layout.tsx                                                     → root layout: fonts + ClerkProvider
app/globals.css                                                    → Tailwind import + @theme design tokens
app/(marketing)/page.tsx                                           → landing placeholder ("/")
app/(marketing)/layout.tsx                                         → light-surface wrapper
app/(public)/status/page.tsx                                       → renter placeholder
app/(public)/layout.tsx                                            → light-surface wrapper
app/(owner)/layout.tsx                                             → dark-surface wrapper + SignedIn chrome
app/(owner)/dashboard/page.tsx                                     → empty dashboard shell (gated)
app/sign-in/[[...sign-in]]/page.tsx, app/sign-up/[[...sign-up]]/page.tsx → Clerk auth pages
lib/db.ts                                                          → Drizzle + Neon connection
db/schema.ts                                                       → Drizzle schema (empty in Phase 0)
drizzle.config.ts                                                  → drizzle-kit config
scripts/db-healthcheck.ts                                          → SELECT 1 smoke script
lib/storage.ts                                                     → R2 client + signed-URL helpers
lib/storage.test.ts                                                → unit test (offline presign)
lib/email.ts + emails/TestEmail.tsx                               → Resend client + one template
lib/email.test.ts                                                  → unit test (offline render)
.github/workflows/ci.yml                                           → lint + typecheck + build on PR
README.md (append "Development setup" section)
```

---

### Task 1: Scaffold Next.js app at repo root (preserving existing files)

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`, `eslint.config.mjs`, `app/layout.tsx`, `app/globals.css`, `app/(marketing)/page.tsx`, `.gitignore` (merged), `.nvmrc`
- Preserve untouched: `prototype/`, `docs/`, `LICENSE`, `.github/workflows/claude*.yml`

**Interfaces:**
- Produces: a buildable Next.js app; `npm run dev`, `npm run build`, `npm run lint` scripts; `app/globals.css` imported by `app/layout.tsx`.

- [ ] **Step 1: Scaffold into a temp dir, then merge into the repo root**

`create-next-app` refuses to run in a non-empty dir, so scaffold aside and copy in, keeping our `README.md`/`LICENSE`/`prototype/`/`docs/`.

```bash
cd /Users/trentg/Claude/Projects/Venue
npx create-next-app@latest ../venue-scaffold \
  --ts --app --tailwind --eslint --src-dir=false \
  --import-alias "@/*" --use-npm --no-turbopack --yes
# Copy everything except the scaffold's README and its .git, without clobbering ours
rsync -a --exclude='.git' --exclude='README.md' ../venue-scaffold/ ./
rm -rf ../venue-scaffold
```

- [ ] **Step 2: Merge `.gitignore` so Next.js artifacts are ignored**

Ensure these lines exist in `.gitignore` (append any missing):

```
# dependencies
/node_modules
# next.js
/.next/
/out/
# env
.env
.env*.local
# vercel / typescript
.vercel
*.tsbuildinfo
next-env.d.ts
```

- [ ] **Step 3: Pin Node version**

Create `.nvmrc`:

```
20
```

Add to `package.json` (top level):

```json
"engines": { "node": ">=20 <21" }
```

- [ ] **Step 4: Install and build to verify the scaffold**

Run:
```bash
npm install
npm run build
```
Expected: build completes successfully, prints a route table including `/`. No type errors.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: scaffold Next.js app at repo root (App Router, TS, Tailwind)"
```

---

### Task 2: Design tokens + fonts

**Files:**
- Modify: `app/globals.css` (replace scaffold contents), `app/layout.tsx`
- Test: manual visual check

**Interfaces:**
- Produces: Tailwind theme tokens (`--color-owner-bg`, `--color-owner-accent`, `--color-renter-bg`, etc.) usable as `bg-owner-bg`, `text-owner-accent`, `font-sans`, `font-serif`, `font-mono`; three font CSS variables set on `<body>`.

- [ ] **Step 1: Write `app/globals.css` with Tailwind v4 `@theme` tokens**

Replace the entire file:

```css
@import "tailwindcss";

@theme {
  /* Owner surface (dark) */
  --color-owner-bg: #0b0c0f;
  --color-owner-panel: #16171c;
  --color-owner-panel-2: #16181e;
  --color-owner-border: #26272e;
  --color-owner-text: #e9eaee;
  --color-owner-muted: #9a9ca8;
  --color-owner-accent: #7a86ff;
  --color-success: #5fd68b;
  --color-warning: #e6b054;
  --color-danger: #ef6f54;

  /* Renter/public surface (warm light) */
  --color-renter-bg: #f7f5f0;
  --color-renter-ink: #211f1a;
  --color-renter-border: #ddd7c6;
  --color-renter-ok: #4d7c4a;

  /* Fonts (variables set by next/font in layout) */
  --font-sans: var(--font-instrument-sans), ui-sans-serif, system-ui, sans-serif;
  --font-serif: var(--font-instrument-serif), ui-serif, Georgia, serif;
  --font-mono: var(--font-ibm-plex-mono), ui-monospace, monospace;
}

html, body { height: 100%; }
body { font-family: var(--font-sans); }
```

- [ ] **Step 2: Wire fonts + base body classes in `app/layout.tsx`**

Replace the file:

```tsx
import type { Metadata } from "next";
import { Instrument_Sans, Instrument_Serif, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

const sans = Instrument_Sans({ subsets: ["latin"], variable: "--font-instrument-sans" });
const serif = Instrument_Serif({ subsets: ["latin"], weight: "400", variable: "--font-instrument-serif" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-ibm-plex-mono" });

export const metadata: Metadata = {
  title: "VenueDash",
  description: "Paperwork infrastructure for studio owners who rent for private events.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${serif.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
```

_Note: `ClerkProvider` is added to this file in Task 3 — do not add it yet._

- [ ] **Step 3: Put a token/font smoke check on the landing placeholder**

Replace `app/(marketing)/page.tsx`:

```tsx
export default function LandingPlaceholder() {
  return (
    <main className="min-h-screen bg-renter-bg text-renter-ink flex flex-col items-center justify-center gap-3 p-8">
      <h1 className="font-serif text-4xl">VenueDash</h1>
      <p className="font-mono text-sm text-renter-ink/70">foundation skeleton — phase 0</p>
      <span className="rounded-full px-3 py-1 text-xs font-mono bg-owner-accent text-white">tokens OK</span>
    </main>
  );
}
```

- [ ] **Step 4: Run dev and verify visually**

Run:
```bash
npm run dev
```
Visit `http://localhost:3000`. Expected: warm off-white (`#f7f5f0`) background, serif heading, mono subtitle, an indigo (`#7a86ff`) pill. Stop the server (Ctrl-C).

- [ ] **Step 5: Verify production build still passes**

Run: `npm run build`
Expected: success, no errors.

- [ ] **Step 6: Commit**

```bash
git add app/globals.css app/layout.tsx "app/(marketing)/page.tsx"
git commit -m "feat: port design tokens and fonts into Tailwind theme"
```

---

### Task 3: Clerk auth + route protection + owner dashboard shell

**Files:**
- Create: `middleware.ts`, `app/sign-in/[[...sign-in]]/page.tsx`, `app/sign-up/[[...sign-up]]/page.tsx`, `app/(owner)/layout.tsx`, `app/(owner)/dashboard/page.tsx`, `app/(public)/layout.tsx`, `app/(public)/status/page.tsx`, `app/(marketing)/layout.tsx`
- Modify: `app/layout.tsx` (wrap in `ClerkProvider`), `.env.example`

**Interfaces:**
- Consumes: fonts/tokens from Task 2.
- Produces: `middleware.ts` protecting `/dashboard(.*)`; `/dashboard` renders an empty owner shell only when signed in; `/sign-in` + `/sign-up` routes exist.

- [ ] **Step 1: Install Clerk**

Run: `npm install @clerk/nextjs`

- [ ] **Step 2: Add Clerk env vars to `.env.example`**

Append (names only, no values):

```
# Clerk (https://dashboard.clerk.com → API keys)
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL=/dashboard
NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL=/dashboard
```

Also create a local `.env.local` (git-ignored) with your real Clerk test keys so dev works. Get them from a free Clerk application at dashboard.clerk.com.

- [ ] **Step 3: Wrap the root layout in `ClerkProvider`**

Edit `app/layout.tsx` — import and wrap:

```tsx
import { ClerkProvider } from "@clerk/nextjs";
// ...existing imports...

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      <html lang="en" className={`${sans.variable} ${serif.variable} ${mono.variable}`}>
        <body>{children}</body>
      </html>
    </ClerkProvider>
  );
}
```

- [ ] **Step 4: Create `middleware.ts` protecting the owner group**

```ts
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const isProtected = createRouteMatcher(["/dashboard(.*)"]);

export default clerkMiddleware(async (auth, req) => {
  if (isProtected(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: ["/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpg|jpeg|png|gif|svg|ico|webp|woff2?)).*)", "/(api|trpc)(.*)"],
};
```

- [ ] **Step 5: Create the sign-in and sign-up pages**

`app/sign-in/[[...sign-in]]/page.tsx`:

```tsx
import { SignIn } from "@clerk/nextjs";

export default function Page() {
  return (
    <main className="min-h-screen bg-owner-bg flex items-center justify-center p-8">
      <SignIn />
    </main>
  );
}
```

`app/sign-up/[[...sign-up]]/page.tsx`:

```tsx
import { SignUp } from "@clerk/nextjs";

export default function Page() {
  return (
    <main className="min-h-screen bg-owner-bg flex items-center justify-center p-8">
      <SignUp />
    </main>
  );
}
```

- [ ] **Step 6: Create the owner layout (dark) with sign-out chrome**

`app/(owner)/layout.tsx`:

```tsx
import { UserButton } from "@clerk/nextjs";

export default function OwnerLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-owner-bg text-owner-text">
      <header className="flex items-center justify-between border-b border-owner-border px-6 py-4">
        <span className="font-mono text-sm tracking-wide text-owner-muted">VENUEDASH</span>
        <UserButton />
      </header>
      <div className="p-6">{children}</div>
    </div>
  );
}
```

- [ ] **Step 7: Create the empty dashboard shell**

`app/(owner)/dashboard/page.tsx`:

```tsx
export default function Dashboard() {
  return (
    <main className="mx-auto max-w-3xl">
      <h1 className="font-serif text-3xl">Dashboard</h1>
      <p className="mt-2 font-mono text-sm text-owner-muted">
        No studio configured yet — foundation skeleton (phase 0).
      </p>
      <div className="mt-8 rounded-lg border border-owner-border bg-owner-panel p-8 text-owner-muted">
        Bookings will appear here.
      </div>
    </main>
  );
}
```

- [ ] **Step 8: Create light-surface layouts + a public placeholder**

`app/(marketing)/layout.tsx` and `app/(public)/layout.tsx` (identical light wrapper):

```tsx
export default function LightLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-renter-bg text-renter-ink">{children}</div>;
}
```

`app/(public)/status/page.tsx`:

```tsx
export default function StatusPlaceholder() {
  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <p className="font-mono text-sm text-renter-ink/70">Renter surface — phase 0 placeholder.</p>
    </main>
  );
}
```

- [ ] **Step 9: Verify protection manually**

Run: `npm run dev`
- Visit `/dashboard` while signed out → expected: redirected to `/sign-in`.
- Sign up with a test email, then land on `/dashboard` → expected: dark shell with "Dashboard" heading and a working user button.
- Visit `/` and `/status` signed out → expected: both render (no redirect).
Stop the server.

- [ ] **Step 10: Verify build + commit**

Run: `npm run build` → expected: success.

```bash
git add -A
git commit -m "feat: add Clerk auth, protect owner routes, empty dashboard shell"
```

---

### Task 4: Drizzle + Neon connection and empty initial migration

**Files:**
- Create: `lib/db.ts`, `db/schema.ts`, `drizzle.config.ts`, `scripts/db-healthcheck.ts`
- Create (generated): `drizzle/` migration folder
- Modify: `.env.example`, `package.json` (scripts)

**Interfaces:**
- Consumes: nothing from prior tasks.
- Produces: `db` (Drizzle client) exported from `lib/db.ts`; `db/schema.ts` as the single schema entrypoint (empty in Phase 0); `npm run db:generate` and `npm run db:migrate` scripts.

- [ ] **Step 1: Install Drizzle + Neon driver**

Run:
```bash
npm install drizzle-orm @neondatabase/serverless
npm install -D drizzle-kit tsx
```

- [ ] **Step 2: Add DB env var to `.env.example`**

Append:

```
# Neon Postgres (https://neon.tech → connection string, pooled)
DATABASE_URL=
```

Put the real pooled connection string in `.env.local`.

- [ ] **Step 3: Create the schema entrypoint (empty for Phase 0)**

`db/schema.ts`:

```ts
// VenueDash schema. Tables are added in Phase 2 (Domain core).
// Keeping this file as the single Drizzle schema entrypoint from Phase 0.
export {};
```

- [ ] **Step 4: Create the Drizzle client**

`lib/db.ts`:

```ts
import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import * as schema from "@/db/schema";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");

export const sql = neon(url);
export const db = drizzle(sql, { schema });
```

- [ ] **Step 5: Create `drizzle.config.ts`**

```ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL! },
});
```

- [ ] **Step 6: Add DB scripts to `package.json`**

Add under `"scripts"`:

```json
"db:generate": "drizzle-kit generate",
"db:migrate": "drizzle-kit migrate",
"db:healthcheck": "tsx scripts/db-healthcheck.ts"
```

- [ ] **Step 7: Generate the (empty) initial migration**

Run:
```bash
export $(grep -v '^#' .env.local | xargs) && npm run db:generate
```
Expected: a `drizzle/0000_*.sql` file is created (empty or metadata-only) plus a `drizzle/meta/` folder.

- [ ] **Step 8: Write and run the connection healthcheck**

`scripts/db-healthcheck.ts`:

```ts
import { sql } from "@/lib/db";

async function main() {
  const rows = await sql`SELECT 1 AS ok`;
  if (rows[0]?.ok !== 1) throw new Error("Healthcheck failed");
  console.log("DB healthcheck OK:", rows[0]);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

Run:
```bash
export $(grep -v '^#' .env.local | xargs) && npm run db:healthcheck
```
Expected: prints `DB healthcheck OK: { ok: 1 }`.

- [ ] **Step 9: Apply the migration + commit**

Run:
```bash
export $(grep -v '^#' .env.local | xargs) && npm run db:migrate
```
Expected: "migrations applied" (no tables yet — that's correct).

```bash
git add lib/db.ts db/schema.ts drizzle.config.ts scripts/db-healthcheck.ts drizzle/ package.json .env.example
git commit -m "feat: wire Drizzle + Neon with empty initial migration and healthcheck"
```

---

### Task 5: R2 storage client + signed-URL helpers (unit-tested)

**Files:**
- Create: `lib/storage.ts`, `lib/storage.test.ts`, `vitest.config.ts`
- Modify: `.env.example`, `package.json` (test script + deps)

**Interfaces:**
- Consumes: nothing from prior tasks.
- Produces: `getSignedUploadUrl(key: string, contentType: string, expiresInSeconds?: number): Promise<string>` and `getSignedDownloadUrl(key: string, expiresInSeconds?: number): Promise<string>` from `lib/storage.ts`. Keys follow `studios/{studioId}/bookings/{bookingId}/{pre|post}/{itemId}.jpg` (used from Phase 7).

- [ ] **Step 1: Install AWS SDK + Vitest**

Run:
```bash
npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
npm install -D vitest
```

- [ ] **Step 2: Add R2 env vars to `.env.example`**

Append:

```
# Cloudflare R2 (S3-compatible) — private bucket for condition photos
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=
```

- [ ] **Step 3: Add the test script + Vitest config**

`vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: { environment: "node" },
  resolve: { alias: { "@": path.resolve(__dirname, ".") } },
});
```

Add to `package.json` scripts:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 4: Write the failing test**

`lib/storage.test.ts`:

```ts
import { describe, it, expect, beforeAll } from "vitest";
import { getSignedUploadUrl, getSignedDownloadUrl } from "@/lib/storage";

beforeAll(() => {
  process.env.R2_ACCOUNT_ID = "test-account";
  process.env.R2_ACCESS_KEY_ID = "test-key";
  process.env.R2_SECRET_ACCESS_KEY = "test-secret";
  process.env.R2_BUCKET = "venue-photos";
});

describe("storage signed URLs", () => {
  it("produces an upload URL for a key against the R2 endpoint", async () => {
    const url = await getSignedUploadUrl("studios/s1/bookings/b1/pre/item1.jpg", "image/jpeg");
    expect(url).toContain("test-account.r2.cloudflarestorage.com");
    expect(url).toContain("venue-photos");
    expect(url).toContain("item1.jpg");
    expect(url).toContain("X-Amz-Signature");
  });

  it("produces a download URL for a key", async () => {
    const url = await getSignedDownloadUrl("studios/s1/bookings/b1/post/item2.jpg");
    expect(url).toContain("item2.jpg");
    expect(url).toContain("X-Amz-Expires");
  });
});
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `npm test -- lib/storage.test.ts`
Expected: FAIL — cannot resolve `@/lib/storage` / functions not defined.

- [ ] **Step 6: Implement `lib/storage.ts`**

```ts
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

function client() {
  const accountId = process.env.R2_ACCOUNT_ID;
  if (!accountId) throw new Error("R2_ACCOUNT_ID is not set");
  return new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  });
}

function bucket() {
  const b = process.env.R2_BUCKET;
  if (!b) throw new Error("R2_BUCKET is not set");
  return b;
}

export async function getSignedUploadUrl(
  key: string,
  contentType: string,
  expiresInSeconds = 300
): Promise<string> {
  const cmd = new PutObjectCommand({ Bucket: bucket(), Key: key, ContentType: contentType });
  return getSignedUrl(client(), cmd, { expiresIn: expiresInSeconds });
}

export async function getSignedDownloadUrl(key: string, expiresInSeconds = 300): Promise<string> {
  const cmd = new GetObjectCommand({ Bucket: bucket(), Key: key });
  return getSignedUrl(client(), cmd, { expiresIn: expiresInSeconds });
}
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `npm test -- lib/storage.test.ts`
Expected: PASS (both tests). Presigning is local crypto — no network needed.

- [ ] **Step 8: Commit**

```bash
git add lib/storage.ts lib/storage.test.ts vitest.config.ts package.json .env.example
git commit -m "feat: add R2 storage client with signed-URL helpers (tested)"
```

---

### Task 6: Resend email client + one test template (unit-tested)

**Files:**
- Create: `lib/email.ts`, `emails/TestEmail.tsx`, `lib/email.test.ts`
- Modify: `.env.example`, `package.json` (deps)

**Interfaces:**
- Consumes: nothing from prior tasks.
- Produces: `renderTestEmail(props: { name: string }): Promise<string>` and `sendEmail(args: { to: string; subject: string; html: string }): Promise<void>` from `lib/email.ts`.

- [ ] **Step 1: Install Resend + React Email**

Run:
```bash
npm install resend @react-email/components @react-email/render
```

- [ ] **Step 2: Add email env vars to `.env.example`**

Append:

```
# Resend (https://resend.com → API keys). Verify a sending domain's DNS early.
RESEND_API_KEY=
EMAIL_FROM="VenueDash <noreply@venuedash.com>"
```

- [ ] **Step 3: Create the test email template**

`emails/TestEmail.tsx`:

```tsx
import { Html, Body, Container, Heading, Text } from "@react-email/components";

export default function TestEmail({ name }: { name: string }) {
  return (
    <Html>
      <Body style={{ fontFamily: "sans-serif", backgroundColor: "#f7f5f0" }}>
        <Container style={{ padding: 24 }}>
          <Heading>VenueDash</Heading>
          <Text>Hello {name} — email wiring works (phase 0).</Text>
        </Container>
      </Body>
    </Html>
  );
}
```

- [ ] **Step 4: Write the failing test**

`lib/email.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { renderTestEmail } from "@/lib/email";

describe("email rendering", () => {
  it("renders the test template to HTML containing the name", async () => {
    const html = await renderTestEmail({ name: "Trent" });
    expect(html).toContain("VenueDash");
    expect(html).toContain("Trent");
    expect(html).toContain("<html");
  });
});
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `npm test -- lib/email.test.ts`
Expected: FAIL — `@/lib/email` / `renderTestEmail` not defined.

- [ ] **Step 6: Implement `lib/email.ts`**

```ts
import { Resend } from "resend";
import { render } from "@react-email/render";
import TestEmail from "@/emails/TestEmail";

export async function renderTestEmail(props: { name: string }): Promise<string> {
  return render(TestEmail(props));
}

export async function sendEmail(args: { to: string; subject: string; html: string }): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY is not set");
  const resend = new Resend(key);
  const { error } = await resend.emails.send({
    from: process.env.EMAIL_FROM ?? "VenueDash <onboarding@resend.dev>",
    to: args.to,
    subject: args.subject,
    html: args.html,
  });
  if (error) throw new Error(`Resend send failed: ${error.message}`);
}
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `npm test -- lib/email.test.ts`
Expected: PASS (rendering is offline; no API key required).

- [ ] **Step 8: Run the full test suite**

Run: `npm test`
Expected: all tests pass (storage + email).

- [ ] **Step 9: Commit**

```bash
git add lib/email.ts emails/TestEmail.tsx lib/email.test.ts package.json .env.example
git commit -m "feat: add Resend email client and test template (tested)"
```

---

### Task 7: CI (GitHub Actions) + README dev-setup + final verification

**Files:**
- Create: `.github/workflows/ci.yml`
- Modify: `README.md` (append "Development setup"), `package.json` (ensure `typecheck` script)

**Interfaces:**
- Consumes: `npm run lint`, `npm run test`, `npm run build` from prior tasks.
- Produces: a CI workflow that runs lint + typecheck + test + build on every PR and push to non-main branches.

- [ ] **Step 1: Add a `typecheck` script**

Add to `package.json` scripts:

```json
"typecheck": "tsc --noEmit"
```

- [ ] **Step 2: Verify the four gates pass locally**

Run:
```bash
npm run lint && npm run typecheck && npm test && npm run build
```
Expected: all four succeed. Fix any lint/type errors before proceeding.

- [ ] **Step 3: Create the CI workflow**

`.github/workflows/ci.yml`:

```yaml
name: CI
on:
  pull_request:
  push:
    branches-ignore: [main]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - run: npm test
      - run: npm run build
        env:
          # Build needs public Clerk key present; use a dummy so the build compiles in CI.
          NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: pk_test_ci-placeholder
          CLERK_SECRET_KEY: sk_test_ci-placeholder
```

_Note: if `npm run build` still fails in CI due to Clerk requiring valid keys at build time, wrap the affected pages with `export const dynamic = "force-dynamic"` or move Clerk key reads to request time. Confirm the build passes in CI before merging._

- [ ] **Step 4: Append the "Development setup" section to `README.md`**

Add at the end of `README.md`:

```markdown
## Development setup (VenueDash app)

1. `nvm use` (Node 20) and `npm install`.
2. Copy `.env.example` → `.env.local` and fill in values:
   - **Clerk** — create a free app at dashboard.clerk.com, copy the test keys.
   - **Neon** — create a free Postgres at neon.tech, copy the pooled `DATABASE_URL`.
   - **R2** — create a Cloudflare R2 bucket + API token (`R2_*`).
   - **Resend** — create an API key at resend.com; verify a sending domain's DNS.
3. `npm run db:migrate` to apply migrations.
4. `npm run dev` and open http://localhost:3000.

Scripts: `npm run dev | build | lint | typecheck | test | db:generate | db:migrate | db:healthcheck`.
```

- [ ] **Step 5: Connect Vercel (manual, one-time)**

This is a console step, not code:
1. At vercel.com, "Add New Project" → import `tgaylord/Venue`.
2. Framework preset: Next.js. Add all env vars from `.env.example` (real values) under Project Settings → Environment Variables (Production + Preview).
3. Enable "Preview Deployments" (on by default).
4. Trigger a deploy; confirm `/` loads and `/dashboard` redirects to sign-in on the deployed URL, and signing in shows the dark shell.

- [ ] **Step 6: Commit + open PR**

```bash
git add .github/workflows/ci.yml README.md package.json
git commit -m "ci: add lint/typecheck/test/build workflow; document dev setup"
```

Then push the branch and open a PR; confirm the CI workflow runs green on the PR.

- [ ] **Step 7: Confirm exit criteria**

Verify all of:
- [ ] A signed-in owner sees the empty dark dashboard shell on the Vercel deploy.
- [ ] Signed-out `/dashboard` redirects to `/sign-in`.
- [ ] `/` and `/status` render without auth.
- [ ] `npm test` passes (storage + email).
- [ ] CI is green on the PR.
- [ ] `prototype/` is unchanged (`git log -- prototype/` shows no Phase 0 commits).

---

## Self-Review

**1. Spec coverage** (Phase 0 exit criteria from `IMPLEMENTATION_PLAN.md` §Phase 0 + v0.5 spec §5 Phase 0):
- Scaffold Next.js (App Router, TS, Tailwind), keep `prototype/` → Task 1. ✓
- Tailwind tokens + three fonts → Task 2. ✓
- Route groups `(marketing)`/`(public)`/`(owner)` + Clerk middleware on owner → Task 3. ✓
- Drizzle + Neon, drizzle-kit migrations, empty initial migration, `db/schema.ts` → Task 4. ✓
- R2 client + signed-URL helpers in `lib/storage.ts` → Task 5. ✓
- Resend `lib/email.ts` with one test template → Task 6. ✓
- `.env.example` with every secret → accreted across Tasks 3–6, documented in Task 7. ✓
- CI (lint/typecheck/build on PR) + Vercel previews → Task 7. ✓ (build added to CI; typecheck added beyond the spec's minimum.)
- Exit: signed-in owner sees empty dashboard shell on Vercel; CI green → Task 7 Step 7. ✓
- **Note (not in original spec, correctly deferred):** no Stripe/DocuSign deps added — matches v0.5 Global Constraints. ✓

**2. Placeholder scan:** No "TBD/TODO/handle edge cases" left; every code step shows complete code; every command has expected output. The `emails/` and route placeholders contain real, compilable content. ✓

**3. Type consistency:** `getSignedUploadUrl`/`getSignedDownloadUrl` signatures match between the test (Task 5 Step 4), interface block, and impl (Step 6). `renderTestEmail`/`sendEmail` match between Task 6 test, interface block, and impl. `db`/`sql` exports from `lib/db.ts` (Task 4) are consumed by `scripts/db-healthcheck.ts` (same task) consistently. Tailwind token names (`owner-bg`, `owner-accent`, `renter-bg`, `renter-ink`, etc.) defined in Task 2 Step 1 match usages in Tasks 2–3. ✓

**Known follow-up flagged inline:** Clerk build-time key requirement in CI (Task 7 Step 3 note) — resolve if the CI build fails.
