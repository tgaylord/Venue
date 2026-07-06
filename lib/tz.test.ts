import { describe, it, expect } from "vitest";
import { atlantaSlotToUtc, formatAtlantaRange, formatAtlantaRangeLong } from "@/lib/tz";

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

  it("handles a DST fall-back transition landing inside the event's end", () => {
    // 2026-10-31 9 PM EDT (-4), 8 hrs -> ends 2026-11-01 5 AM, after clocks fall back to EST (-5).
    const { startsAt, endsAt } = atlantaSlotToUtc("2026-10-31", 21, 8);
    expect(startsAt.toISOString()).toBe("2026-11-01T01:00:00.000Z"); // 9 PM EDT
    expect(endsAt.toISOString()).toBe("2026-11-01T10:00:00.000Z"); // 5 AM EST
  });
});

describe("formatAtlantaRange", () => {
  it("renders the stored UTC instants back as Atlanta wall-clock", () => {
    const s = new Date("2026-07-18T22:00:00.000Z");
    const e = new Date("2026-07-19T02:00:00.000Z");
    expect(formatAtlantaRange(s, e)).toBe("Sat, Jul 18, 6:00 PM – 10:00 PM");
  });

  it("formatAtlantaRangeLong includes the year and full month", () => {
    const start = new Date("2026-08-15T18:00:00Z"); // 2 PM ET
    const end = new Date("2026-08-15T22:00:00Z");   // 6 PM ET
    const s = formatAtlantaRangeLong(start, end);
    expect(s).toContain("2026");
    expect(s).toContain("August");
    expect(s).toMatch(/2:00\s?PM/);
    expect(s).toMatch(/6:00\s?PM/);
  });
});
