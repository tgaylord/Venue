import { Resend } from "resend";

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

export type WaitlistResult =
  | { ok: true }
  | { ok: false; reason: "invalid_email" | "api_error" };

export async function addWaitlistContact(email: string): Promise<WaitlistResult> {
  if (!isValidEmail(email)) return { ok: false, reason: "invalid_email" };

  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.error("addWaitlistContact: RESEND_API_KEY is not set");
    return { ok: false, reason: "api_error" };
  }

  const resend = new Resend(key);
  const { error } = await resend.contacts.create({
    email: email.trim().toLowerCase(),
  });

  // A duplicate signup is a success from the visitor's point of view.
  if (error && !/already exist/i.test(error.message)) {
    console.error("addWaitlistContact: Resend contacts.create failed:", error);
    return { ok: false, reason: "api_error" };
  }
  return { ok: true };
}
