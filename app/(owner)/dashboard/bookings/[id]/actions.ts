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
import { toBookingView } from "@/lib/domain/booking-view";
import { parseDepositStatus, type BookingActionState } from "./forms";
import { formatAtlantaRange } from "@/lib/tz";
import { approveAndSendContract, generateAndAdvance, markContractSigned } from "@/lib/contract";
import { closeOutBooking, CloseOutNotAllowedError } from "@/lib/domain/close-out";
import { renderContractPdf } from "@/lib/contract/pdf";
import { putObject } from "@/lib/storage";
import { sendEmail, renderContractReadyRenter } from "@/lib/email";
import { mintRenterToken } from "@/lib/tokens";
import { baseUrl } from "@/lib/url";
import type { Studio } from "@/lib/studio";

const CONTRACT_TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 120; // 120 days

async function ownerContext(
  bookingId: string
): Promise<{ db: Db; userId: string; booking: Booking; studio: Studio }> {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");
  const db = getDb();
  const studio = await getStudioByClerkUserId(db, userId);
  if (!studio) redirect("/settings");
  const booking = await getBookingForOwner(db, bookingId, studio.id);
  if (!booking) notFound();
  return { db, userId, booking, studio };
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

export async function approveAndSend(
  bookingId: string, _prev: BookingActionState, _fd: FormData
): Promise<BookingActionState> {
  const { db, userId, booking, studio } = await ownerContext(bookingId);
  try {
    await approveAndSendContract(
      db, booking,
      { studioName: studio.name, studioAddress: studio.address, equipmentList: studio.equipmentList },
      { render: renderContractPdf, put: putObject },
      { type: "owner", id: userId }
    );
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

  try {
    const origin = await baseUrl();
    const contractToken = await mintRenterToken(
      db, bookingId, "contract", new Date(Date.now() + CONTRACT_TOKEN_TTL_MS)
    );
    await sendEmail({
      to: booking.renterEmail,
      subject: `Your rental agreement for ${studio.name} is ready`,
      html: await renderContractReadyRenter({
        studioName: studio.name,
        when: formatAtlantaRange(booking.startsAt, booking.endsAt),
        contractUrl: `${origin}/contract/${contractToken}`,
      }),
    });
  } catch (e) {
    console.error("renter contract email failed (approve+send stands):", e);
  }

  revalidate(bookingId);
  return { status: "idle", error: "" };
}

export async function generateContract(
  bookingId: string, _prev: BookingActionState, _fd: FormData
): Promise<BookingActionState> {
  const { db, userId, booking, studio } = await ownerContext(bookingId);
  if (booking.state !== "awaiting_contract") {
    return { status: "error", error: "This booking just changed — refresh and try again." };
  }
  try {
    await generateAndAdvance(
      db, booking,
      { studioName: studio.name, studioAddress: studio.address, equipmentList: studio.equipmentList },
      { render: renderContractPdf, put: putObject },
      { type: "owner", id: userId }
    );
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

  // Best-effort renter notification with a self-service download link — a send
  // failure must never fail the generation. The link uses a dedicated
  // `purpose="contract"` token so it never rotates the renter's status link.
  try {
    const origin = await baseUrl();
    const contractToken = await mintRenterToken(
      db, bookingId, "contract", new Date(Date.now() + CONTRACT_TOKEN_TTL_MS)
    );
    await sendEmail({
      to: booking.renterEmail,
      subject: `Your rental agreement for ${studio.name} is ready`,
      html: await renderContractReadyRenter({
        studioName: studio.name,
        when: formatAtlantaRange(booking.startsAt, booking.endsAt),
        contractUrl: `${origin}/contract/${contractToken}`,
      }),
    });
  } catch (e) {
    console.error("renter contract email failed (generation stands):", e);
  }

  revalidate(bookingId);
  return { status: "idle", error: "" };
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
  try { await markContractSigned(db, bookingId, signedAt); } catch (e) { console.error("contract-row sign flip failed (confirm stands):", e); }
  revalidate(bookingId);
  return result;
}

export async function closeOut(
  bookingId: string, _prev: BookingActionState, _fd: FormData
): Promise<BookingActionState> {
  const { db, userId, booking } = await ownerContext(bookingId);
  try {
    await closeOutBooking(db, booking, { type: "owner", id: userId });
  } catch (e) {
    if (e instanceof CloseOutNotAllowedError) {
      return { status: "error", error: "This booking can't be closed out yet." };
    }
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

export async function setDeposit(
  bookingId: string, _prev: BookingActionState, fd: FormData
): Promise<BookingActionState> {
  const { db, booking } = await ownerContext(bookingId);
  if (!toBookingView(booking, new Date()).depositControlActive) {
    return { status: "error", error: "The deposit can't be updated for this booking yet." };
  }
  const parsed = parseDepositStatus(fd);
  if (!parsed.ok) return { status: "error", error: parsed.error };
  await setDepositStatus(db, bookingId, parsed.status);
  revalidate(bookingId);
  return { status: "idle", error: "" };
}
