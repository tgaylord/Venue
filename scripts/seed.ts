/**
 * Seeds the dev database with the prototype's demo studio and bookings,
 * remapped onto the v0.5 state machine (spec §8). Idempotent: deletes and
 * recreates the demo studio by slug. Booking histories are written THROUGH
 * transitionBooking so the seed itself exercises the state machine.
 */
import { eq } from "drizzle-orm";
import { getDb, getPool } from "@/lib/db";
import { studios, spaces, checklistItems, bookings } from "@/db/schema";
import { transitionBooking, type Actor } from "@/lib/domain/transitions";
import type { BookingState } from "@/lib/domain/states";

const SLUG = "westview";
const OWNER: Actor = { type: "owner", id: "seed-owner" };
const SYSTEM: Actor = { type: "system" };

/** Shortest path from `pending` to each target state, with the acting party. */
const PATHS: Record<BookingState, Array<{ to: BookingState; actor: Actor }>> = {
  pending: [],
  declined: [{ to: "declined", actor: OWNER }],
  awaiting_contract: [{ to: "awaiting_contract", actor: OWNER }],
  awaiting_signature: [
    { to: "awaiting_contract", actor: OWNER },
    { to: "awaiting_signature", actor: OWNER },
  ],
  confirmed: [
    { to: "awaiting_contract", actor: OWNER },
    { to: "awaiting_signature", actor: OWNER },
    { to: "confirmed", actor: OWNER },
  ],
  event_day: [
    { to: "awaiting_contract", actor: OWNER },
    { to: "awaiting_signature", actor: OWNER },
    { to: "confirmed", actor: OWNER },
    { to: "event_day", actor: SYSTEM },
  ],
  post_event: [
    { to: "awaiting_contract", actor: OWNER },
    { to: "awaiting_signature", actor: OWNER },
    { to: "confirmed", actor: OWNER },
    { to: "event_day", actor: SYSTEM },
    { to: "post_event", actor: SYSTEM },
  ],
  closed: [
    { to: "awaiting_contract", actor: OWNER },
    { to: "awaiting_signature", actor: OWNER },
    { to: "confirmed", actor: OWNER },
    { to: "event_day", actor: SYSTEM },
    { to: "post_event", actor: SYSTEM },
    { to: "closed", actor: OWNER },
  ],
  canceled: [
    { to: "awaiting_contract", actor: OWNER },
    { to: "canceled", actor: OWNER },
  ],
};

const now = new Date();
const days = (n: number) => new Date(now.getTime() + n * 24 * 60 * 60 * 1000);
const at = (base: Date, hour: number) => {
  const d = new Date(base);
  d.setHours(hour, 0, 0, 0);
  return d;
};

// Prototype personas remapped to v0.5 states (spec §8).
const DEMO_BOOKINGS: Array<{
  state: BookingState; renterName: string; renterEmail: string; eventType: string;
  headcount: number; byob: boolean; outsideVendors: boolean; notes: string;
  startsAt: Date; endsAt: Date;
}> = [
  { state: "pending", renterName: "Maya Reeves", renterEmail: "maya.r@gmail.com", eventType: "Birthday celebration", headcount: 25, byob: true, outsideVendors: false, notes: "Bringing a small dessert table and balloon arch — no wall tape, promise!", startsAt: at(days(7), 18), endsAt: at(days(7), 22) },
  { state: "awaiting_contract", renterName: "Tasha Willis", renterEmail: "tasha@willisproductions.co", eventType: "Creative production with guests", headcount: 15, byob: false, outsideVendors: true, notes: "Small crew, haze machine — happy to discuss.", startsAt: at(days(8), 12), endsAt: at(days(8), 18) },
  { state: "awaiting_signature", renterName: "Kelvin Odom", renterEmail: "kelvin@studiokco.com", eventType: "Brand event / pop-up", headcount: 40, byob: true, outsideVendors: true, notes: "Step-and-repeat near entrance.", startsAt: at(days(14), 19), endsAt: at(days(14), 23) },
  { state: "confirmed", renterName: "Dana Nguyen", renterEmail: "dana@podlab.fm", eventType: "Creative production with guests", headcount: 4, byob: false, outsideVendors: false, notes: "Repeat client.", startsAt: at(days(5), 10), endsAt: at(days(5), 13) },
  { state: "confirmed", renterName: "Lena Ortiz", renterEmail: "lena.ortiz@yahoo.com", eventType: "Other private event", headcount: 20, byob: true, outsideVendors: true, notes: "Private chef.", startsAt: at(days(21), 17), endsAt: at(days(21), 21) },
  { state: "event_day", renterName: "Jordan Carter", renterEmail: "jcarter@outlook.com", eventType: "Baby or bridal shower", headcount: 30, byob: false, outsideVendors: true, notes: "Caterer arriving 1:30 PM for setup.", startsAt: at(days(0), 14), endsAt: at(days(0), 18) },
  { state: "post_event", renterName: "Andre Brooks", renterEmail: "dre.brooks@gmail.com", eventType: "Listening session / release party", headcount: 35, byob: true, outsideVendors: false, notes: "DJ + light catering.", startsAt: at(days(-2), 19), endsAt: at(days(-2), 23) },
  { state: "closed", renterName: "Simone Price", renterEmail: "simone.p@gmail.com", eventType: "Other private event", headcount: 12, byob: true, outsideVendors: false, notes: "", startsAt: at(days(-8), 18), endsAt: at(days(-8), 21) },
  { state: "declined", renterName: "Marcus Hill", renterEmail: "mhill.events@gmail.com", eventType: "Brand event / pop-up", headcount: 60, byob: true, outsideVendors: true, notes: "60 guests — over our cap, sadly.", startsAt: at(days(10), 20), endsAt: at(days(10), 23) },
  { state: "canceled", renterName: "Priya Shah", renterEmail: "priya.shah@gmail.com", eventType: "Birthday celebration", headcount: 18, byob: false, outsideVendors: false, notes: "Renter had a schedule conflict.", startsAt: at(days(12), 15), endsAt: at(days(12), 19) },
];

const CHECKLIST = [
  { position: 1, name: "Cyc wall", hint: "Full-width shot, both corners" },
  { position: 2, name: "Floors", hint: "Any existing scuffs or marks" },
  { position: 3, name: "Lighting equipment", hint: "Stands, softboxes, cables" },
  { position: 4, name: "Furniture & props", hint: "Couch, tables, decor wall" },
  { position: 5, name: "Bathroom", hint: "Fixtures and counter" },
  { position: 6, name: "Entryway & door", hint: "Locks, handles, signage" },
];

async function main() {
  const db = getDb();

  // Idempotent: cascade delete wipes spaces/checklist/bookings/events/tokens.
  await db.delete(studios).where(eq(studios.slug, SLUG));

  const [studio] = await db.insert(studios).values({
    clerkUserId: "seed-owner",
    name: "Westview Studio",
    slug: SLUG,
    address: "1200 Westview Dr SW, Atlanta, GA",
    description: "Natural-light studio with a 20-ft cyc wall in Atlanta's Westview neighborhood.",
    equipmentList: "Cyc wall, 4x Aputure 300d, C-stands, seamless paper (white/gray)",
    hourlyRateCents: 9500,
    minHours: 4,
    depositCents: 40000,
    alcoholPolicy: "byob_with_agreement",
    vendorPolicy: "approved_in_advance",
    noiseCurfew: "22:00",
    cleanupWindowMin: 60,
    cancellationLadder: { full: 30, half: 14, none: 0 },
    onboardingCompletedAt: now,
  }).returning();

  await db.insert(spaces).values([
    { studioId: studio.id, name: "Main studio", maxOccupancy: 40 },
    { studioId: studio.id, name: "Green room", maxOccupancy: 8 },
  ]);
  await db.insert(checklistItems).values(CHECKLIST.map((c) => ({ ...c, studioId: studio.id })));

  for (const demo of DEMO_BOOKINGS) {
    const { state: target, ...intake } = demo;
    const [b] = await db.insert(bookings).values({
      ...intake,
      studioId: studio.id,
      depositCents: studio.depositCents,
      rateSnapshot: { hourlyRateCents: studio.hourlyRateCents, minHours: studio.minHours, cancellationLadder: studio.cancellationLadder },
    }).returning();
    for (const step of PATHS[target]) {
      await transitionBooking(db, b.id, step.to, step.actor, { meta: { seed: true } });
    }
    console.log(`seeded: ${intake.renterName.padEnd(14)} → ${target}`);
  }

  console.log(`\nSeed complete: studio "${studio.name}" (/book/${SLUG}) with ${DEMO_BOOKINGS.length} bookings.`);
  await getPool().end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
