# Clock states persist lazily, at owner close-out

`event_day` and `post_event` are derived at read time (`lib/domain/effective-state.ts`); a booking's stored state stays `confirmed` until something writes. Decided 2026-07-07: the write happens **lazily, inside the owner's Close out action** — `closeOutBooking` persists the pending clock transitions and then closes (`confirmed → event_day → post_event → closed`, each hop via `transitionBooking`, full audit trail) — rather than via a cron that persists clock transitions as they occur, or auto-close on post-walkthrough lock.

Why: a cron adds infrastructure (and the free tier can't run sub-daily) for no user-visible benefit at v0.5 volume; auto-close-on-lock closes bookings while the off-platform deposit return may still be pending, and does nothing for skipped-walkthrough bookings, which would remain unclosable. Owner-triggered close-out keeps "truly done" a human judgment (deposit settled, no issues) and gives every booking the same exit.

Consequence: `booking_events` timestamps for `event_day`/`post_event` hops record *when the owner closed out*, not when the clock actually crossed — the derived-state logic remains the truth for "when did this become post_event." v1.0's planned clock-state persistence should supersede this ADR if it lands a scheduler.
