import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { getDb } from "@/lib/db";
import { bookingsNeedingPreReminder, markPreReminderSent } from "@/lib/walkthrough";
import { getBookingForOwner } from "@/lib/booking";
import { getStudioById } from "@/lib/studio";
import { clerkClient } from "@clerk/nextjs/server";
import { sendEmail, renderWalkthroughReminder } from "@/lib/email";
import { formatAtlantaRange } from "@/lib/tz";
import { baseUrl } from "@/lib/url";
import { REMINDER_WINDOW_HOURS } from "@/app/(owner)/dashboard/bookings/[id]/walkthrough/[kind]/forms";

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const a = Buffer.from(token);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const db = getDb();
  const now = new Date();
  const due = await bookingsNeedingPreReminder(db, now, REMINDER_WINDOW_HOURS);
  let sent = 0;
  for (const { bookingId, studioId } of due) {
    try {
      const studio = await getStudioById(db, studioId);
      const booking = studio ? await getBookingForOwner(db, bookingId, studioId) : null;
      if (!studio || !booking) continue;
      const user = await (await clerkClient()).users.getUser(studio.clerkUserId);
      const to = user.primaryEmailAddress?.emailAddress;
      if (!to) continue;
      const html = await renderWalkthroughReminder({
        renterName: booking.renterName,
        startsAtLabel: formatAtlantaRange(booking.startsAt, booking.endsAt),
        bookingUrl: `${await baseUrl()}/dashboard/bookings/${bookingId}`,
      });
      await sendEmail({ to, subject: "Pre-event walkthrough reminder", html });
      await markPreReminderSent(db, bookingId, now);
      sent++;
    } catch (e) {
      console.error("reminder failed for", bookingId, e); // best-effort; do not stamp on failure
    }
  }
  return NextResponse.json({ due: due.length, sent });
}
