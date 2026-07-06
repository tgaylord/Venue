"use client";

import { useActionState, useState } from "react";
import { saveProfile } from "../actions";
import { WIZARD_IDLE } from "../forms";
import type { Space } from "@/lib/studio";

const inputCls =
  "w-full rounded-[9px] border border-owner-border bg-owner-panel px-3.5 py-3 text-sm text-owner-text placeholder:text-[#5e6070] focus:border-owner-accent focus:outline-none";
const labelCls = "mb-1.5 block text-xs font-semibold text-owner-muted";

export default function Step1Profile({ initial }: {
  initial: { name: string; address: string; equipmentList: string; spaces: Pick<Space, "name" | "maxOccupancy">[] };
}) {
  const [state, formAction, pending] = useActionState(saveProfile, WIZARD_IDLE);
  const [rows, setRows] = useState(
    initial.spaces.length > 0 ? initial.spaces : [{ name: "", maxOccupancy: null }]
  );

  return (
    <form action={formAction}>
      <h2 className="mb-1.5 text-[22px] font-bold tracking-tight">Your studio</h2>
      <p className="mb-6 text-[13px] leading-relaxed text-owner-muted">
        This fills in your contracts and your public booking page.
      </p>
      <div className="flex flex-col gap-3.5">
        <div>
          <label htmlFor="name" className={labelCls}>Studio name</label>
          <input id="name" name="name" defaultValue={initial.name} required className={inputCls} />
          {state.fieldErrors.name && <p className="mt-1 text-xs text-danger">{state.fieldErrors.name}</p>}
        </div>
        <div>
          <label htmlFor="address" className={labelCls}>Address</label>
          <input id="address" name="address" defaultValue={initial.address} className={inputCls} />
        </div>
        <div>
          <span className={labelCls}>Spaces &amp; areas renters can access</span>
          <div className="flex flex-col gap-2">
            {rows.map((row, i) => (
              <div key={i} className="flex gap-2">
                <input
                  name="spaceName" defaultValue={row.name} placeholder="e.g. Main floor + cyc wall"
                  aria-label={`Space ${i + 1} name`} className={`${inputCls} flex-1`}
                />
                <input
                  name="spaceCap" defaultValue={row.maxOccupancy ?? ""} placeholder="Cap"
                  aria-label={`Space ${i + 1} occupancy cap`} className={`${inputCls} w-[90px]`}
                />
              </div>
            ))}
            <button
              type="button"
              onClick={() => setRows((r) => [...r, { name: "", maxOccupancy: null }])}
              className="self-start p-0.5 text-xs font-semibold text-owner-accent"
            >
              + Add another space
            </button>
          </div>
          {state.fieldErrors.spaces && <p className="mt-1 text-xs text-danger">{state.fieldErrors.spaces}</p>}
        </div>
        <div>
          <label htmlFor="equipmentList" className={labelCls}>Equipment on-site (renters agree hands-off)</label>
          <input id="equipmentList" name="equipmentList" defaultValue={initial.equipmentList} className={inputCls} />
        </div>
      </div>
      <button
        type="submit" disabled={pending}
        className="mt-7 rounded-[9px] bg-owner-accent px-5 py-3 text-sm font-bold text-[#0d0e14] disabled:opacity-60"
      >
        {pending ? "Saving…" : "Save & continue"}
      </button>
    </form>
  );
}
