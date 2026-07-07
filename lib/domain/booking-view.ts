// lib/domain/booking-view.ts
import type { Booking } from "@/db/schema";
import { deriveEffectiveState } from "./effective-state";
import { LEGAL_TRANSITIONS, type BookingState } from "./states";

export type DashboardGroup = "needs_action" | "in_progress" | "past";
export type OwnerAction = "approve_and_send" | "generate_contract" | "decline" | "cancel" | "mark_signed" | "close_out";
export type ChipTone = "success" | "warning" | "danger" | "muted";

export type BookingView = {
  id: string;
  storedState: BookingState;
  effectiveState: BookingState;
  group: DashboardGroup;
  legalActions: OwnerAction[];
  depositControlActive: boolean;
  chip: { label: string; tone: ChipTone };
};

// Group is keyed on EFFECTIVE state (so a confirmed booking whose clock has
// passed lands in "past", not "in_progress").
const GROUP: Record<BookingState, DashboardGroup> = {
  pending: "needs_action",
  awaiting_signature: "needs_action",
  awaiting_contract: "in_progress",
  confirmed: "in_progress",
  event_day: "in_progress",
  post_event: "past",
  closed: "past",
  declined: "past",
  canceled: "past",
};

// Which owner action a legal transition target maps to. Targets with no entry
// are not owner-driven: event_day/post_event (clock), closed (close-out = deferred).
const TARGET_TO_ACTION: Partial<Record<BookingState, OwnerAction>> = {
  awaiting_contract: "approve_and_send",
  awaiting_signature: "generate_contract",
  declined: "decline",
  canceled: "cancel",
  confirmed: "mark_signed",
};

// Stable button order regardless of LEGAL_TRANSITIONS ordering.
const ACTION_ORDER: OwnerAction[] = ["approve_and_send", "generate_contract", "decline", "mark_signed", "close_out", "cancel"];

const CHIP: Record<BookingState, { label: string; tone: ChipTone }> = {
  pending: { label: "Pending review", tone: "warning" },
  awaiting_contract: { label: "Approved", tone: "muted" },
  awaiting_signature: { label: "Awaiting signature", tone: "warning" },
  confirmed: { label: "Confirmed", tone: "success" },
  event_day: { label: "Event today", tone: "success" },
  post_event: { label: "Wrap-up", tone: "warning" },
  closed: { label: "Closed", tone: "muted" },
  declined: { label: "Declined", tone: "danger" },
  canceled: { label: "Canceled", tone: "danger" },
};

const DEPOSIT_ACTIVE_STATES: BookingState[] = ["confirmed", "event_day", "post_event"];

export function toBookingView(booking: Booking, now: Date): BookingView {
  const storedState = booking.state;
  const effectiveState = deriveEffectiveState(booking, now);

  // Legality comes from the STORED state (that's what transitionBooking checks),
  // but an action is only OFFERED when the effective state agrees.
  let legalActions = LEGAL_TRANSITIONS[storedState]
    .map((target) => TARGET_TO_ACTION[target])
    .filter((a): a is OwnerAction => a !== undefined);

  // Safety rule: never offer cancel on an event that is effectively underway or over.
  if (effectiveState === "event_day" || effectiveState === "post_event") {
    legalActions = legalActions.filter((a) => a !== "cancel");
  }

  // Close out is available when effective state is post_event (multi-hop, not a single transition).
  if (effectiveState === "post_event") {
    legalActions.push("close_out");
  }

  legalActions = ACTION_ORDER.filter((a) => legalActions.includes(a));

  return {
    id: booking.id,
    storedState,
    effectiveState,
    group: GROUP[effectiveState],
    legalActions,
    depositControlActive: DEPOSIT_ACTIVE_STATES.includes(effectiveState),
    chip: CHIP[effectiveState],
  };
}

export type NextStepHref = "detail" | "pre_walkthrough" | "post_walkthrough";
export type NextStep = { label: string; href: NextStepHref };

export function nextStep(
  effectiveState: BookingState,
  locks: { preLocked: boolean; postLocked: boolean }
): NextStep | null {
  switch (effectiveState) {
    case "pending":
      return { label: "Review request", href: "detail" };
    case "awaiting_contract":
      return { label: "Send contract", href: "detail" };
    case "awaiting_signature":
      return { label: "Get contract signed", href: "detail" };
    case "confirmed":
    case "event_day":
      if (!locks.preLocked) return { label: "Pre-event walkthrough due", href: "pre_walkthrough" };
      return null;
    case "post_event":
      if (!locks.postLocked) return { label: "Post-event walkthrough due", href: "post_walkthrough" };
      return { label: "Close out", href: "detail" };
    default:
      return null;
  }
}

export type WalkthroughEntry = "start_pre_walkthrough" | "start_post_walkthrough";

export function walkthroughEntries(
  effectiveState: BookingState,
  locks: { preLocked: boolean; postLocked: boolean }
): WalkthroughEntry[] {
  const out: WalkthroughEntry[] = [];
  if ((effectiveState === "confirmed" || effectiveState === "event_day") && !locks.preLocked) {
    out.push("start_pre_walkthrough");
  }
  if (effectiveState === "post_event" && !locks.postLocked) {
    out.push("start_post_walkthrough");
  }
  return out;
}
