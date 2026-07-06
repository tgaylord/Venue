import { parseKind } from "@/lib/capture";

export const REMINDER_WINDOW_HOURS = 3;

export function coerceKind(raw: string): "pre" | "post" | null {
  return parseKind(raw);
}
