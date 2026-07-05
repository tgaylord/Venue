import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import ws from "ws";
import * as schema from "@/db/schema";

// Node 20 has no stable global WebSocket; the Neon Pool needs one.
neonConfig.webSocketConstructor = ws;

function requiredUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  return url;
}

// Lazy singletons: nothing connects (or throws) at import time, so builds
// and CI (no DATABASE_URL) stay green until a query actually runs.
let _pool: Pool | undefined;
export function getPool(): Pool {
  return (_pool ??= new Pool({ connectionString: requiredUrl() }));
}

let _db: ReturnType<typeof drizzle<typeof schema>> | undefined;
export function getDb() {
  return (_db ??= drizzle(getPool(), { schema }));
}
