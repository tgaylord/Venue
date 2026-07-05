import { parseDollarsToCents } from "@/lib/money";
import type { SpaceInput } from "@/lib/studio";

export const ALCOHOL_POLICIES = ["byob_with_acknowledgment", "prohibited", "licensed_bartender_only"] as const;
export const VENDOR_POLICIES = ["pre_approval", "allowed"] as const;

export type ParseResult<T> = { ok: true; data: T } | { ok: false; fieldErrors: Record<string, string> };

const str = (fd: FormData, key: string) => String(fd.get(key) ?? "").trim();
const optional = (s: string) => (s.length > 0 ? s : null);

export function parseProfileForm(fd: FormData): ParseResult<{
  name: string; address: string | null; equipmentList: string | null; spaces: SpaceInput[];
}> {
  const fieldErrors: Record<string, string> = {};
  const name = str(fd, "name");
  if (!name) fieldErrors.name = "Studio name is required.";

  const names = fd.getAll("spaceName").map(String);
  const caps = fd.getAll("spaceCap").map(String);
  const spaces: SpaceInput[] = [];
  for (let i = 0; i < names.length; i++) {
    const n = names[i].trim();
    if (!n) continue; // blank row — ignore
    const capRaw = (caps[i] ?? "").trim();
    if (capRaw && !/^\d+$/.test(capRaw)) {
      fieldErrors.spaces = "Occupancy caps must be whole numbers.";
      break;
    }
    spaces.push({ name: n, maxOccupancy: capRaw ? parseInt(capRaw, 10) : null });
  }

  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };
  return { ok: true, data: { name, address: optional(str(fd, "address")), equipmentList: optional(str(fd, "equipmentList")), spaces } };
}

export function parseRulesForm(fd: FormData): ParseResult<{
  alcoholPolicy: string; vendorPolicy: string; noiseCurfew: string | null; cleanupWindowMin: number | null;
}> {
  const fieldErrors: Record<string, string> = {};
  const alcoholPolicy = str(fd, "alcoholPolicy");
  const vendorPolicy = str(fd, "vendorPolicy");
  if (!(ALCOHOL_POLICIES as readonly string[]).includes(alcoholPolicy)) fieldErrors.alcoholPolicy = "Pick an alcohol policy.";
  if (!(VENDOR_POLICIES as readonly string[]).includes(vendorPolicy)) fieldErrors.vendorPolicy = "Pick a vendor policy.";

  const curfew = str(fd, "noiseCurfew");
  if (curfew.length > 40) fieldErrors.noiseCurfew = "Keep the curfew under 40 characters.";

  const cleanupRaw = str(fd, "cleanupWindowMin");
  let cleanupWindowMin: number | null = null;
  if (cleanupRaw) {
    const n = parseInt(cleanupRaw, 10);
    if (!/^\d+$/.test(cleanupRaw) || n < 1 || n > 720) fieldErrors.cleanupWindowMin = "Cleanup window must be 1-720 minutes.";
    else cleanupWindowMin = n;
  }

  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };
  return { ok: true, data: { alcoholPolicy, vendorPolicy, noiseCurfew: optional(curfew), cleanupWindowMin } };
}

export function parsePricingForm(fd: FormData): ParseResult<{
  hourlyRateCents: number; minHours: number; depositCents: number;
}> {
  const fieldErrors: Record<string, string> = {};
  const hourlyRateCents = parseDollarsToCents(str(fd, "hourlyRate"));
  if (hourlyRateCents === null) fieldErrors.hourlyRate = "Enter an hourly rate like $165.";
  const depositCents = parseDollarsToCents(str(fd, "deposit"));
  if (depositCents === null) fieldErrors.deposit = "Enter a deposit amount like $400.";
  const minHoursRaw = str(fd, "minHours");
  const minHours = parseInt(minHoursRaw, 10);
  if (!/^\d+$/.test(minHoursRaw) || minHours < 1 || minHours > 24) fieldErrors.minHours = "Minimum hours must be 1-24.";

  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };
  return { ok: true, data: { hourlyRateCents: hourlyRateCents!, minHours, depositCents: depositCents! } };
}

export function parseChecklistForm(fd: FormData): ParseResult<{ items: { name: string; hint: string | null }[] }> {
  const names = fd.getAll("itemName").map(String);
  const hints = fd.getAll("itemHint").map(String);
  const items: { name: string; hint: string | null }[] = [];
  for (let i = 0; i < names.length; i++) {
    const name = names[i].trim();
    if (!name) continue;
    if (name.length > 60) return { ok: false, fieldErrors: { items: "Area names must be under 60 characters." } };
    const hint = (hints[i] ?? "").trim();
    if (hint.length > 120) return { ok: false, fieldErrors: { items: "Hints must be under 120 characters." } };
    items.push({ name, hint: hint || null });
  }
  if (items.length < 1 || items.length > 20) {
    return { ok: false, fieldErrors: { items: "Add between 1 and 20 areas." } };
  }
  return { ok: true, data: { items } };
}
