import { describe, it, expect } from "vitest";
import { parseIntake } from "./forms";

function fd(overrides: Record<string, string> = {}): FormData {
  const base: Record<string, string> = {
    renterName: "Maya Reeves", renterEmail: "maya@x.com", renterPhone: "",
    eventType: "Birthday celebration", headcount: "25",
    byob: "on", outsideVendors: "", notes: "Balloon arch",
    dateISO: "2026-07-18", startHour: "18", durationHours: "4",
  };
  const f = new FormData();
  for (const [k, v] of Object.entries({ ...base, ...overrides })) f.set(k, v);
  return f;
}

describe("parseIntake", () => {
  it("parses a valid submission", () => {
    const r = parseIntake(fd());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data).toMatchObject({
        renterName: "Maya Reeves", renterEmail: "maya@x.com", renterPhone: null,
        eventType: "Birthday celebration", headcount: 25, byob: true, outsideVendors: false,
        notes: "Balloon arch", dateISO: "2026-07-18", startHour: 18, durationHours: 4,
      });
    }
  });
  it("rejects a missing name", () => {
    const r = parseIntake(fd({ renterName: "  " }));
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/name/i) });
  });
  it("rejects a malformed email", () => {
    expect(parseIntake(fd({ renterEmail: "nope" })).ok).toBe(false);
  });
  it("rejects a non-positive headcount", () => {
    expect(parseIntake(fd({ headcount: "0" })).ok).toBe(false);
  });
  it("rejects an unknown event type", () => {
    expect(parseIntake(fd({ eventType: "Wedding at the beach" })).ok).toBe(false);
  });
  it("rejects a malformed date", () => {
    expect(parseIntake(fd({ dateISO: "07/18/2026" })).ok).toBe(false);
  });
});
