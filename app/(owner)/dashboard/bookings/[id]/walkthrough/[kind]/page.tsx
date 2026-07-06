import { auth } from "@clerk/nextjs/server";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getDb } from "@/lib/db";
import { getStudioByClerkUserId } from "@/lib/studio";
import { getBookingForOwner } from "@/lib/booking";
import { getWalkthroughWithPhotos } from "@/lib/walkthrough";
import { deriveEffectiveState } from "@/lib/domain/effective-state";
import { parseKind } from "@/lib/capture";
import { checklistItems } from "@/db/schema";
import { asc, eq } from "drizzle-orm";
import CaptureFlow from "./_components/CaptureFlow";

export default async function WalkthroughPage(
  { params }: { params: Promise<{ id: string; kind: string }> }
) {
  const { id, kind } = await params;
  const k = parseKind(kind); if (!k) notFound();
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");
  const db = getDb();
  const studio = await getStudioByClerkUserId(db, userId);
  if (!studio) redirect("/settings");
  const booking = await getBookingForOwner(db, id, studio.id);
  if (!booking) notFound();

  const effective = deriveEffectiveState(booking, new Date());
  const preOk = k === "pre" && (effective === "confirmed" || effective === "event_day");
  const postOk = k === "post" && effective === "post_event";
  if (!preOk && !postOk) {
    // Not yet due (or already past) — send them back to the detail page.
    redirect(`/dashboard/bookings/${id}`);
  }

  const items = await db.select().from(checklistItems)
    .where(eq(checklistItems.studioId, studio.id)).orderBy(asc(checklistItems.position));
  const existing = await getWalkthroughWithPhotos(db, id, k);

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-4 py-4">
      <Link href={`/dashboard/bookings/${id}`} className="text-sm text-owner-muted hover:text-owner-text">← Back</Link>
      <CaptureFlow
        bookingId={id}
        kind={k}
        renterName={booking.renterName}
        locked={!!existing?.walkthrough.lockedAt}
        items={items.map((it) => ({ id: it.id, name: it.name, hint: it.hint }))}
        captured={(existing?.photos ?? []).map((p) => ({ checklistItemId: p.checklistItemId, serverCapturedAt: p.serverCapturedAt.toISOString() }))}
      />
    </main>
  );
}
