# VenueDash

Paperwork infrastructure for Atlanta studio owners who rent for private events — signed contracts, timestamped condition photos, and deposit management in one place.

## Running the prototype

```
open prototype/VenueDash_Prototype.dc.html
```

No build step. File loads React from unpkg and runs entirely in the browser. The prototype chrome at the top lets you switch between the marketing landing page, the studio-owner app, and the renter mini-site.

## What the prototype covers

| Surface | Screens |
|---|---|
| Marketing landing | Hero, feature cards, how-it-works, pricing CTA |
| Studio owner app | Dashboard, booking detail (all lifecycle states), day-of photo checklist, damage claim form, onboarding wizard |
| Renter mini-site | Public booking page, intake form, review & submit, contract signing, COI upload, deposit payment |

## Project status

Prototype complete. Full implementation spec coming next.

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
