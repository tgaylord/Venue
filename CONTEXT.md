# VenueDash

Paperwork infrastructure for studio owners who rent their spaces for private events: signed contracts and timestamped condition-photo records. The owner handles the money.

## Language

### People & surfaces

**Owner**:
The studio owner — the paying customer, authenticated (Clerk), works in the dark-palette app.
_Avoid_: host (UI copy may say "your host" to renters, but code and docs say owner), user, admin

**Renter**:
The person booking the space. Has no account; their entire world is tokenized links on the warm-light public surface.
_Avoid_: guest, customer, client

### Booking lifecycle

**Booking**:
A renter's request for a space, from `pending` through `closed`/`declined`/`canceled`. Terms are snapshotted onto it at request time and never re-read from live settings.

**Effective state**:
A booking's state after read-time clock derivation (`confirmed → event_day → post_event`). UI and guards use effective state, never raw stored state.
_Avoid_: current state, real state

**Approve & send contract**:
The single owner action that accepts a request and delivers the contract: traverses `pending → awaiting_contract → awaiting_signature`, generating and emailing the contract PDF in between.
_Avoid_: approve (alone, for the v0.5 owner gesture)

**Signing kit**:
The `awaiting_signature` booking-detail card that narrates the off-platform signing step and hosts Mark signed. Signing itself happens outside VenueDash in v0.5.

**Mark signed**:
The manual owner action recording that the contract was signed off-platform; drives `awaiting_signature → confirmed`.

**Close out**:
The owner action declaring a booking truly done (event over, deposit settled off-platform). Persists any pending clock transitions, then `post_event → closed`. Owner-triggered — never automatic.
_Avoid_: archive, complete, auto-close

**Next step**:
The one action a booking currently needs from the owner, surfaced as a label on dashboard rows and as the lead action on the detail page.

### Money & evidence

**Deposit status**:
An owner-toggled record (`uncollected/collected/returned`) of money that moves entirely off-platform. VenueDash never holds deposits. Not shown to renters in v0.5 (manual data goes stale).
_Avoid_: escrow, held deposit, refund

**Walkthrough**:
A pre- or post-event condition-photo checklist run by the owner; per-photo server timestamp + geotag + SHA-256; locked (immutable) when complete.
_Avoid_: inspection, survey

**Timestamped documentation**:
The only sanctioned description of walkthrough evidence, in all copy.
_Avoid_: immutable evidence, proof, courtroom-grade
