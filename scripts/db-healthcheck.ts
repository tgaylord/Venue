import { sql } from "@/lib/db";

async function main() {
  const rows = await sql`SELECT 1 AS ok`;
  if (rows[0]?.ok !== 1) throw new Error("Healthcheck failed");
  console.log("DB healthcheck OK:", rows[0]);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
