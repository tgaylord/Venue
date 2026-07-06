import { and, eq, gt, lt, notInArray } from "drizzle-orm";
import { bookings, availabilityBlocks, type Booking } from "@/db/schema";
import type { Db } from "@/lib/domain/transitions";
import { mintRenterToken } from "@/lib/tokens";
import { TERMINAL_STATES } from "@/lib/domain/states";
import type { Interval } from "@/lib/availability";

const STATUS_TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 120; // 120 days

export type TermsSnapshot = {
  hourlyRateCents: number | null;
  minHours: number | null;
  cancellationLadder: unknown;
  alcoholPolicy: string | null;
  vendorPolicy: string | null;
  noiseCurfew: string | null;
  cleanupWindowMin: number | null;
  maxOccupancy: number | null;
};

export type CreateBookingInput = {
  studioId: string;
  renterName: string;
  renterEmail: string;
  renterPhone: string | null;
  eventType: string;
  headcount: number;
  byob: boolean;
  outsideVendors: boolean;
  notes: string | null;
  startsAt: Date;
  endsAt: Date;
  depositCents: number | null;
  termsSnapshot: TermsSnapshot;
};

/**
 * The sanctioned creation path for a booking. `pending` is the genesis state
 * (schema default) — this is a plain insert, NOT a transition, and writes no
 * booking_events row. Terms are snapshotted onto rateSnapshot at request time.
 */
export async function createBooking(
  db: Db, input: CreateBookingInput
): Promise<{ booking: Booking; statusToken: string }> {
  const [booking] = await db.insert(bookings).values({
    studioId: input.studioId,
    renterName: input.renterName,
    renterEmail: input.renterEmail,
    renterPhone: input.renterPhone,
    eventType: input.eventType,
    headcount: input.headcount,
    byob: input.byob,
    outsideVendors: input.outsideVendors,
    notes: input.notes,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    depositCents: input.depositCents,
    rateSnapshot: input.termsSnapshot,
  }).returning();

  const statusToken = await mintRenterToken(db, booking.id, "status", new Date(Date.now() + STATUS_TOKEN_TTL_MS));
  return { booking, statusToken };
}

/** Non-terminal bookings + all availability blocks overlapping [from, to). */
export async function getBusyIntervals(
  db: Db, studioId: string, from: Date, to: Date
): Promise<Interval[]> {
  const b = await db.select({ startsAt: bookings.startsAt, endsAt: bookings.endsAt })
    .from(bookings)
    .where(and(
      eq(bookings.studioId, studioId),
      notInArray(bookings.state, [...TERMINAL_STATES]),
      lt(bookings.startsAt, to),
      gt(bookings.endsAt, from),
    ));
  const a = await db.select({ startsAt: availabilityBlocks.startsAt, endsAt: availabilityBlocks.endsAt })
    .from(availabilityBlocks)
    .where(and(
      eq(availabilityBlocks.studioId, studioId),
      lt(availabilityBlocks.startsAt, to),
      gt(availabilityBlocks.endsAt, from),
    ));
  return [...b, ...a];
}
