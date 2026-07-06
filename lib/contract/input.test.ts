import { describe, it, expect } from "vitest";
import { contractInputFromBooking } from "./input";
import type { Booking } from "@/db/schema";

const booking = {
  id: "b1", studioId: "s1", state: "awaiting_contract",
  renterName: "Dana Renter", renterEmail: "dana@example.com", renterPhone: "404-555-0100",
  eventType: "Photo shoot", headcount: 20, byob: true, outsideVendors: true, notes: null,
  startsAt: new Date("2026-08-15T18:00:00Z"), endsAt: new Date("2026-08-15T22:00:00Z"),
  depositCents: 40000,
  rateSnapshot: {
    hourlyRateCents: 12000, minHours: 3, cancellationLadder: { full: 30, half: 14, none: 0 },
    alcoholPolicy: "byob_with_acknowledgment", vendorPolicy: "approved_vendors",
    noiseCurfew: "10:00 PM", cleanupWindowMin: 30, maxOccupancy: 30,
  },
  depositProtected: true, depositStatus: "uncollected", depositStatusAt: null,
  contractSignedAt: null, createdAt: new Date(),
} as unknown as Booking;

describe("contractInputFromBooking", () => {
  it("reads legal terms from the snapshot and identity from the passed object", () => {
    const input = contractInputFromBooking(booking, {
      studioName: "Westview Studio", studioAddress: "123 RDA Blvd", equipmentList: "Cyc wall",
    });
    expect(input.studioName).toBe("Westview Studio");
    expect(input.studioAddress).toBe("123 RDA Blvd");
    expect(input.equipmentList).toBe("Cyc wall");
    expect(input.hourlyRateCents).toBe(12000);
    expect(input.alcoholPolicy).toBe("byob_with_acknowledgment");
    expect(input.maxOccupancy).toBe(30);
    expect(input.depositCents).toBe(40000);
    expect(input.renterName).toBe("Dana Renter");
    expect(input.when).toMatch(/2026/);
  });

  it("tolerates a null/partial snapshot", () => {
    const input = contractInputFromBooking(
      { ...booking, rateSnapshot: null } as unknown as Booking,
      { studioName: "X", studioAddress: null, equipmentList: null }
    );
    expect(input.hourlyRateCents).toBeNull();
    expect(input.cancellationLadder).toBeNull();
    expect(input.alcoholPolicy).toBeNull();
  });
});
