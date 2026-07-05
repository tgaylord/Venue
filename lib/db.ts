import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import * as schema from "@/db/schema";

let _sql: ReturnType<typeof neon<false, false>> | null = null;
let _db: NeonHttpDatabase<typeof schema> | null = null;

function init() {
  if (!_db) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    _sql = neon(url);
    _db = drizzle(_sql, { schema });
  }
  return { db: _db, sql: _sql! };
}

export function getSql() {
  return init().sql;
}

export function getDb() {
  return init().db;
}
