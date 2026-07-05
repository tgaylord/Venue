"use client";

import { useActionState } from "react";
import { joinWaitlist, type WaitlistFormState } from "../actions";

const initialState: WaitlistFormState = { status: "idle", message: "" };

export default function WaitlistForm({ id }: { id?: string }) {
  const [state, formAction, pending] = useActionState(joinWaitlist, initialState);

  if (state.status === "success") {
    return (
      <p id={id} role="status" className="rounded-lg border border-success/40 bg-success/10 px-4 py-3 text-sm text-success">
        {state.message}
      </p>
    );
  }

  return (
    <form id={id} action={formAction} className="flex max-w-md flex-col gap-2">
      <div className="flex gap-2">
        {/* Honeypot — hidden from real users, tempting to bots */}
        <input
          type="text"
          name="contact_preference_x"
          tabIndex={-1}
          autoComplete="one-time-code"
          aria-hidden="true"
          className="hidden"
        />
        <input
          type="email"
          name="email"
          required
          placeholder="you@yourstudio.com"
          aria-label="Email address"
          className="min-w-0 flex-1 rounded-[9px] border border-[#2c2d35] bg-[#101116] px-4 py-3 text-sm text-owner-text placeholder:text-[#5e6070] focus:border-owner-accent focus:outline-none"
        />
        <button
          type="submit"
          disabled={pending}
          className="shrink-0 rounded-[9px] bg-owner-accent px-5 py-3 text-sm font-bold text-[#0d0e14] disabled:opacity-60"
        >
          {pending ? "Joining…" : "Join the waitlist"}
        </button>
      </div>
      {state.status === "error" && (
        <p className="text-xs text-danger" role="alert">
          {state.message}
        </p>
      )}
    </form>
  );
}
