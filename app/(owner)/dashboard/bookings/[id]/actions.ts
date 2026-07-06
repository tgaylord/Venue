"use server";

import { auth } from "@clerk/nextjs/server";
import { redirect, notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import { getStudioByClerkUserId } from "@/lib/studio";
import {
  getBookingForOwner, setDepositStatus, setContractSignedAt,
} from "@/lib/booking";
import {
  transitionBooking, IllegalTransitionError, ConcurrentTransitionError,
  BookingNotFoundError, type Db,
} from "@/lib/domain/transitions";
import type { BookingState } from "@/lib/domain/states";
import type { Booking } from "@/db/schema";
import { deriveEffectiveState } from "@/lib/domain/effective-state";
import { parseDepositStatus, type BookingActionState } from "./forms";

async function ownerContext(
  bookingId: string
): Promise<{ db: Db; userId: string; booking: Booking }> {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");
  const db = getDb();
  const studio = await getStudioByClerkUserId(db, userId);
  if (!studio) redirect("/settings");
  const booking = await getBookingForOwner(db, bookingId, studio.id);
  if (!booking) notFound();
  return { db, userId, booking };
}

function revalidate(bookingId: string): void {
  revalidatePath(`/dashboard/bookings/${bookingId}`);
  revalidatePath("/dashboard");
}

async function runTransition(
  db: Db, bookingId: string, to: BookingState, userId: string,
  meta?: Record<string, unknown>
): Promise<BookingActionState> {
  try {
    await transitionBooking(db, bookingId, to, { type: "owner", id: userId }, meta ? { meta } : undefined);
  } catch (e) {
    if (
      e instanceof IllegalTransitionError ||
      e instanceof ConcurrentTransitionError ||
      e instanceof BookingNotFoundError
    ) {
      return { status: "error", error: "This booking just changed — refresh and try again." };
    }
    throw e;
  }
  revalidate(bookingId);
  return { status: "idle", error: "" };
}

export async function approveBooking(
  bookingId: string, _prev: BookingActionState, _fd: FormData
): Promise<BookingActionState> {
  const { db, userId } = await ownerContext(bookingId);
  return runTransition(db, bookingId, "awaiting_contract", userId);
}

export async function declineBooking(
  bookingId: string, _prev: BookingActionState, _fd: FormData
): Promise<BookingActionState> {
  const { db, userId } = await ownerContext(bookingId);
  return runTransition(db, bookingId, "declined", userId);
}

export async function cancelBooking(
  bookingId: string, _prev: BookingActionState, _fd: FormData
): Promise<BookingActionState> {
  const { db, userId, booking } = await ownerContext(bookingId);
  const eff = deriveEffectiveState(booking, new Date());
  if (eff === "event_day" || eff === "post_event") {
    return { status: "error", error: "This event has already started or passed and can't be canceled." };
  }
  return runTransition(db, bookingId, "canceled", userId);
}

export async function markSigned(
  bookingId: string, _prev: BookingActionState, _fd: FormData
): Promise<BookingActionState> {
  const { db, userId } = await ownerContext(bookingId);
  const signedAt = new Date();
  const result = await runTransition(
    db, bookingId, "confirmed", userId, { contractSignedAt: signedAt.toISOString() }
  );
  if (result.status === "error") return result;
  await setContractSignedAt(db, bookingId, signedAt); // stamp after the guarded transition
  revalidate(bookingId);
  return result;
}

export async function setDeposit(
  bookingId: string, _prev: BookingActionState, fd: FormData
): Promise<BookingActionState> {
  const { db } = await ownerContext(bookingId);
  const parsed = parseDepositStatus(fd);
  if (!parsed.ok) return { status: "error", error: parsed.error };
  await setDepositStatus(db, bookingId, parsed.status);
  revalidate(bookingId);
  return { status: "idle", error: "" };
}
