import { describe, it, expect } from "vitest";
import { renderContractPdf } from "./pdf";
import { buildStandardContract } from "./template";
import type { ContractInput } from "./types";

const input: ContractInput = {
  studioName: "Westview Studio", studioAddress: "123 RDA Blvd", renterName: "Dana Renter",
  renterEmail: "dana@example.com", renterPhone: null, eventType: "Photo shoot",
  when: "Sat, Aug 15, 2026 · 2:00–6:00 PM", headcount: 20, hourlyRateCents: 12000, minHours: 3,
  depositCents: 40000, maxOccupancy: 30, alcoholPolicy: "byob_with_acknowledgment",
  vendorPolicy: "approved_vendors", noiseCurfew: "10:00 PM", cleanupWindowMin: 30,
  cancellationLadder: { full: 30, half: 14, none: 0 }, equipmentList: "Cyc wall",
  byob: true, outsideVendors: true,
};

describe("renderContractPdf", () => {
  it("renders a non-empty PDF buffer", async () => {
    const buf = await renderContractPdf(buildStandardContract(input));
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(1000);
    expect(buf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  }, 20000);
});
