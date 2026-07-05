# v1.0 Vision — deferred full-scope plan

These two documents are the **full-scope architecture and roadmap** for VenueDash. They are **not** what we build first.

A four-lens pressure-test (technical, sequencing, legal, solo-founder operations) concluded that the money-holding layer — VenueDash charging, holding, and adjudicating strangers' damage deposits — is simultaneously the slowest to build, the highest legal exposure (possible unlicensed money transmission; likely a Stripe Connect ToS violation), and the heaviest ongoing operational burden for a solo student founder. It is therefore **deferred behind a paying-customer gate**.

What we build first is **v0.5** — the "paperwork spine" — specified in [`../specs/2026-07-05-venuedash-v0.5-design.md`](../specs/2026-07-05-venuedash-v0.5-design.md).

- **`ARCHITECTURE.md`** — the locked full-scope architecture (13-table data model, complete booking state machine, Stripe Connect escrow, DocuSign e-sign, COI, claims). Treat as the v1.0 target of record.
- **`IMPLEMENTATION_PLAN.md`** — the original 11-phase build plan.

**Relationship to v0.5:** v0.5 is a strict subset. The v0.5 state-machine enum uses the *same state names* as the full machine so v1.0 *extends* it rather than renaming. v1.0 re-introduces (in demand-validated order): Stripe deposit handling (revisited with a written Stripe sign-off and, if pursued, an owner-as-merchant model), the claim/dispute flow (built after observing real disputes handled manually), COI collection (as "collect & pass to owner," never "verify"), and the restored full state machine and clock/cron machinery.
