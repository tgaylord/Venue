"use client";

import { useActionState, useState } from "react";
import { saveRules, WIZARD_IDLE } from "../actions";

const labelCls = "mb-2 block text-xs font-semibold text-owner-muted";
const inputCls =
  "w-full rounded-[9px] border border-owner-border bg-owner-panel px-3.5 py-3 text-sm text-owner-text focus:border-owner-accent focus:outline-none";

function Pills({ name, options, initial }: {
  name: string; options: { value: string; label: string }[]; initial: string;
}) {
  const [selected, setSelected] = useState(initial);
  return (
    <div className="flex flex-wrap gap-2">
      <input type="hidden" name={name} value={selected} />
      {options.map((o) => (
        <button
          key={o.value} type="button" onClick={() => setSelected(o.value)}
          className={`rounded-[9px] px-3.5 py-2 text-[12.5px] font-semibold ${
            selected === o.value
              ? "border border-owner-accent bg-[rgba(122,134,255,.14)] text-[#aab2ff]"
              : "border border-owner-border bg-owner-panel text-owner-muted"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export default function Step2Rules({ initial }: {
  initial: { alcoholPolicy: string; vendorPolicy: string; noiseCurfew: string; cleanupWindowMin: string };
}) {
  const [state, formAction, pending] = useActionState(saveRules, WIZARD_IDLE);
  return (
    <form action={formAction}>
      <h2 className="mb-1.5 text-[22px] font-bold tracking-tight">House rules</h2>
      <p className="mb-6 text-[13px] leading-relaxed text-owner-muted">
        These become enforceable clauses in every contract.
      </p>
      <div className="flex flex-col gap-4">
        <div>
          <span className={labelCls}>Alcohol policy</span>
          <Pills
            name="alcoholPolicy" initial={initial.alcoholPolicy}
            options={[
              { value: "byob_with_acknowledgment", label: "BYOB allowed with acknowledgment" },
              { value: "prohibited", label: "Prohibited" },
              { value: "licensed_bartender_only", label: "Licensed bartender only" },
            ]}
          />
          {state.fieldErrors.alcoholPolicy && <p className="mt-1 text-xs text-danger">{state.fieldErrors.alcoholPolicy}</p>}
        </div>
        <div>
          <span className={labelCls}>Outside vendors</span>
          <Pills
            name="vendorPolicy" initial={initial.vendorPolicy}
            options={[
              { value: "pre_approval", label: "Pre-approval required" },
              { value: "allowed", label: "Allowed freely" },
            ]}
          />
          {state.fieldErrors.vendorPolicy && <p className="mt-1 text-xs text-danger">{state.fieldErrors.vendorPolicy}</p>}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="noiseCurfew" className={labelCls}>Noise curfew</label>
            <input id="noiseCurfew" name="noiseCurfew" defaultValue={initial.noiseCurfew} placeholder="10:00 PM" className={inputCls} />
            <p className="mt-1.5 text-[10.5px] leading-normal text-[#5e6070]">
              Contract cites Atlanta Code § 74-133 (noise ordinance).
            </p>
            {state.fieldErrors.noiseCurfew && <p className="mt-1 text-xs text-danger">{state.fieldErrors.noiseCurfew}</p>}
          </div>
          <div>
            <label htmlFor="cleanupWindowMin" className={labelCls}>Cleanup window (minutes)</label>
            <input id="cleanupWindowMin" name="cleanupWindowMin" defaultValue={initial.cleanupWindowMin} placeholder="30" className={inputCls} />
            {state.fieldErrors.cleanupWindowMin && <p className="mt-1 text-xs text-danger">{state.fieldErrors.cleanupWindowMin}</p>}
          </div>
        </div>
      </div>
      <button type="submit" disabled={pending} className="mt-7 rounded-[9px] bg-owner-accent px-5 py-3 text-sm font-bold text-[#0d0e14] disabled:opacity-60">
        {pending ? "Saving…" : "Save & continue"}
      </button>
    </form>
  );
}
