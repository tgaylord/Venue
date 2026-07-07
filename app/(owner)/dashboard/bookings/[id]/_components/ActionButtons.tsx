"use client";

import { useActionState } from "react";
import type { OwnerAction } from "@/lib/domain/booking-view";
import {
  approveAndSend, generateContract, declineBooking, cancelBooking, markSigned, closeOut,
} from "../actions";
import { BOOKING_ACTION_IDLE, type BookingActionState } from "../forms";

type Bound = (prev: BookingActionState, fd: FormData) => Promise<BookingActionState>;

const META: Record<OwnerAction, { label: string; className: string; fn: (id: string) => Bound }> = {
  approve_and_send: { label: "Approve & send contract", className: "bg-success text-[#08130c]", fn: (id) => approveAndSend.bind(null, id) },
  generate_contract: { label: "Generate & send contract", className: "bg-owner-accent text-[#0d0e14]", fn: (id) => generateContract.bind(null, id) },
  mark_signed: { label: "Mark contract signed", className: "bg-owner-accent text-[#0d0e14]", fn: (id) => markSigned.bind(null, id) },
  close_out: { label: "Close out", className: "bg-owner-accent text-[#0d0e14]", fn: (id) => closeOut.bind(null, id) },
  decline: { label: "Decline", className: "border border-owner-border text-owner-muted", fn: (id) => declineBooking.bind(null, id) },
  cancel: { label: "Cancel booking", className: "border border-[#5a2822] text-danger", fn: (id) => cancelBooking.bind(null, id) },
};

function OneButton({ bookingId, action }: { bookingId: string; action: OwnerAction }) {
  const meta = META[action];
  const [state, formAction, pending] = useActionState<BookingActionState, FormData>(
    meta.fn(bookingId), BOOKING_ACTION_IDLE
  );
  return (
    <form action={formAction} className="inline-flex flex-col">
      <button
        type="submit"
        disabled={pending}
        className={`rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50 ${meta.className}`}
      >
        {pending ? "Working…" : meta.label}
      </button>
      {state.status === "error" ? <span className="mt-1 text-xs text-danger">{state.error}</span> : null}
    </form>
  );
}

export default function ActionButtons({ bookingId, actions }: { bookingId: string; actions: OwnerAction[] }) {
  if (actions.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {actions.map((a) => <OneButton key={a} bookingId={bookingId} action={a} />)}
    </div>
  );
}
