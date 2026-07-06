import { describe, it, expect } from "vitest";
import { atlantaSlotToUtc, formatAtlantaRange } from "@/lib/tz";

describe("atlantaSlotToUtc", () => {
  it("converts a summer (EDT, UTC-4) evening slot to UTC", () => {
    const { startsAt, endsAt } = atlantaSlotToUtc("2026-07-18", 18, 4);
    expect(startsAt.toISOString()).toBe("2026-07-18T22:00:00.000Z"); // 6 PM EDT
    expect(endsAt.toISOString()).toBe("2026-07-19T02:00:00.000Z"); // 10 PM EDT
  });

  it("converts a winter (EST, UTC-5) evening slot to UTC", () => {
    const { startsAt, endsAt } = atlantaSlotToUtc("2026-01-10", 18, 3);
    expect(startsAt.toISOString()).toBe("2026-01-10T23:00:00.000Z"); // 6 PM EST
    expect(endsAt.toISOString()).toBe("2026-01-11T02:00:00.000Z"); // 9 PM EST
  });
});

describe("formatAtlantaRange", () => {
  it("renders the stored UTC instants back as Atlanta wall-clock", () => {
    const s = new Date("2026-07-18T22:00:00.000Z");
    const e = new Date("2026-07-19T02:00:00.000Z");
    expect(formatAtlantaRange(s, e)).toBe("Sat, Jul 18, 6:00 PM – 10:00 PM");
  });
});
