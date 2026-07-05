import { describe, it, expect } from "vitest";
import { deriveEffectiveState } from "@/lib/domain/effective-state";

const startsAt = new Date("2026-08-01T18:00:00Z");
const endsAt = new Date("2026-08-01T22:00:00Z");
const before = new Date("2026-08-01T17:59:59Z");
const during = new Date("2026-08-01T19:00:00Z");
const after = new Date("2026-08-01T22:00:01Z");

describe("deriveEffectiveState", () => {
  it("confirmed stays confirmed before the event", () => {
    expect(deriveEffectiveState({ state: "confirmed", startsAt, endsAt }, before)).toBe("confirmed");
  });
  it("confirmed reads as event_day from the start time (inclusive)", () => {
    expect(deriveEffectiveState({ state: "confirmed", startsAt, endsAt }, startsAt)).toBe("event_day");
    expect(deriveEffectiveState({ state: "confirmed", startsAt, endsAt }, during)).toBe("event_day");
  });
  it("confirmed reads as post_event after the end time", () => {
    expect(deriveEffectiveState({ state: "confirmed", startsAt, endsAt }, after)).toBe("post_event");
  });
  it("event_day reads as post_event after the end time, not at it", () => {
    expect(deriveEffectiveState({ state: "event_day", startsAt, endsAt }, endsAt)).toBe("event_day");
    expect(deriveEffectiveState({ state: "event_day", startsAt, endsAt }, after)).toBe("post_event");
  });
  it("all other states pass through unchanged", () => {
    for (const s of ["pending", "declined", "awaiting_contract", "awaiting_signature", "post_event", "closed", "canceled"] as const) {
      expect(deriveEffectiveState({ state: s, startsAt, endsAt }, after)).toBe(s);
    }
  });
});
