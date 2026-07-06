// app/(public)/book/[slug]/actions.ts
"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { clerkClient } from "@clerk/nextjs/server";
import { getDb } from "@/lib/db";
import { getStudioBySlug, getSpacesForStudio, maxOccupancyOf } from "@/lib/studio";
import { createBooking, getBusyIntervals, type TermsSnapshot } from "@/lib/booking";
import { hasConflict } from "@/lib/availability";
import { atlantaSlotToUtc, formatAtlantaRange } from "@/lib/tz";
import {
  sendEmail, renderOwnerBookingRequest, renderRenterRequestReceived,
} from "@/lib/email";
import { checkRateLimit } from "@/lib/rate-limit";
import { parseIntake, type BookFormState } from "./forms";

const BOOK_RATE_LIMIT = 5;
const BOOK_RATE_WINDOW_MS = 10 * 60 * 1000; // 10 minutes per IP

async function baseUrl(): Promise<string> {
  const configured = process.env.APP_URL;
  if (configured) return configured.replace(/\/+$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? "https";
  return `${proto}://${host}`;
}

async function clientIp(): Promise<string> {
  const h = await headers();
  const fwd = h.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return h.get("x-real-ip") ?? "unknown";
}

async function ownerEmail(clerkUserId: string): Promise<string | null> {
  try {
    const client = await clerkClient();
    const user = await client.users.getUser(clerkUserId);
    return user.emailAddresses.find((e) => e.id === user.primaryEmailAddressId)?.emailAddress ?? null;
  } catch {
    return null;
  }
}

export async function submitBooking(
  slug: string, _prev: BookFormState, fd: FormData
): Promise<BookFormState> {
  // Honeypot — real users never fill this; bounce silently to the studio page.
  if (String(fd.get("contact_preference_x") ?? "").length > 0) redirect(`/book/${slug}`);

  const db = getDb();
  const ip = await clientIp();
  const rl = await checkRateLimit(db, `book:${ip}`, BOOK_RATE_LIMIT, BOOK_RATE_WINDOW_MS);
  if (!rl.allowed) {
    return { status: "error", error: "Too many requests — please wait a few minutes and try again." };
  }

  const parsed = parseIntake(fd);
  if (!parsed.ok) return { status: "error", error: parsed.error };
  const data = parsed.data;

  const studio = await getStudioBySlug(db, slug);
  if (!studio || !studio.onboardingCompletedAt) return { status: "error", error: "This studio isn't taking bookings right now." };

  if (data.durationHours < (studio.minHours ?? 1)) {
    return { status: "error", error: `This studio has a ${studio.minHours ?? 1}-hour minimum.` };
  }

  const { startsAt, endsAt } = atlantaSlotToUtc(data.dateISO, data.startHour, data.durationHours);

  // Re-validate availability at submit time (slot may have been taken since page load).
  const busy = await getBusyIntervals(db, studio.id, startsAt, endsAt);
  if (hasConflict({ startsAt, endsAt }, busy)) {
    return { status: "error", error: "That time was just taken — please pick another slot." };
  }

  const spaces = await getSpacesForStudio(db, studio.id);
  const maxOccupancy = maxOccupancyOf(spaces);
  const termsSnapshot: TermsSnapshot = {
    hourlyRateCents: studio.hourlyRateCents, minHours: studio.minHours,
    cancellationLadder: studio.cancellationLadder,
    alcoholPolicy: studio.alcoholPolicy, vendorPolicy: studio.vendorPolicy,
    noiseCurfew: studio.noiseCurfew, cleanupWindowMin: studio.cleanupWindowMin, maxOccupancy,
  };

  const { statusToken } = await createBooking(db, {
    studioId: studio.id,
    renterName: data.renterName, renterEmail: data.renterEmail, renterPhone: data.renterPhone,
    eventType: data.eventType, headcount: data.headcount,
    byob: data.byob, outsideVendors: data.outsideVendors, notes: data.notes,
    startsAt, endsAt, depositCents: studio.depositCents, termsSnapshot,
  });

  const origin = await baseUrl();
  const when = formatAtlantaRange(startsAt, endsAt);

  // Best-effort notifications — a send failure must not fail the booking.
  try {
    const to = await ownerEmail(studio.clerkUserId);
    if (to) {
      await sendEmail({
        to, subject: `New booking request — ${data.renterName}`,
        html: await renderOwnerBookingRequest({
          studioName: studio.name, renterName: data.renterName, eventType: data.eventType, when,
          headcount: data.headcount, byob: data.byob, outsideVendors: data.outsideVendors,
          notes: data.notes, dashboardUrl: `${origin}/dashboard`,
        }),
      });
    }
  } catch (e) {
    console.error("owner notification failed (booking stands):", e);
  }
  try {
    await sendEmail({
      to: data.renterEmail, subject: `Request sent to ${studio.name}`,
      html: await renderRenterRequestReceived({
        studioName: studio.name, when, statusUrl: `${origin}/status/${statusToken}`,
      }),
    });
  } catch (e) {
    console.error("renter confirmation failed (booking stands):", e);
  }

  redirect(`/status/${statusToken}`);
}
