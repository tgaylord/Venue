import type { Booking } from "@/db/schema";
import { formatAtlantaRangeLong } from "@/lib/tz";
import type { CancellationLadder, ContractInput } from "./types";

type Snap = {
  hourlyRateCents?: number | null;
  minHours?: number | null;
  cancellationLadder?: unknown;
  alcoholPolicy?: string | null;
  vendorPolicy?: string | null;
  noiseCurfew?: string | null;
  cleanupWindowMin?: number | null;
  maxOccupancy?: number | null;
};

function asLadder(v: unknown): CancellationLadder | null {
  if (v && typeof v === "object" && "full" in v && "half" in v && "none" in v) {
    const l = v as Record<string, unknown>;
    if (typeof l.full === "number" && typeof l.half === "number" && typeof l.none === "number") {
      return { full: l.full, half: l.half, none: l.none };
    }
  }
  return null;
}

export function contractInputFromBooking(
  booking: Booking,
  identity: { studioName: string; studioAddress: string | null; equipmentList: string | null }
): ContractInput {
  const snap = (booking.rateSnapshot ?? {}) as Snap;
  return {
    studioName: identity.studioName,
    studioAddress: identity.studioAddress,
    equipmentList: identity.equipmentList,
    renterName: booking.renterName,
    renterEmail: booking.renterEmail,
    renterPhone: booking.renterPhone,
    eventType: booking.eventType,
    when: formatAtlantaRangeLong(booking.startsAt, booking.endsAt),
    headcount: booking.headcount,
    byob: booking.byob,
    outsideVendors: booking.outsideVendors,
    hourlyRateCents: snap.hourlyRateCents ?? null,
    minHours: snap.minHours ?? null,
    depositCents: booking.depositCents,
    maxOccupancy: snap.maxOccupancy ?? null,
    alcoholPolicy: snap.alcoholPolicy ?? null,
    vendorPolicy: snap.vendorPolicy ?? null,
    noiseCurfew: snap.noiseCurfew ?? null,
    cleanupWindowMin: snap.cleanupWindowMin ?? null,
    cancellationLadder: asLadder(snap.cancellationLadder),
  };
}
