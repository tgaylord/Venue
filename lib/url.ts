import { headers } from "next/headers";

/**
 * Origin for building absolute links in transactional email. Prefers APP_URL
 * (set on Production only); otherwise falls back to the request host so each
 * preview/dev deploy links to itself. Node runtime (uses next/headers).
 */
export async function baseUrl(): Promise<string> {
  const configured = process.env.APP_URL;
  if (configured) return configured.replace(/\/+$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? "https";
  return `${proto}://${host}`;
}
