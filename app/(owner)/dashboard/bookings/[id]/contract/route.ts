import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getStudioByClerkUserId } from "@/lib/studio";
import { getBookingForOwner } from "@/lib/booking";
import { getContractForBooking } from "@/lib/contract";
import { getSignedDownloadUrl } from "@/lib/storage";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { userId } = await auth();
  if (!userId) return new NextResponse("Unauthorized", { status: 401 });
  const db = getDb();
  const studio = await getStudioByClerkUserId(db, userId);
  if (!studio) return new NextResponse("No studio", { status: 404 });
  const booking = await getBookingForOwner(db, id, studio.id);
  if (!booking) return new NextResponse("Not found", { status: 404 });
  const contract = await getContractForBooking(db, id);
  if (!contract?.pdfR2Key) return new NextResponse("No contract yet", { status: 404 });
  const url = await getSignedDownloadUrl(contract.pdfR2Key, 300);
  return NextResponse.redirect(url);
}
