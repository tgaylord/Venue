import { describe, it, expect } from "vitest";
import { BOOKING_STATES } from "./states";
import { renterNarration } from "./renter-narration";

describe("renterNarration", () => {
  it("returns a narration for every booking state", () => {
    for (const state of BOOKING_STATES) {
      const n = renterNarration(state);
      expect(n.heading).toBeTruthy();
      expect(n.body).toBeTruthy();
    }
  });

  it("includes the condition-documentation note only for post-confirmation states", () => {
    expect(renterNarration("confirmed").note).toBeTruthy();
    expect(renterNarration("event_day").note).toBeTruthy();
    expect(renterNarration("post_event").note).toBeTruthy();
    expect(renterNarration("pending").note).toBeUndefined();
    expect(renterNarration("awaiting_signature").note).toBeUndefined();
    expect(renterNarration("closed").note).toBeUndefined();
  });

  it("never uses 'immutable evidence'", () => {
    for (const state of BOOKING_STATES) {
      const n = renterNarration(state);
      const all = `${n.heading} ${n.body} ${n.note ?? ""}`;
      expect(all).not.toMatch(/immutable evidence/i);
    }
  });

  it("awaiting_signature says host will arrange signing, not 'signing request will arrive'", () => {
    const n = renterNarration("awaiting_signature");
    expect(n.body).not.toMatch(/signing request will arrive/i);
    expect(n.body).toMatch(/host will arrange signing/i);
  });
});
