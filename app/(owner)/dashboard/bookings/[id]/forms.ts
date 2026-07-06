import type { DepositStatus } from "@/lib/booking";

export const DEPOSIT_STATUSES: readonly DepositStatus[] = ["uncollected", "collected", "returned"];

export const DEPOSIT_LABELS: Record<DepositStatus, string> = {
  uncollected: "Uncollected",
  collected: "Collected",
  returned: "Returned",
};

export type BookingActionState = { status: "idle" | "error"; error: string };
export const BOOKING_ACTION_IDLE: BookingActionState = { status: "idle", error: "" };

export function parseDepositStatus(
  fd: FormData
): { ok: true; status: DepositStatus } | { ok: false; error: string } {
  const s = String(fd.get("status") ?? "");
  if (!(DEPOSIT_STATUSES as readonly string[]).includes(s)) {
    return { ok: false, error: "Unknown deposit status." };
  }
  return { ok: true, status: s as DepositStatus };
}
