export const BOOKING_STATES = [
  "pending", "declined", "awaiting_contract", "awaiting_signature",
  "confirmed", "event_day", "post_event", "closed", "canceled",
] as const;

export type BookingState = (typeof BOOKING_STATES)[number];

/**
 * The v0.5 booking state machine — a strict subset of the v1.0 enum,
 * same state names (spec §4). This table is the single source of truth;
 * transitionBooking() enforces it and tests iterate it.
 */
export const LEGAL_TRANSITIONS: Record<BookingState, readonly BookingState[]> = {
  pending: ["declined", "awaiting_contract", "canceled"],
  awaiting_contract: ["awaiting_signature", "canceled"],
  awaiting_signature: ["confirmed", "canceled"],
  confirmed: ["event_day", "canceled"],
  event_day: ["post_event"],
  post_event: ["closed"],
  declined: [],
  closed: [],
  canceled: [],
};

export const TERMINAL_STATES: readonly BookingState[] = BOOKING_STATES.filter(
  (s) => LEGAL_TRANSITIONS[s].length === 0
);
