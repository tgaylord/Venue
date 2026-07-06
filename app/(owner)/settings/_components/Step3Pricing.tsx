"use client";

import { useActionState } from "react";
import { savePricing } from "../actions";
import { WIZARD_IDLE } from "../forms";

const labelCls = "mb-1.5 block text-xs font-semibold text-owner-muted";
const inputCls =
  "w-full rounded-[9px] border border-owner-border bg-owner-panel px-3.5 py-3 text-sm text-owner-text focus:border-owner-accent focus:outline-none";

export default function Step3Pricing({ initial }: {
  initial: { hourlyRate: string; minHours: string; deposit: string };
}) {
  const [state, formAction, pending] = useActionState(savePricing, WIZARD_IDLE);
  return (
    <form action={formAction}>
      <h2 className="mb-1.5 text-[22px] font-bold tracking-tight">Pricing &amp; deposit</h2>
      <p className="mb-6 text-[13px] leading-relaxed text-owner-muted">
        The deposit is a term in your contract — you collect and return it the way you already do.
      </p>
      <div className="mb-4 grid grid-cols-3 gap-3">
        <div>
          <label htmlFor="hourlyRate" className={labelCls}>Hourly rate</label>
          <input id="hourlyRate" name="hourlyRate" defaultValue={initial.hourlyRate} placeholder="$165" className={inputCls} />
          {state.fieldErrors.hourlyRate && <p className="mt-1 text-xs text-danger">{state.fieldErrors.hourlyRate}</p>}
        </div>
        <div>
          <label htmlFor="minHours" className={labelCls}>Minimum hours</label>
          <input id="minHours" name="minHours" defaultValue={initial.minHours} placeholder="3" className={inputCls} />
          {state.fieldErrors.minHours && <p className="mt-1 text-xs text-danger">{state.fieldErrors.minHours}</p>}
        </div>
        <div>
          <label htmlFor="deposit" className={labelCls}>Damage deposit</label>
          <input id="deposit" name="deposit" defaultValue={initial.deposit} placeholder="$400" className={inputCls} />
          {state.fieldErrors.deposit && <p className="mt-1 text-xs text-danger">{state.fieldErrors.deposit}</p>}
        </div>
      </div>
      <div className="rounded-[11px] border border-owner-border bg-owner-panel p-4">
        <div className="mb-2.5 font-mono text-[9.5px] uppercase tracking-[.1em] text-[#5e6070]">
          Cancellation ladder · standard template
        </div>
        <div className="text-[12.5px] leading-8 text-[#c9cad2]">
          30+ days out — full refund<br />14–29 days — 50% refund<br />Under 14 days — no refund
        </div>
      </div>
      <button type="submit" disabled={pending} className="mt-7 rounded-[9px] bg-owner-accent px-5 py-3 text-sm font-bold text-[#0d0e14] disabled:opacity-60">
        {pending ? "Saving…" : "Save & continue"}
      </button>
    </form>
  );
}
