import { eq } from "drizzle-orm";
import { contracts, type Booking } from "@/db/schema";
import { transitionBooking, type Actor, type Db } from "@/lib/domain/transitions";
import { contractInputFromBooking } from "@/lib/contract/input";
import { buildStandardContract } from "@/lib/contract/template";
import type { ContractDoc } from "@/lib/contract/types";

export type Contract = typeof contracts.$inferSelect;

export function contractKey(bookingId: string): string {
  return `contracts/${bookingId}/agreement.pdf`;
}

export async function getContractForBooking(db: Db, bookingId: string): Promise<Contract | null> {
  const [row] = await db.select().from(contracts).where(eq(contracts.bookingId, bookingId));
  return row ?? null;
}

export async function upsertContract(
  db: Db, bookingId: string, pdfR2Key: string, sentAt: Date
): Promise<Contract> {
  const [row] = await db
    .insert(contracts)
    .values({ bookingId, template: "standard", status: "sent", pdfR2Key, sentAt })
    .onConflictDoUpdate({
      target: contracts.bookingId,
      set: { pdfR2Key, status: "sent", sentAt },
    })
    .returning();
  return row;
}

export async function markContractSigned(db: Db, bookingId: string, signedAt: Date): Promise<void> {
  await db.update(contracts).set({ status: "signed", signedAt }).where(eq(contracts.bookingId, bookingId));
}

export type GenerateDeps = {
  render: (doc: ContractDoc) => Promise<Buffer>;
  put: (key: string, body: Buffer, contentType: string) => Promise<void>;
  now?: () => Date;
};

export type StudioIdentity = { studioName: string; studioAddress: string | null; equipmentList: string | null };

/**
 * One owner gesture: pending → awaiting_contract → awaiting_signature.
 * First hop commits independently so a render/put failure leaves the booking
 * in awaiting_contract with a working standalone generateAndAdvance recovery.
 */
export async function approveAndSendContract(
  db: Db, booking: Booking, identity: StudioIdentity, deps: GenerateDeps, actor: Actor
): Promise<Contract> {
  await transitionBooking(db, booking.id, "awaiting_contract", actor, {
    expectedFrom: "pending",
  });
  const fresh = { ...booking, state: "awaiting_contract" as const };
  return generateAndAdvance(db, fresh, identity, deps, actor);
}

/**
 * Render → store → upsert row → advance state. transitionBooking's CAS is the
 * sole idempotency/race guard: a second call from awaiting_signature throws
 * IllegalTransitionError, which the caller surfaces as "already generated".
 */
export async function generateAndAdvance(
  db: Db, booking: Booking, identity: StudioIdentity, deps: GenerateDeps, actor: Actor
): Promise<Contract> {
  const now = deps.now?.() ?? new Date();
  const doc = buildStandardContract(contractInputFromBooking(booking, identity));
  const bytes = await deps.render(doc);
  const key = contractKey(booking.id);
  await deps.put(key, bytes, "application/pdf");
  const contract = await upsertContract(db, booking.id, key, now);
  await transitionBooking(db, booking.id, "awaiting_signature", actor, { meta: { contractId: contract.id } });
  return contract;
}
