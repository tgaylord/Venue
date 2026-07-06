export const EVENT_TYPES = [
  "Birthday celebration",
  "Baby or bridal shower",
  "Listening session / release party",
  "Brand event / pop-up",
  "Creative production with guests",
  "Other private event",
] as const;

export const START_HOURS = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21];
export const DURATION_OPTIONS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

export type BookFormState = { status: "idle" | "error"; error: string };
export const BOOK_IDLE: BookFormState = { status: "idle", error: "" };

export type ParsedIntake = {
  renterName: string;
  renterEmail: string;
  renterPhone: string | null;
  eventType: string;
  headcount: number;
  byob: boolean;
  outsideVendors: boolean;
  notes: string | null;
  dateISO: string;
  startHour: number;
  durationHours: number;
};

const str = (fd: FormData, key: string) => String(fd.get(key) ?? "").trim();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function parseIntake(
  fd: FormData
): { ok: true; data: ParsedIntake } | { ok: false; error: string } {
  const renterName = str(fd, "renterName");
  if (!renterName) return { ok: false, error: "Please add your name." };

  const renterEmail = str(fd, "renterEmail").toLowerCase();
  if (!EMAIL_RE.test(renterEmail)) return { ok: false, error: "That doesn't look like an email address." };

  const eventType = str(fd, "eventType");
  if (!(EVENT_TYPES as readonly string[]).includes(eventType)) return { ok: false, error: "Pick an event type." };

  const headRaw = str(fd, "headcount");
  const headcount = parseInt(headRaw, 10);
  if (!/^\d+$/.test(headRaw) || headcount < 1) return { ok: false, error: "Enter an estimated headcount." };

  const dateISO = str(fd, "dateISO");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateISO)) return { ok: false, error: "Pick a date." };

  const startRaw = str(fd, "startHour");
  const startHour = parseInt(startRaw, 10);
  if (!(START_HOURS as number[]).includes(startHour)) return { ok: false, error: "Pick a start time." };

  const durRaw = str(fd, "durationHours");
  const durationHours = parseInt(durRaw, 10);
  if (!(DURATION_OPTIONS as number[]).includes(durationHours)) return { ok: false, error: "Pick a duration." };

  const phone = str(fd, "renterPhone");
  const notes = str(fd, "notes");
  return {
    ok: true,
    data: {
      renterName, renterEmail, renterPhone: phone || null,
      eventType, headcount,
      byob: str(fd, "byob") === "on",
      outsideVendors: str(fd, "outsideVendors") === "on",
      notes: notes || null,
      dateISO, startHour, durationHours,
    },
  };
}
