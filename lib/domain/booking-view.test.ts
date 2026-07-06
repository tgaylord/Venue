// lib/domain/booking-view.test.ts
import { describe, it, expect } from "vitest";
import type { Booking } from "@/db/schema";
import type { BookingState } from "@/lib/domain/states";
import { toBookingView } from "@/lib/domain/booking-view";

// Minimal Booking factory — toBookingView reads only id/state/startsAt/endsAt.
function bk(state: BookingState, startsAt: Date, endsAt: Date): Booking {
  return { id: "b1", state, startsAt, endsAt } as unknown as Booking;
}
const FAR = new Date("2026-12-01T00:00:00Z");
const START = new Date("2026-12-01T18:00:00Z");
const END = new Date("2026-12-01T22:00:00Z");
const BEFORE = new Date("2026-11-01T00:00:00Z"); // now < start  -> confirmed stays confirmed
const DURING = new Date("2026-12-01T20:00:00Z"); // start <= now <= end -> event_day
const AFTER = new Date("2026-12-02T00:00:00Z");  // now > end -> post_event

describe("toBookingView — group", () => {
  const cases: [BookingState, string][] = [
    ["pending", "needs_action"],
    ["awaiting_signature", "needs_action"],
    ["awaiting_contract", "in_progress"],
    ["confirmed", "in_progress"],
    ["post_event", "past"],
    ["closed", "past"],
    ["declined", "past"],
    ["canceled", "past"],
  ];
  it.each(cases)("%s -> %s", (state, group) => {
    expect(toBookingView(bk(state, START, END), FAR).group).toBe(group);
  });
  it("confirmed during the event is effectively event_day -> in_progress", () => {
    expect(toBookingView(bk("confirmed", START, END), DURING).effectiveState).toBe("event_day");
    expect(toBookingView(bk("confirmed", START, END), DURING).group).toBe("in_progress");
  });
  it("confirmed after the event is effectively post_event -> past", () => {
    const v = toBookingView(bk("confirmed", START, END), AFTER);
    expect(v.effectiveState).toBe("post_event");
    expect(v.group).toBe("past");
  });
});

describe("toBookingView — legalActions", () => {
  it("pending offers approve, decline, cancel", () => {
    expect(toBookingView(bk("pending", START, END), BEFORE).legalActions).toEqual(["approve", "decline", "cancel"]);
  });
  it("awaiting_contract offers only cancel (contract-gen is Phase 6)", () => {
    expect(toBookingView(bk("awaiting_contract", START, END), BEFORE).legalActions).toEqual(["cancel"]);
  });
  it("awaiting_signature offers mark_signed and cancel", () => {
    expect(toBookingView(bk("awaiting_signature", START, END), BEFORE).legalActions).toEqual(["mark_signed", "cancel"]);
  });
  it("confirmed before the event offers cancel", () => {
    expect(toBookingView(bk("confirmed", START, END), BEFORE).legalActions).toEqual(["cancel"]);
  });
  it("cancel is suppressed once the event is effectively event_day", () => {
    expect(toBookingView(bk("confirmed", START, END), DURING).legalActions).toEqual([]);
  });
  it("cancel is suppressed once the event is effectively post_event", () => {
    expect(toBookingView(bk("confirmed", START, END), AFTER).legalActions).toEqual([]);
  });
  it("terminal states offer nothing", () => {
    for (const s of ["closed", "declined", "canceled"] as BookingState[]) {
      expect(toBookingView(bk(s, START, END), FAR).legalActions).toEqual([]);
    }
  });
});

describe("toBookingView — depositControlActive", () => {
  it("is active for confirmed/event_day/post_event and inactive otherwise", () => {
    expect(toBookingView(bk("confirmed", START, END), BEFORE).depositControlActive).toBe(true);
    expect(toBookingView(bk("confirmed", START, END), DURING).depositControlActive).toBe(true);
    expect(toBookingView(bk("confirmed", START, END), AFTER).depositControlActive).toBe(true);
    expect(toBookingView(bk("pending", START, END), FAR).depositControlActive).toBe(false);
    expect(toBookingView(bk("awaiting_signature", START, END), FAR).depositControlActive).toBe(false);
    expect(toBookingView(bk("closed", START, END), FAR).depositControlActive).toBe(false);
  });
});

describe("toBookingView — chip", () => {
  it("uses effective state for the label and tone", () => {
    expect(toBookingView(bk("confirmed", START, END), BEFORE).chip).toEqual({ label: "Confirmed", tone: "success" });
    expect(toBookingView(bk("confirmed", START, END), DURING).chip).toEqual({ label: "Event today", tone: "success" });
    expect(toBookingView(bk("declined", START, END), FAR).chip.tone).toBe("danger");
  });
});
