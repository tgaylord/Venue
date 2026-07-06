import { describe, it, expect } from "vitest";
import { overlaps, hasConflict, availableStartHours, type Interval } from "@/lib/availability";

const iv = (s: string, e: string): Interval => ({ startsAt: new Date(s), endsAt: new Date(e) });

describe("overlaps", () => {
  it("is true for touching-in-the-middle intervals", () => {
    expect(overlaps(iv("2026-07-18T22:00Z", "2026-07-19T02:00Z"), iv("2026-07-19T00:00Z", "2026-07-19T03:00Z"))).toBe(true);
  });
  it("is false for back-to-back intervals (end == start)", () => {
    expect(overlaps(iv("2026-07-18T22:00Z", "2026-07-19T00:00Z"), iv("2026-07-19T00:00Z", "2026-07-19T02:00Z"))).toBe(false);
  });
});

describe("hasConflict", () => {
  it("detects a candidate overlapping any busy interval", () => {
    const busy = [iv("2026-07-18T22:00Z", "2026-07-19T02:00Z")];
    expect(hasConflict(iv("2026-07-19T01:00Z", "2026-07-19T04:00Z"), busy)).toBe(true);
    expect(hasConflict(iv("2026-07-19T02:00Z", "2026-07-19T05:00Z"), busy)).toBe(false);
  });
});

describe("availableStartHours", () => {
  it("removes start hours whose minHours booking would collide with a busy interval", () => {
    // Existing booking 6-10 PM EDT on 2026-07-18 => 22:00Z..02:00Z next day.
    const busy = [iv("2026-07-18T22:00Z", "2026-07-19T02:00Z")];
    const hours = availableStartHours("2026-07-18", [16, 17, 18, 19, 20, 21], 3, busy);
    // 3-hr bookings starting 16,17,18,19,20 all touch the 18-22(local) window; 21 (9 PM+3h) is after end? 21..24 local = 01:00Z..04:00Z, overlaps until 02:00Z -> still conflicts.
    expect(hours).toEqual([]); // every 3h slot in this range overlaps the evening booking
  });
  it("keeps all hours when there is no busy interval", () => {
    expect(availableStartHours("2026-07-18", [10, 14, 18], 3, [])).toEqual([10, 14, 18]);
  });
});
