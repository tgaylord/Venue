import { auth } from "@clerk/nextjs/server";
import { redirect, notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { getStudioByClerkUserId } from "@/lib/studio";
import { getBookingForOwner } from "@/lib/booking";
import { getWalkthroughWithPhotos } from "@/lib/walkthrough";
import { parseKind } from "@/lib/capture";
import { getSignedDownloadUrl } from "@/lib/storage";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; kind: string; photoId: string }> }
) {
  const { id, kind, photoId } = await params;
  const k = parseKind(kind); if (!k) notFound();
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");
  const db = getDb();
  const studio = await getStudioByClerkUserId(db, userId);
  if (!studio) redirect("/settings");
  const booking = await getBookingForOwner(db, id, studio.id);
  if (!booking) notFound();
  const wp = await getWalkthroughWithPhotos(db, id, k);
  const photo = wp?.photos.find((p) => p.id === photoId);
  if (!photo) notFound();
  const url = await getSignedDownloadUrl(photo.r2Key, 300);
  return Response.redirect(url, 302);
}
