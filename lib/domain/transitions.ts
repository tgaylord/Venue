import { and, eq } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "@/db/schema";
import { bookings, bookingEvents, type Booking } from "@/db/schema";
import { LEGAL_TRANSITIONS, type BookingState } from "./states";

/** Structural DB type satisfied by both the Neon Pool client and PGlite. */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export type Actor = { type: "owner" | "renter" | "system"; id?: string };

export class BookingNotFoundError extends Error {
  constructor(bookingId: string) {
    super(`Booking not found: ${bookingId}`);
    this.name = "BookingNotFoundError";
  }
}

export class IllegalTransitionError extends Error {
  constructor(readonly from: BookingState, readonly to: BookingState) {
    super(`Illegal transition: ${from} → ${to}`);
    this.name = "IllegalTransitionError";
  }
}

export class ConcurrentTransitionError extends Error {
  constructor(bookingId: string) {
    super(`Booking ${bookingId} was transitioned concurrently; retry from fresh state`);
    this.name = "ConcurrentTransitionError";
  }
}

type TransitionHook = (booking: Booking, actor: Actor) => Promise<void>;
const hooks = new Map<BookingState, TransitionHook[]>();

/** Later phases register side effects (emails, availability blocks) per target state. */
export function registerTransitionHook(to: BookingState, hook: TransitionHook): void {
  const list = hooks.get(to) ?? [];
  list.push(hook);
  hooks.set(to, list);
}

export function clearTransitionHooks(): void {
  hooks.clear();
}

/**
 * The ONLY code path allowed to change bookings.state (spec §5).
 * Transactional: validate legality → compare-and-swap update → append audit row.
 * Hooks run AFTER commit; a failed side effect never rolls back a legal transition.
 */
export async function transitionBooking(
  db: Db,
  bookingId: string,
  to: BookingState,
  actor: Actor,
  opts?: { meta?: Record<string, unknown>; expectedFrom?: BookingState }
): Promise<Booking> {
  const updated = await db.transaction(async (tx) => {
    let from = opts?.expectedFrom;
    if (!from) {
      const [current] = await tx.select().from(bookings).where(eq(bookings.id, bookingId));
      if (!current) throw new BookingNotFoundError(bookingId);
      from = current.state;
    }

    if (!LEGAL_TRANSITIONS[from].includes(to)) throw new IllegalTransitionError(from, to);

    const rows = await tx
      .update(bookings)
      .set({ state: to })
      .where(and(eq(bookings.id, bookingId), eq(bookings.state, from)))
      .returning();
    if (rows.length === 0) {
      // Row exists but state moved under us (or expectedFrom was stale) — CAS failed.
      const [exists] = await tx.select({ id: bookings.id }).from(bookings).where(eq(bookings.id, bookingId));
      if (!exists) throw new BookingNotFoundError(bookingId);
      throw new ConcurrentTransitionError(bookingId);
    }

    await tx.insert(bookingEvents).values({
      bookingId,
      fromState: from,
      toState: to,
      actorType: actor.type,
      actorId: actor.id ?? null,
      metadata: opts?.meta ?? null,
    });

    return rows[0];
  });

  for (const hook of hooks.get(to) ?? []) {
    try {
      await hook(updated, actor);
    } catch (e) {
      console.error(`transition hook for "${to}" failed (transition stands):`, e);
    }
  }

  return updated;
}
