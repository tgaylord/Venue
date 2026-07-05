import { describe, it, expect } from "vitest";
import { BOOKING_STATES, LEGAL_TRANSITIONS, TERMINAL_STATES } from "@/lib/domain/states";

describe("state machine table", () => {
  it("has exactly the 9 v0.5 states", () => {
    expect([...BOOKING_STATES].sort()).toEqual(
      ["awaiting_contract", "awaiting_signature", "canceled", "closed",
       "confirmed", "declined", "event_day", "pending", "post_event"]
    );
  });

  it("terminal states allow no transitions", () => {
    expect([...TERMINAL_STATES].sort()).toEqual(["canceled", "closed", "declined"]);
    for (const s of TERMINAL_STATES) expect(LEGAL_TRANSITIONS[s]).toEqual([]);
  });

  it("encodes exactly the v0.5 spec transitions", () => {
    expect(LEGAL_TRANSITIONS.pending).toEqual(["declined", "awaiting_contract", "canceled"]);
    expect(LEGAL_TRANSITIONS.awaiting_contract).toEqual(["awaiting_signature", "canceled"]);
    expect(LEGAL_TRANSITIONS.awaiting_signature).toEqual(["confirmed", "canceled"]);
    expect(LEGAL_TRANSITIONS.confirmed).toEqual(["event_day", "canceled"]);
    expect(LEGAL_TRANSITIONS.event_day).toEqual(["post_event"]);
    expect(LEGAL_TRANSITIONS.post_event).toEqual(["closed"]);
  });

  it("every transition target is a known state", () => {
    for (const s of BOOKING_STATES)
      for (const t of LEGAL_TRANSITIONS[s]) expect(BOOKING_STATES).toContain(t);
  });
});
