"use server";

import { auth } from "@clerk/nextjs/server";
import { redirect, notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import { getStudioByClerkUserId, getChecklistForStudio } from "@/lib/studio";
import { getBookingForOwner } from "@/lib/booking";
import { getSignedUploadUrl } from "@/lib/storage";
import {
  startCapture, commitCapture, lockWalkthrough, skipWalkthrough,
  getOrCreateWalkthrough,
  WalkthroughLockedError, IncompleteWalkthroughError,
} from "@/lib/walkthrough";
import { coerceKind } from "./forms";

async function ctx(bookingId: string) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");
  const db = getDb();
  const studio = await getStudioByClerkUserId(db, userId);
  if (!studio) redirect("/settings");
  const booking = await getBookingForOwner(db, bookingId, studio.id);
  if (!booking) notFound();
  return { db, studio, booking };
}

export async function requestUpload(
  bookingId: string, kind: string, checklistItemId: string, contentType: string
) {
  const k = coerceKind(kind);
  if (!k) return { ok: false as const, error: "bad kind" };
  const { db } = await ctx(bookingId);
  try {
    const r = await startCapture(db, { bookingId, kind: k, checklistItemId, contentType },
      { getUploadUrl: (key, ct) => getSignedUploadUrl(key, ct) });
    return { ok: true as const, ...r };
  } catch (e) {
    if (e instanceof WalkthroughLockedError) return { ok: false as const, error: "This walkthrough is locked." };
    throw e;
  }
}

export async function commitPhoto(
  bookingId: string, kind: string,
  input: {
    walkthroughId: string; checklistItemId: string; sha256: string; bytes: number;
    contentType: string; lat: number | null; lng: number | null;
  }
) {
  const { db } = await ctx(bookingId);
  try {
    await commitCapture(db, input);
    revalidatePath(`/dashboard/bookings/${bookingId}/walkthrough/${kind}`);
    return { ok: true as const };
  } catch (e) {
    if (e instanceof WalkthroughLockedError) return { ok: false as const, error: "This walkthrough is locked." };
    throw e;
  }
}

export async function lockWalkthroughAction(bookingId: string, kind: string) {
  const k = coerceKind(kind);
  if (!k) return { ok: false as const, error: "bad kind" };
  const { db, studio } = await ctx(bookingId);
  const w = await getOrCreateWalkthrough(db, bookingId, k);
  try {
    const items = await getChecklistForStudio(db, studio.id);
    await lockWalkthrough(db, w.id, { requireItemCount: items.length });
  } catch (e) {
    if (e instanceof IncompleteWalkthroughError) return { ok: false as const, error: "Capture every area before locking." };
    throw e;
  }
  revalidatePath(`/dashboard/bookings/${bookingId}`);
  revalidatePath(`/dashboard/bookings/${bookingId}/walkthrough/${kind}`);
  return { ok: true as const };
}

export async function skipWalkthroughAction(bookingId: string) {
  const { db } = await ctx(bookingId);
  await skipWalkthrough(db, bookingId);
  revalidatePath(`/dashboard/bookings/${bookingId}`);
  return { ok: true as const };
}
