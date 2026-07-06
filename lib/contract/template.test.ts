import { describe, it, expect } from "vitest";
import { buildStandardContract } from "./template";
import type { ContractInput } from "./types";

const base: ContractInput = {
  studioName: "Westview Studio",
  studioAddress: "123 Ralph David Abernathy Blvd, Atlanta, GA",
  renterName: "Dana Renter",
  renterEmail: "dana@example.com",
  renterPhone: "404-555-0100",
  eventType: "Photo shoot",
  when: "Sat, Aug 15, 2026 · 2:00–6:00 PM",
  headcount: 20,
  hourlyRateCents: 12000,
  minHours: 3,
  depositCents: 40000,
  maxOccupancy: 30,
  alcoholPolicy: "byob_with_acknowledgment",
  vendorPolicy: "approved_vendors",
  noiseCurfew: "10:00 PM",
  cleanupWindowMin: 30,
  cancellationLadder: { full: 30, half: 14, none: 0 },
  equipmentList: "Cyc wall, strobes",
  byob: true,
  outsideVendors: true,
};

function allText(doc: ReturnType<typeof buildStandardContract>): string {
  return [doc.title, doc.disclaimer, ...doc.sections.flatMap((s) => [s.heading, s.plainEnglish ?? "", ...s.body])].join("\n");
}

describe("buildStandardContract", () => {
  it("interpolates parties, dates, rate, and deposit as a printed term", () => {
    const doc = buildStandardContract(base);
    const text = allText(doc);
    expect(text).toContain("Westview Studio");
    expect(text).toContain("Dana Renter");
    expect(text).toContain("Sat, Aug 15, 2026 · 2:00–6:00 PM");
    expect(text).toContain("$120.00"); // hourly rate
    expect(text).toContain("$400.00"); // deposit
  });

  it("states the deposit is collected by the studio, never held by VenueDash", () => {
    const text = allText(buildStandardContract(base));
    expect(text).toMatch(/collected and refunded by the studio/i);
    expect(text).not.toMatch(/VenueDash (holds|will hold|escrow)/i);
  });

  it("selects the alcohol + vendor clauses by enum via the fixed lookup", () => {
    const text = allText(buildStandardContract(base));
    expect(text).toMatch(/BYOB/i);
    expect(text).toMatch(/prior written approval/i);
  });

  it("references Atlanta Code § 74-133 and the curfew when set", () => {
    const text = allText(buildStandardContract(base));
    expect(text).toContain("§ 74-133");
    expect(text).toContain("10:00 PM");
  });

  it("always includes the not-legal-advice / attorney-review disclaimer", () => {
    const doc = buildStandardContract(base);
    expect(doc.disclaimer).toMatch(/not a law firm/i);
    expect(doc.disclaimer).toMatch(/Georgia attorney/i);
  });

  it("never uses forbidden evidence/escrow language", () => {
    const text = allText(buildStandardContract(base));
    expect(text).not.toMatch(/immutable evidence|proof|we hold|hold funds|escrow/i);
  });

  it("degrades gracefully when optional fields are missing", () => {
    const doc = buildStandardContract({
      ...base, studioAddress: null, noiseCurfew: null, hourlyRateCents: null,
      cancellationLadder: null, equipmentList: null,
    });
    const text = allText(doc);
    expect(text).toContain("§ 74-133"); // kept even without a curfew
    expect(text).toMatch(/as agreed/i); // rate fallback
    expect(text).not.toContain("null");
    expect(text).not.toContain("undefined");
  });

  it("gives substantive sections a plain-English summary", () => {
    const doc = buildStandardContract(base);
    const deposit = doc.sections.find((s) => /deposit/i.test(s.heading));
    expect(deposit?.plainEnglish).toBeTruthy();
  });
});
