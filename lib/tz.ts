const TZ = "America/New_York";

/** Timezone offset (minutes east of UTC, negative for the Americas) at a UTC instant. */
function offsetMinutes(utc: Date): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const p = Object.fromEntries(dtf.formatToParts(utc).map((x) => [x.type, x.value]));
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return (asUTC - utc.getTime()) / 60000;
}

/** Interpret y-mo-d-h-min as America/New_York wall-clock; return the matching UTC Date. */
function atlantaWallClockToUtc(y: number, mo: number, d: number, h: number, min: number): Date {
  const guess = Date.UTC(y, mo - 1, d, h, min); // pretend wall-clock is UTC
  const off1 = offsetMinutes(new Date(guess)); // offset near the guessed instant
  const off2 = offsetMinutes(new Date(guess - off1 * 60000)); // offset at (near) the true instant
  return new Date(guess - off2 * 60000); // utc = wallclock - offset
}

export function atlantaSlotToUtc(
  dateISO: string, startHour: number, durationHours: number
): { startsAt: Date; endsAt: Date } {
  const [y, mo, d] = dateISO.split("-").map(Number);
  // Hour overflow (e.g. 20 + 6 = 26) rolls into the next day via Date.UTC.
  return {
    startsAt: atlantaWallClockToUtc(y, mo, d, startHour, 0),
    endsAt: atlantaWallClockToUtc(y, mo, d, startHour + durationHours, 0),
  };
}

export function formatAtlantaRange(startsAt: Date, endsAt: Date): string {
  const day = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, weekday: "short", month: "short", day: "numeric",
  }).format(startsAt);
  const t = (dt: Date) =>
    new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" }).format(dt);
  return `${day}, ${t(startsAt)} – ${t(endsAt)}`;
}
