import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyRenterToken } from "@/lib/tokens";
import { getContractForBooking } from "@/lib/contract";
import { getSignedDownloadUrl } from "@/lib/storage";

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const db = getDb();
  const bookingId = await verifyRenterToken(db, token, "status");
  if (!bookingId) return new NextResponse("Not found", { status: 404 });
  const contract = await getContractForBooking(db, bookingId);
  if (!contract?.pdfR2Key) return new NextResponse("No contract yet", { status: 404 });
  const url = await getSignedDownloadUrl(contract.pdfR2Key, 300);
  return NextResponse.redirect(url);
}
