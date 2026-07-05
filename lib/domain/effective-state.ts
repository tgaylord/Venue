import type { BookingState } from "./states";

/**
 * Read-time derivation of clock-driven states (spec §6): the stored state
 * lags the clock between cron runs, so reads derive the effective state.
 * Persisting these transitions is a later phase.
 */
export function deriveEffectiveState(
  b: { state: BookingState; startsAt: Date; endsAt: Date },
  now: Date
): BookingState {
  if (b.state === "confirmed") {
    if (now > b.endsAt) return "post_event";
    if (now >= b.startsAt) return "event_day";
    return "confirmed";
  }
  if (b.state === "event_day" && now > b.endsAt) return "post_event";
  return b.state;
}
