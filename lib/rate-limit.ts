import { sql } from "drizzle-orm";
import { rateLimits } from "@/db/schema";
import type { Db } from "@/lib/domain/transitions";

/**
 * Fixed-window rate limit, atomic in a single upsert. Increments the counter
 * for `key`; if the current window has expired, resets it to 1 and restarts
 * the window. Returns whether this request is within `limit` and, if not, how
 * long until the window resets. DB-backed (works across serverless instances).
 */
export async function checkRateLimit(
  db: Db, key: string, limit: number, windowMs: number
): Promise<{ allowed: boolean; retryAfterMs: number }> {
  const windowSecs = Math.ceil(windowMs / 1000);
  const expired = () =>
    sql`${rateLimits.windowStartedAt} < now() - make_interval(secs => ${windowSecs})`;

  const [row] = await db
    .insert(rateLimits)
    .values({ key, count: 1, windowStartedAt: sql`now()` })
    .onConflictDoUpdate({
      target: rateLimits.key,
      set: {
        count: sql`CASE WHEN ${expired()} THEN 1 ELSE ${rateLimits.count} + 1 END`,
        windowStartedAt: sql`CASE WHEN ${expired()} THEN now() ELSE ${rateLimits.windowStartedAt} END`,
      },
    })
    .returning({ count: rateLimits.count, windowStartedAt: rateLimits.windowStartedAt });

  const allowed = row.count <= limit;
  const elapsedMs = Date.now() - row.windowStartedAt.getTime();
  return { allowed, retryAfterMs: allowed ? 0 : Math.max(0, windowMs - elapsedMs) };
}
