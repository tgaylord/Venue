import { Resend } from "resend";
import { render } from "@react-email/render";
import TestEmail from "@/emails/TestEmail";
import OwnerBookingRequest, { type OwnerBookingEmailProps } from "@/emails/OwnerBookingRequest";
import RenterRequestReceived, { type RenterReceivedEmailProps } from "@/emails/RenterRequestReceived";

export async function renderTestEmail(props: { name: string }): Promise<string> {
  return render(TestEmail(props));
}

export type OwnerBookingEmail = OwnerBookingEmailProps;
export type RenterReceivedEmail = RenterReceivedEmailProps;

export async function renderOwnerBookingRequest(props: OwnerBookingEmail): Promise<string> {
  return render(OwnerBookingRequest(props));
}

export async function renderRenterRequestReceived(props: RenterReceivedEmail): Promise<string> {
  return render(RenterRequestReceived(props));
}

export async function sendEmail(args: { to: string; subject: string; html: string }): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY is not set");
  const resend = new Resend(key);
  const { error } = await resend.emails.send({
    from: process.env.EMAIL_FROM ?? "VenueDash <onboarding@resend.dev>",
    to: args.to,
    subject: args.subject,
    html: args.html,
  });
  if (error) throw new Error(`Resend send failed: ${error.message}`);
}
