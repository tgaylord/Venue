import { atlantaSlotToUtc } from "@/lib/tz";

export type Interval = { startsAt: Date; endsAt: Date };

/** Half-open overlap: shared interior time, but back-to-back (end == start) does not count. */
export function overlaps(a: Interval, b: Interval): boolean {
  return a.startsAt.getTime() < b.endsAt.getTime() && b.startsAt.getTime() < a.endsAt.getTime();
}

export function hasConflict(candidate: Interval, busy: Interval[]): boolean {
  return busy.some((b) => overlaps(candidate, b));
}

export function availableStartHours(
  dateISO: string, startHours: number[], minHours: number, busy: Interval[]
): number[] {
  return startHours.filter((h) => !hasConflict(atlantaSlotToUtc(dateISO, h, minHours), busy));
}
