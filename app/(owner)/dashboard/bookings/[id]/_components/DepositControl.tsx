"use client";

import { useActionState } from "react";
import type { DepositStatus } from "@/lib/booking";
import { setDeposit } from "../actions";
import { BOOKING_ACTION_IDLE, DEPOSIT_STATUSES, DEPOSIT_LABELS, type BookingActionState } from "../forms";

export default function DepositControl({
  bookingId, current,
}: { bookingId: string; current: DepositStatus }) {
  const [state, formAction, pending] = useActionState<BookingActionState, FormData>(
    setDeposit.bind(null, bookingId), BOOKING_ACTION_IDLE
  );
  return (
    <div>
      <div className="flex flex-col gap-1">
        {DEPOSIT_STATUSES.map((s) => (
          <form key={s} action={formAction}>
            <input type="hidden" name="status" value={s} />
            <button
              type="submit"
              disabled={pending || s === current}
              aria-current={s === current}
              className={`w-full rounded-md border px-2.5 py-1.5 text-left text-xs ${
                s === current
                  ? "border-owner-accent bg-owner-accent font-medium text-[#0d0e14] disabled:opacity-100"
                  : "border-owner-border text-owner-muted hover:text-owner-text disabled:opacity-60"
              }`}
            >
              {DEPOSIT_LABELS[s]}
            </button>
          </form>
        ))}
      </div>
      {state.status === "error" ? <p className="mt-1 text-xs text-danger">{state.error}</p> : null}
    </div>
  );
}
