import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { renterTokens } from "@/db/schema";
import type { Db } from "@/lib/domain/transitions";

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/**
 * Mint a booking-scoped token (spec §7). Returns the RAW token for the email
 * link; only its SHA-256 hash is stored. One active token per
 * (booking, purpose): re-minting rotates, invalidating the previous link.
 */
export async function mintRenterToken(
  db: Db,
  bookingId: string,
  purpose: string,
  expiresAt: Date
): Promise<string> {
  const raw = randomBytes(32).toString("base64url");
  await db.transaction(async (tx) => {
    await tx
      .delete(renterTokens)
      .where(and(eq(renterTokens.bookingId, bookingId), eq(renterTokens.purpose, purpose)));
    await tx.insert(renterTokens).values({ bookingId, purpose, tokenHash: hashToken(raw), expiresAt });
  });
  return raw;
}

/** Returns the booking id for a live token of the given purpose, else null. */
export async function verifyRenterToken(db: Db, rawToken: string, purpose: string): Promise<string | null> {
  const [row] = await db
    .select({ bookingId: renterTokens.bookingId })
    .from(renterTokens)
    .where(
      and(
        eq(renterTokens.tokenHash, hashToken(rawToken)),
        eq(renterTokens.purpose, purpose),
        gt(renterTokens.expiresAt, new Date())
      )
    );
  return row?.bookingId ?? null;
}
