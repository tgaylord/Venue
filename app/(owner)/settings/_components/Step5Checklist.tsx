"use client";

import { useActionState, useState } from "react";
import { saveChecklist } from "../actions";
import { WIZARD_IDLE } from "../forms";
import CopyLinkButton from "@/app/(owner)/_components/CopyLinkButton";

const inputCls =
  "rounded-[9px] border border-owner-border bg-owner-panel px-3.5 py-2.5 text-[13px] text-owner-text placeholder:text-[#5e6070] focus:border-owner-accent focus:outline-none";

export default function Step5Checklist({ initial, slug }: {
  initial: { name: string; hint: string }[]; slug: string;
}) {
  const [state, formAction, pending] = useActionState(saveChecklist, WIZARD_IDLE);
  const [rows, setRows] = useState(() => {
    const seed = initial.length > 0 ? initial : [{ name: "", hint: "" }];
    return seed.map((row, idx) => ({ id: idx, ...row }));
  });

  return (
    <form action={formAction}>
      <h2 className="mb-1.5 text-[22px] font-bold tracking-tight">Photo checklist</h2>
      <p className="mb-6 text-[13px] leading-relaxed text-owner-muted">
        Name every area you&apos;ll photograph before and after each event — this is your
        timestamped documentation of the space.
      </p>
      <div className="mb-4 flex flex-col gap-2">
        {rows.map((row, i) => (
          <div key={row.id} className="flex items-center gap-2.5 rounded-[9px] border border-owner-border bg-owner-panel px-3.5 py-2">
            <div className="w-[18px] font-mono text-[10px] text-[#5e6070]">{String(i + 1).padStart(2, "0")}</div>
            <input name="itemName" defaultValue={row.name} placeholder="Area name" aria-label={`Area ${i + 1} name`} className={`${inputCls} flex-1 border-0 bg-transparent px-0`} />
            <input name="itemHint" defaultValue={row.hint} placeholder="Hint (optional)" aria-label={`Area ${i + 1} hint`} className={`${inputCls} flex-1 border-0 bg-transparent px-0 text-owner-muted`} />
            <button
              type="button" aria-label={`Remove area ${i + 1}`}
              onClick={() => setRows((r) => r.filter((row2) => row2.id !== row.id))}
              className="text-[11px] text-[#5e6070] hover:text-danger"
            >
              Remove
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() =>
            setRows((r) => [
              ...r,
              { id: (r.length ? Math.max(...r.map((row) => row.id)) : -1) + 1, name: "", hint: "" },
            ])
          }
          className="self-start p-0.5 text-xs font-semibold text-owner-accent"
        >
          + Add an area
        </button>
        {state.fieldErrors.items && <p className="text-xs text-danger">{state.fieldErrors.items}</p>}
      </div>

      <div className="mb-6 rounded-[11px] border border-[#1e4a2c] bg-[#101a12] p-[18px] text-center">
        <div className="mb-2 font-mono text-[9.5px] uppercase tracking-[.12em] text-success">You&apos;re live</div>
        <div className="mb-2.5 text-[15px] font-bold">/book/{slug}</div>
        <div className="mb-3.5 text-xs text-owner-muted">
          Drop this link in your Instagram bio, Peerspace profile, anywhere.
        </div>
        <CopyLinkButton slug={slug} />
      </div>

      <button type="submit" disabled={pending} className="rounded-[9px] bg-owner-accent px-5 py-3 text-sm font-bold text-[#0d0e14] disabled:opacity-60">
        {pending ? "Saving…" : "Save checklist & finish"}
      </button>
    </form>
  );
}
