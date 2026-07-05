"use server";

import { addWaitlistContact } from "@/lib/waitlist";

export type WaitlistFormState = {
  status: "idle" | "success" | "error";
  message: string;
};

const SUCCESS = "You're on the list — we'll be in touch when onboarding opens.";
// Swap for a venuedash.com address once the domain exists.
const CONTACT_EMAIL = "tgaylord2024@gmail.com";

export async function joinWaitlist(
  _prev: WaitlistFormState,
  formData: FormData
): Promise<WaitlistFormState> {
  // Honeypot: real users never see or fill the "company" field.
  if (String(formData.get("company") ?? "").length > 0) {
    return { status: "success", message: SUCCESS };
  }

  const result = await addWaitlistContact(String(formData.get("email") ?? ""));
  if (result.ok) return { status: "success", message: SUCCESS };
  if (result.reason === "invalid_email") {
    return { status: "error", message: "That doesn't look like an email address — mind checking it?" };
  }
  return {
    status: "error",
    message: `Something went wrong on our end. Email ${CONTACT_EMAIL} and we'll add you by hand.`,
  };
}
