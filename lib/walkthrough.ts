import { and, eq, sql, isNull, gt, lte, asc } from "drizzle-orm";
import { walkthroughs, walkthroughPhotos, bookings } from "@/db/schema";
import type { Db } from "@/lib/domain/transitions";

export type Walkthrough = typeof walkthroughs.$inferSelect;
export type WalkthroughKind = "pre" | "post";

export function photoKey(walkthroughId: string, checklistItemId: string): string {
  return `walkthroughs/${walkthroughId}/${checklistItemId}.jpg`;
}

export async function getOrCreateWalkthrough(
  db: Db, bookingId: string, kind: WalkthroughKind, now: () => Date = () => new Date()
): Promise<Walkthrough> {
  await db.insert(walkthroughs)
    .values({ bookingId, kind, startedAt: now() })
    .onConflictDoNothing({ target: [walkthroughs.bookingId, walkthroughs.kind] });
  const [row] = await db.select().from(walkthroughs)
    .where(and(eq(walkthroughs.bookingId, bookingId), eq(walkthroughs.kind, kind)));
  return row;
}

export type Photo = typeof walkthroughPhotos.$inferSelect;
export class WalkthroughLockedError extends Error {}

export type StartCaptureDeps = { getUploadUrl: (key: string, contentType: string) => Promise<string> };

export async function startCapture(
  db: Db,
  args: { bookingId: string; kind: WalkthroughKind; checklistItemId: string; contentType?: string },
  deps: StartCaptureDeps
): Promise<{ key: string; uploadUrl: string; walkthroughId: string }> {
  const w = await getOrCreateWalkthrough(db, args.bookingId, args.kind);
  if (w.lockedAt) throw new WalkthroughLockedError("walkthrough is locked");
  const key = photoKey(w.id, args.checklistItemId);
  const uploadUrl = await deps.getUploadUrl(key, args.contentType ?? "image/jpeg");
  return { key, uploadUrl, walkthroughId: w.id };
}

export async function commitCapture(
  db: Db,
  args: { walkthroughId: string; checklistItemId: string; sha256: string; bytes: number;
          contentType: string; lat?: number | null; lng?: number | null },
  now: () => Date = () => new Date()
): Promise<Photo> {
  const [w] = await db.select().from(walkthroughs).where(eq(walkthroughs.id, args.walkthroughId));
  if (!w) throw new WalkthroughLockedError("walkthrough not found");
  if (w.lockedAt) throw new WalkthroughLockedError("walkthrough is locked");
  const [row] = await db.insert(walkthroughPhotos)
    .values({
      walkthroughId: args.walkthroughId, checklistItemId: args.checklistItemId,
      r2Key: photoKey(args.walkthroughId, args.checklistItemId),
      serverCapturedAt: now(), sha256: args.sha256, bytes: args.bytes,
      contentType: args.contentType, lat: args.lat ?? null, lng: args.lng ?? null,
    })
    .onConflictDoUpdate({
      target: [walkthroughPhotos.walkthroughId, walkthroughPhotos.checklistItemId],
      set: { r2Key: photoKey(args.walkthroughId, args.checklistItemId), serverCapturedAt: now(),
             sha256: args.sha256, bytes: args.bytes, contentType: args.contentType,
             lat: args.lat ?? null, lng: args.lng ?? null },
    })
    .returning();
  return row;
}

export class IncompleteWalkthroughError extends Error {}

export async function lockWalkthrough(
  db: Db, walkthroughId: string,
  opts: { requireItemCount?: number } = {}, now: () => Date = () => new Date()
): Promise<{ locked: boolean; alreadyLocked: boolean }> {
  if (opts.requireItemCount != null) {
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(walkthroughPhotos)
      .where(eq(walkthroughPhotos.walkthroughId, walkthroughId));
    if (count < opts.requireItemCount) {
      throw new IncompleteWalkthroughError(`need ${opts.requireItemCount} photos, have ${count}`);
    }
  }
  const updated = await db.update(walkthroughs)
    .set({ lockedAt: now() })
    .where(and(eq(walkthroughs.id, walkthroughId), isNull(walkthroughs.lockedAt)))
    .returning({ id: walkthroughs.id });
  if (updated.length > 0) return { locked: true, alreadyLocked: false };
  return { locked: false, alreadyLocked: true };
}

export async function skipWalkthrough(db: Db, bookingId: string): Promise<void> {
  await db.update(bookings).set({ depositProtected: false }).where(eq(bookings.id, bookingId));
}

export async function getWalkthroughWithPhotos(
  db: Db, bookingId: string, kind: WalkthroughKind
): Promise<{ walkthrough: Walkthrough; photos: Photo[] } | null> {
  const [w] = await db.select().from(walkthroughs)
    .where(and(eq(walkthroughs.bookingId, bookingId), eq(walkthroughs.kind, kind)));
  if (!w) return null;
  const photos = await db.select().from(walkthroughPhotos)
    .where(eq(walkthroughPhotos.walkthroughId, w.id))
    .orderBy(asc(walkthroughPhotos.serverCapturedAt));
  return { walkthrough: w, photos };
}

export async function getWalkthroughSummary(
  db: Db, bookingId: string
): Promise<{ preLocked: boolean; postLocked: boolean }> {
  const rows = await db.select().from(walkthroughs).where(eq(walkthroughs.bookingId, bookingId));
  const pre = rows.find((r) => r.kind === "pre");
  const post = rows.find((r) => r.kind === "post");
  return { preLocked: !!pre?.lockedAt, postLocked: !!post?.lockedAt };
}

export async function bookingsNeedingPreReminder(
  db: Db, now: Date, windowHours: number
): Promise<{ bookingId: string; studioId: string }[]> {
  const end = new Date(now.getTime() + windowHours * 3600_000);
  const rows = await db.select({ bookingId: bookings.id, studioId: bookings.studioId })
    .from(bookings)
    .where(and(
      eq(bookings.state, "confirmed"),
      gt(bookings.startsAt, now),
      lte(bookings.startsAt, end),
      isNull(bookings.preReminderSentAt),
    ));
  // Exclude those with a started pre-walkthrough.
  const started = await db.select({ bookingId: walkthroughs.bookingId })
    .from(walkthroughs).where(eq(walkthroughs.kind, "pre"));
  const startedSet = new Set(started.map((r) => r.bookingId));
  return rows.filter((r) => !startedSet.has(r.bookingId));
}

export async function markPreReminderSent(db: Db, bookingId: string, at: Date): Promise<void> {
  await db.update(bookings).set({ preReminderSentAt: at }).where(eq(bookings.id, bookingId));
}
