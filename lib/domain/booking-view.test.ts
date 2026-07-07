// lib/domain/booking-view.test.ts
import { describe, it, expect } from "vitest";
import type { Booking } from "@/db/schema";
import type { BookingState } from "@/lib/domain/states";
import { toBookingView, walkthroughEntries, nextStep } from "@/lib/domain/booking-view";

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
  it("pending offers approve_and_send, decline, cancel", () => {
    expect(toBookingView(bk("pending", START, END), BEFORE).legalActions).toEqual(["approve_and_send", "decline", "cancel"]);
  });
  it("awaiting_contract offers generate_contract and cancel", () => {
    expect(toBookingView(bk("awaiting_contract", START, END), BEFORE).legalActions).toEqual(["generate_contract", "cancel"]);
  });
  it("awaiting_signature offers mark_signed and cancel", () => {
    expect(toBookingView(bk("awaiting_signature", START, END), BEFORE).legalActions).toEqual(["mark_signed", "cancel"]);
  });
  it("offers generate_contract (not mark_signed) on an awaiting_contract booking", () => {
    const view = toBookingView(bk("awaiting_contract", START, END), BEFORE);
    expect(view.legalActions).toContain("generate_contract");
    expect(view.legalActions).not.toContain("mark_signed");
  });
  it("still offers mark_signed on an awaiting_signature booking", () => {
    const view = toBookingView(bk("awaiting_signature", START, END), BEFORE);
    expect(view.legalActions).toContain("mark_signed");
    expect(view.legalActions).not.toContain("generate_contract");
  });
  it("confirmed before the event offers cancel", () => {
    expect(toBookingView(bk("confirmed", START, END), BEFORE).legalActions).toEqual(["cancel"]);
  });
  it("cancel is suppressed once the event is effectively event_day", () => {
    expect(toBookingView(bk("confirmed", START, END), DURING).legalActions).toEqual([]);
  });
  it("post_event offers close_out (cancel suppressed)", () => {
    expect(toBookingView(bk("confirmed", START, END), AFTER).legalActions).toEqual(["close_out"]);
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

describe("nextStep", () => {
  const none = { preLocked: false, postLocked: false };
  const allLocked = { preLocked: true, postLocked: true };
  const preLocked = { preLocked: true, postLocked: false };

  it("pending → Review request (detail)", () => {
    expect(nextStep("pending", none)).toEqual({ label: "Review request", href: "detail" });
  });
  it("awaiting_contract → Send contract (detail)", () => {
    expect(nextStep("awaiting_contract", none)).toEqual({ label: "Send contract", href: "detail" });
  });
  it("awaiting_signature → Get contract signed (detail)", () => {
    expect(nextStep("awaiting_signature", none)).toEqual({ label: "Get contract signed", href: "detail" });
  });
  it("confirmed with pre unlocked → Pre-event walkthrough due (capture)", () => {
    expect(nextStep("confirmed", none)).toEqual({ label: "Pre-event walkthrough due", href: "pre_walkthrough" });
  });
  it("confirmed with pre locked → null", () => {
    expect(nextStep("confirmed", preLocked)).toBeNull();
  });
  it("event_day with pre unlocked → Pre-event walkthrough due (capture)", () => {
    expect(nextStep("event_day", none)).toEqual({ label: "Pre-event walkthrough due", href: "pre_walkthrough" });
  });
  it("event_day with pre locked → null", () => {
    expect(nextStep("event_day", preLocked)).toBeNull();
  });
  it("post_event with post unlocked → Post-event walkthrough due (capture)", () => {
    expect(nextStep("post_event", none)).toEqual({ label: "Post-event walkthrough due", href: "post_walkthrough" });
  });
  it("post_event with post locked → Close out (detail)", () => {
    expect(nextStep("post_event", allLocked)).toEqual({ label: "Close out", href: "detail" });
  });
  it("terminal states → null", () => {
    expect(nextStep("closed", none)).toBeNull();
    expect(nextStep("declined", none)).toBeNull();
    expect(nextStep("canceled", none)).toBeNull();
  });
});

describe("walkthroughEntries", () => {
  const none = { preLocked: false, postLocked: false };
  it("offers pre on confirmed and event_day", () => {
    expect(walkthroughEntries("confirmed", none)).toEqual(["start_pre_walkthrough"]);
    expect(walkthroughEntries("event_day", none)).toEqual(["start_pre_walkthrough"]);
  });
  it("offers post only on post_event", () => {
    expect(walkthroughEntries("post_event", none)).toEqual(["start_post_walkthrough"]);
  });
  it("hides an entry once its walkthrough is locked", () => {
    expect(walkthroughEntries("event_day", { preLocked: true, postLocked: false })).toEqual([]);
    expect(walkthroughEntries("post_event", { preLocked: true, postLocked: true })).toEqual([]);
  });
  it("offers nothing before confirmed or on terminal states", () => {
    expect(walkthroughEntries("pending", none)).toEqual([]);
    expect(walkthroughEntries("closed", none)).toEqual([]);
  });
});
