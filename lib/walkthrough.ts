import { and, eq } from "drizzle-orm";
import { walkthroughs } from "@/db/schema";
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
