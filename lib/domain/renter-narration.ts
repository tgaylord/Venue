import type { BookingState } from "./states";

export type RenterNarration = {
  heading: string;
  body: string;
  note?: string;
};

const POST_CONFIRMATION_NOTE =
  "Your host documents the space's condition before and after the event as timestamped documentation.";

const NARRATION: Record<BookingState, RenterNarration> = {
  pending: {
    heading: "What happens next",
    body: "Your request has been sent. The studio will review it and get back to you — you'll receive an email either way.",
  },
  awaiting_contract: {
    heading: "What happens next",
    body: "Your request was approved. The rental agreement is being prepared — you'll receive it by email shortly.",
  },
  awaiting_signature: {
    heading: "What happens next",
    body: "Review the agreement below. Your host will arrange signing — either through an e-sign tool or in person at the pre-event walkthrough.",
  },
  confirmed: {
    heading: "You're all set",
    body: "Your booking is confirmed. You'll hear from your host as the event date approaches.",
    note: POST_CONFIRMATION_NOTE,
  },
  event_day: {
    heading: "Today's the day",
    body: "Your event is today. If you have any last-minute questions, reach out to your host directly.",
    note: POST_CONFIRMATION_NOTE,
  },
  post_event: {
    heading: "Thanks for visiting",
    body: "Your event is complete. Your host will follow up about the deposit return.",
    note: POST_CONFIRMATION_NOTE,
  },
  closed: {
    heading: "All wrapped up",
    body: "This booking is complete. Thanks for using the space.",
  },
  declined: {
    heading: "Request not accepted",
    body: "The studio wasn't able to accommodate this request. You're welcome to submit a new one for different dates.",
  },
  canceled: {
    heading: "Booking canceled",
    body: "This booking was canceled. If you'd like to rebook, submit a new request.",
  },
};

export function renterNarration(state: BookingState): RenterNarration {
  return NARRATION[state];
}
