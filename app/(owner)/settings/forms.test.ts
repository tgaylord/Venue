import { describe, it, expect } from "vitest";
import {
  parseProfileForm, parseRulesForm, parsePricingForm, parseChecklistForm,
} from "@/app/(owner)/settings/forms";

function fd(fields: Record<string, string | string[]>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    for (const item of Array.isArray(v) ? v : [v]) f.append(k, item);
  }
  return f;
}

describe("parseProfileForm", () => {
  it("parses name, optionals, and space rows (skipping blank rows)", () => {
    const r = parseProfileForm(fd({
      name: " Westview Studio ", address: "", equipmentList: "Profoto kit",
      spaceName: ["Main floor", "", "Lounge"], spaceCap: ["40", "", ""],
    }));
    expect(r).toEqual({
      ok: true,
      data: {
        name: "Westview Studio", address: null, equipmentList: "Profoto kit",
        spaces: [{ name: "Main floor", maxOccupancy: 40 }, { name: "Lounge", maxOccupancy: null }],
      },
    });
  });
  it("requires a name and numeric caps", () => {
    const r1 = parseProfileForm(fd({ name: "  " }));
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.fieldErrors.name).toBeTruthy();
    const r2 = parseProfileForm(fd({ name: "S", spaceName: ["Room"], spaceCap: ["lots"] }));
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.fieldErrors.spaces).toBeTruthy();
  });
});

describe("parseRulesForm", () => {
  it("accepts valid enums and bounds", () => {
    const r = parseRulesForm(fd({
      alcoholPolicy: "byob_with_acknowledgment", vendorPolicy: "pre_approval",
      noiseCurfew: "10:00 PM", cleanupWindowMin: "30",
    }));
    expect(r).toEqual({
      ok: true,
      data: { alcoholPolicy: "byob_with_acknowledgment", vendorPolicy: "pre_approval", noiseCurfew: "10:00 PM", cleanupWindowMin: 30 },
    });
  });
  it("rejects unknown enum values and out-of-range cleanup", () => {
    const r1 = parseRulesForm(fd({ alcoholPolicy: "open_bar", vendorPolicy: "allowed" }));
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.fieldErrors.alcoholPolicy).toBeTruthy();
    const r2 = parseRulesForm(fd({ alcoholPolicy: "prohibited", vendorPolicy: "allowed", cleanupWindowMin: "999" }));
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.fieldErrors.cleanupWindowMin).toBeTruthy();
  });
});

describe("parsePricingForm", () => {
  it("parses dollars to cents and bounds minHours", () => {
    const r = parsePricingForm(fd({ hourlyRate: "$165", minHours: "3", deposit: "400" }));
    expect(r).toEqual({ ok: true, data: { hourlyRateCents: 16500, minHours: 3, depositCents: 40000 } });
  });
  it("rejects bad money and minHours out of 1-24", () => {
    const r1 = parsePricingForm(fd({ hourlyRate: "free", minHours: "3", deposit: "400" }));
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.fieldErrors.hourlyRate).toBeTruthy();
    const r2 = parsePricingForm(fd({ hourlyRate: "165", minHours: "25", deposit: "400" }));
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.fieldErrors.minHours).toBeTruthy();
  });
});

describe("parseChecklistForm", () => {
  it("parses ordered items, blank hints become null, blank rows skipped", () => {
    const r = parseChecklistForm(fd({ itemName: ["Cyc wall", "", "Floors"], itemHint: ["Both corners", "", ""] }));
    expect(r).toEqual({
      ok: true,
      data: { items: [{ name: "Cyc wall", hint: "Both corners" }, { name: "Floors", hint: null }] },
    });
  });
  it("requires 1-20 items", () => {
    const none = parseChecklistForm(fd({ itemName: [""], itemHint: [""] }));
    expect(none.ok).toBe(false);
    const many = parseChecklistForm(fd({
      itemName: Array.from({ length: 21 }, (_, i) => `Area ${i}`),
      itemHint: Array.from({ length: 21 }, () => ""),
    }));
    expect(many.ok).toBe(false);
  });
});
