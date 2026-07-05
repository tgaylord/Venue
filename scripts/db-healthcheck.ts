import { getDb, getPool } from "@/lib/db";
import { sql } from "drizzle-orm";

async function main() {
  const result = await getDb().execute(sql`SELECT 1 AS ok`);
  const row = result.rows[0] as { ok: number } | undefined;
  if (row?.ok !== 1) throw new Error("Healthcheck failed");
  console.log("DB healthcheck OK:", row);
  await getPool().end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
