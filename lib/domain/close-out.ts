import type { Booking } from "@/db/schema";
import { deriveEffectiveState } from "./effective-state";
import { transitionBooking, type Actor, type Db } from "./transitions";
import type { BookingState } from "./states";

const CLOSE_OUT_CHAIN: BookingState[] = ["confirmed", "event_day", "post_event", "closed"];

export async function closeOutBooking(
  db: Db, booking: Booking, actor: Actor, now?: Date
): Promise<Booking> {
  const effective = deriveEffectiveState(booking, now ?? new Date());
  if (effective !== "post_event") {
    throw new CloseOutNotAllowedError(booking.id, effective);
  }

  let current: BookingState = booking.state;
  let latest: Booking = booking;

  const startIdx = CLOSE_OUT_CHAIN.indexOf(current);
  const remaining = startIdx >= 0
    ? CLOSE_OUT_CHAIN.slice(startIdx + 1)
    : CLOSE_OUT_CHAIN;

  for (const target of remaining) {
    latest = await transitionBooking(db, booking.id, target, actor, {
      expectedFrom: current,
      meta: { closeOut: true },
    });
    current = target;
  }

  return latest;
}

export class CloseOutNotAllowedError extends Error {
  constructor(bookingId: string, effectiveState: BookingState) {
    super(`Cannot close out booking ${bookingId}: effective state is ${effectiveState}, not post_event`);
    this.name = "CloseOutNotAllowedError";
  }
}
