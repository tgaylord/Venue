"use client";

import { useMemo, useState, useActionState } from "react";
import { formatCents } from "@/lib/money";
import { atlantaSlotToUtc } from "@/lib/tz";
import { availableStartHours, hasConflict, type Interval } from "@/lib/availability";
import {
  START_HOURS, DURATION_OPTIONS, EVENT_TYPES, BOOK_IDLE, type BookFormState,
} from "../forms";

export type BookViewModel = {
  slug: string;
  studioName: string;
  description: string | null;
  address: string | null;
  hourlyRateCents: number;
  minHours: number;
  depositCents: number;
  maxOccupancy: number | null;
  alcoholPolicy: string | null;
  vendorPolicy: string | null;
  noiseCurfew: string | null;
  spaces: { name: string; maxOccupancy: number | null }[];
  days: { dateISO: string; dow: string; num: string }[];
  busy: { startsAt: string; endsAt: string }[];
};

const ALCOHOL_LABEL: Record<string, string> = {
  byob_with_acknowledgment: "BYOB ok w/ acknowledgment",
  prohibited: "No alcohol",
  licensed_bartender_only: "Licensed bartender only",
};
const VENDOR_LABEL: Record<string, string> = {
  pre_approval: "Vendors pre-approved",
  allowed: "Outside vendors welcome",
};

const hourLabel = (h: number) => {
  const period = h < 12 ? "AM" : "PM";
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}:00 ${period}`;
};

function labelForDate(days: BookViewModel["days"], dateISO: string): string {
  const d = days.find((x) => x.dateISO === dateISO);
  return d ? `${d.dow} ${d.num}` : dateISO;
}

const CARD = "bg-white border border-renter-border rounded-xl";
const PRIMARY = "w-full bg-renter-ink text-renter-bg font-bold text-[15px] py-4 rounded-xl disabled:opacity-40";

export default function BookingFlow({
  vm, action,
}: { vm: BookViewModel; action: (prev: BookFormState, fd: FormData) => Promise<BookFormState> }) {
  const [step, setStep] = useState<"page" | "form" | "review">("page");
  const [dateISO, setDateISO] = useState<string>("");
  const [startHour, setStartHour] = useState<number | null>(null);
  const [durationHours, setDurationHours] = useState<number>(vm.minHours);

  const [eventType, setEventType] = useState("");
  const [headcount, setHeadcount] = useState("");
  const [byob, setByob] = useState(false);
  const [outsideVendors, setOutsideVendors] = useState(false);
  const [notes, setNotes] = useState("");

  const [state, formAction, pending] = useActionState(action, BOOK_IDLE);

  const busy = useMemo<Interval[]>(
    () => vm.busy.map((b) => ({ startsAt: new Date(b.startsAt), endsAt: new Date(b.endsAt) })),
    [vm.busy]
  );
  const openHours = useMemo(
    () => (dateISO ? availableStartHours(dateISO, START_HOURS, vm.minHours, busy) : []),
    [dateISO, vm.minHours, busy]
  );
  const slotConflict = useMemo(() => {
    if (!dateISO || startHour == null) return false;
    return hasConflict(atlantaSlotToUtc(dateISO, startHour, durationHours), busy);
  }, [dateISO, startHour, durationHours, busy]);

  const overCap = vm.maxOccupancy != null && parseInt(headcount || "0", 10) > vm.maxOccupancy;
  const canRequest = dateISO && startHour != null && !slotConflict;
  const canReview = eventType && parseInt(headcount || "0", 10) >= 1;

  const priceCents = startHour != null ? durationHours * vm.hourlyRateCents : 0;
  const whenLabel = dateISO && startHour != null
    ? `${labelForDate(vm.days, dateISO)} · ${hourLabel(startHour)}–${hourLabel(startHour + durationHours)}`
    : "";

  const chip = "text-[11px] font-semibold bg-[#edeade] border border-renter-border rounded-full px-2.5 py-1 text-[#4c483e]";

  return (
    <main className="mx-auto min-h-screen w-full max-w-[430px] bg-renter-bg">
      {/* ---------- STEP: PUBLIC PAGE ---------- */}
      {step === "page" && (
        <div>
          <div className="flex h-[200px] items-end bg-[repeating-linear-gradient(45deg,#e7e2d6_0_14px,#eee9de_14px_28px)] p-5">
            <span className="font-mono text-[9px] uppercase tracking-[.1em] text-[#8a867c]">Studio</span>
          </div>
          <div className="px-5 pt-5">
            <h1 className="font-serif text-[31px] leading-tight">{vm.studioName}</h1>
            {vm.address && (
              <div className="mb-3.5 font-mono text-[9.5px] uppercase tracking-[.12em] text-[#8a867c]">{vm.address}</div>
            )}
            {vm.description && <p className="mb-4 text-[13.5px] leading-relaxed text-[#4c483e]">{vm.description}</p>}

            <div className="mb-4 flex gap-5 border-y border-[#e2ddd0] py-3.5">
              <div><div className="text-base font-bold">{formatCents(vm.hourlyRateCents)}<span className="text-[11px] font-medium text-[#8a867c]">/hr</span></div><div className="mt-0.5 text-[10px] text-[#8a867c]">{vm.minHours} hr minimum</div></div>
              {vm.maxOccupancy != null && <div><div className="text-base font-bold">{vm.maxOccupancy}</div><div className="mt-0.5 text-[10px] text-[#8a867c]">max guests</div></div>}
              <div><div className="text-base font-bold">{formatCents(vm.depositCents)}</div><div className="mt-0.5 text-[10px] text-[#8a867c]">refundable deposit</div></div>
            </div>

            <div className="mb-2 text-[11px] font-bold uppercase tracking-[.04em] text-[#8a867c]">House rules</div>
            <div className="mb-5 flex flex-wrap gap-1.5">
              {vm.alcoholPolicy && <div className={chip}>{ALCOHOL_LABEL[vm.alcoholPolicy] ?? vm.alcoholPolicy}</div>}
              {vm.vendorPolicy && <div className={chip}>{VENDOR_LABEL[vm.vendorPolicy] ?? vm.vendorPolicy}</div>}
              {vm.noiseCurfew && <div className={chip}>Music until {vm.noiseCurfew}</div>}
              <div className={chip}>Studio gear hands-off</div>
            </div>

            {vm.spaces.length > 0 && (
              <>
                <div className="mb-2 text-[11px] font-bold uppercase tracking-[.04em] text-[#8a867c]">Spaces</div>
                <div className="mb-5 flex flex-wrap gap-1.5">
                  {vm.spaces.map((s) => (
                    <div key={s.name} className={chip}>
                      {s.name}{s.maxOccupancy != null ? ` · up to ${s.maxOccupancy}` : ""}
                    </div>
                  ))}
                </div>
              </>
            )}

            <div className="mb-2 text-[11px] font-bold uppercase tracking-[.04em] text-[#8a867c]">Pick a date</div>
            <div className="mb-3 flex gap-1.5 overflow-x-auto pb-0.5">
              {vm.days.map((d) => {
                const active = d.dateISO === dateISO;
                return (
                  <button
                    key={d.dateISO}
                    onClick={() => { setDateISO(d.dateISO); setStartHour(null); }}
                    className={`min-w-[52px] rounded-[10px] border px-1 py-2 text-center ${active ? "border-renter-ink bg-renter-ink text-renter-bg" : "border-renter-border bg-white"}`}
                  >
                    <div className="font-mono text-[8.5px] tracking-[.06em]">{d.dow}</div>
                    <div className="mt-0.5 text-[15px] font-bold">{d.num}</div>
                  </button>
                );
              })}
            </div>

            {dateISO && (
              <>
                <div className="mb-2 text-[11px] font-bold uppercase tracking-[.04em] text-[#8a867c]">Start time</div>
                <div className="mb-4 flex flex-wrap gap-1.5">
                  {START_HOURS.map((h) => {
                    const open = openHours.includes(h);
                    const active = h === startHour;
                    return (
                      <button
                        key={h}
                        disabled={!open}
                        onClick={() => setStartHour(h)}
                        className={`rounded-full border px-3.5 py-2 text-xs font-semibold ${active ? "border-renter-ink bg-renter-ink text-renter-bg" : "border-renter-border bg-white"} disabled:opacity-30`}
                      >
                        {hourLabel(h)}
                      </button>
                    );
                  })}
                </div>

                <div className="mb-2 text-[11px] font-bold uppercase tracking-[.04em] text-[#8a867c]">Duration</div>
                <div className="mb-4 flex flex-wrap gap-1.5">
                  {DURATION_OPTIONS.filter((n) => n >= vm.minHours).map((n) => (
                    <button
                      key={n}
                      onClick={() => setDurationHours(n)}
                      className={`rounded-full border px-3.5 py-2 text-xs font-semibold ${n === durationHours ? "border-renter-ink bg-renter-ink text-renter-bg" : "border-renter-border bg-white"}`}
                    >
                      {n} hrs
                    </button>
                  ))}
                </div>
              </>
            )}

            {slotConflict && <p className="mb-3 text-xs text-[#b4462f]">That window overlaps another booking — try a different time.</p>}
            <button disabled={!canRequest} onClick={() => setStep("form")} className={`${PRIMARY} mb-3.5`}>Request to book</button>
            <div className="pb-6 text-center font-mono text-[9px] tracking-[.06em] text-[#a8a294]">SECURE BOOKING POWERED BY VENUEDASH</div>
          </div>
        </div>
      )}

      {/* ---------- STEP: INTAKE ---------- */}
      {step === "form" && (
        <div className="px-5 pb-6 pt-4">
          <button onClick={() => setStep("page")} className="mb-3.5 text-xs font-semibold text-[#8a867c]">← Back</button>
          <h2 className="font-serif text-2xl">Tell us about your event</h2>
          <div className="mb-5 text-xs text-[#8a867c]">{whenLabel} · this goes into your contract</div>

          <div className="flex flex-col gap-3.5">
            <label className="text-xs font-semibold text-[#4c483e]">
              Event type
              <select value={eventType} onChange={(e) => setEventType(e.target.value)} className="mt-1.5 block w-full rounded-[10px] border border-renter-border bg-white px-3 py-3 text-sm text-renter-ink">
                <option value="">Choose…</option>
                {EVENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>

            <label className="text-xs font-semibold text-[#4c483e]">
              Estimated headcount
              <input value={headcount} onChange={(e) => setHeadcount(e.target.value)} inputMode="numeric" placeholder="e.g. 25" className="mt-1.5 block w-full rounded-[10px] border border-renter-border bg-white px-3.5 py-3 text-sm text-renter-ink" />
            </label>
            {overCap && <p className="-mt-2 text-[10.5px] text-[#b4462f]">Over the {vm.maxOccupancy}-guest cap — the studio may decline, but you can still ask.</p>}

            <div className="flex gap-2">
              <button onClick={() => setByob(!byob)} className={`flex-1 rounded-[10px] border p-3 text-left text-[12.5px] font-semibold ${byob ? "border-renter-ink bg-renter-ink text-renter-bg" : "border-renter-border bg-white text-[#4c483e]"}`}>
                Bringing alcohol (BYOB)<div className="mt-0.5 text-[10px] font-medium opacity-70">{byob ? "Yes" : "No"}</div>
              </button>
              <button onClick={() => setOutsideVendors(!outsideVendors)} className={`flex-1 rounded-[10px] border p-3 text-left text-[12.5px] font-semibold ${outsideVendors ? "border-renter-ink bg-renter-ink text-renter-bg" : "border-renter-border bg-white text-[#4c483e]"}`}>
                Outside vendors<div className="mt-0.5 text-[10px] font-medium opacity-70">{outsideVendors ? "Yes" : "No"}</div>
              </button>
            </div>

            <label className="text-xs font-semibold text-[#4c483e]">
              Anything else? <span className="font-normal text-[#a8a294]">(optional)</span>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Decor plans, setup needs, questions…" className="mt-1.5 block min-h-[70px] w-full resize-y rounded-[10px] border border-renter-border bg-white px-3.5 py-3 text-[13px] text-renter-ink" />
            </label>

            <button disabled={!canReview} onClick={() => setStep("review")} className={PRIMARY}>Review request</button>
          </div>
        </div>
      )}

      {/* ---------- STEP: REVIEW ---------- */}
      {step === "review" && (
        <div className="px-5 pb-6 pt-4">
          <button onClick={() => setStep("form")} className="mb-3.5 text-xs font-semibold text-[#8a867c]">← Back</button>
          <h2 className="mb-4 font-serif text-2xl">Review your request</h2>

          <div className={`${CARD} mb-3 p-4`}>
            <div className="text-[13px] leading-8 text-renter-ink">
              <strong>{whenLabel}</strong><br />
              {eventType} · {headcount} guests<br />
              <span className="text-[#8a867c]">{byob ? "BYOB" : "No alcohol"} · {outsideVendors ? "Outside vendors" : "No outside vendors"}</span>
            </div>
          </div>

          <div className={`${CARD} mb-3 p-4`}>
            <div className="flex justify-between py-1 text-[13px]"><span className="text-[#4c483e]">Studio rental · {durationHours} hrs × {formatCents(vm.hourlyRateCents)}</span><span className="font-bold">{formatCents(priceCents)}</span></div>
            <div className="border-b border-[#eee9de] pb-2 text-[10.5px] text-[#a8a294]">Paid directly to {vm.studioName} after approval</div>
            <div className="flex justify-between pb-1 pt-2 text-[13px]"><span className="text-[#4c483e]">Refundable damage deposit</span><span className="font-bold">{formatCents(vm.depositCents)}</span></div>
            <div className="text-[10.5px] text-[#a8a294]">Arranged directly with {vm.studioName} — VenueDash never holds your money.</div>
          </div>

          <div className="mb-4 rounded-xl bg-[#edeade] px-4 py-3.5">
            <div className="mb-2 text-[11px] font-bold uppercase tracking-[.04em] text-[#8a867c]">What happens next</div>
            <div className="text-xs leading-8 text-[#4c483e]">1 · {vm.studioName} reviews (usually &lt; 24 hrs)<br />2 · Sign the rental agreement<br />3 · Arrange the deposit — you&rsquo;re booked</div>
          </div>

          <form action={formAction}>
            {/* Honeypot — hidden from real users, tempting to bots */}
            <input type="text" name="contact_preference_x" tabIndex={-1} autoComplete="one-time-code" aria-hidden className="hidden" />
            {/* Hidden fields carry the collected picker/intake values into the action */}
            <HiddenFields
              dateISO={dateISO} startHour={startHour ?? 0} durationHours={durationHours}
              eventType={eventType} headcount={headcount} byob={byob} outsideVendors={outsideVendors} notes={notes}
            />
            <RenterContactFields />
            {state.status === "error" && <p className="mb-2 text-xs text-[#b4462f]" role="alert">{state.error}</p>}
            <button type="submit" disabled={pending} className={`${PRIMARY} mb-2.5`}>{pending ? "Sending…" : "Send booking request"}</button>
          </form>
          <div className="text-center text-[11px] text-[#a8a294]">Nothing is charged here — {vm.studioName} handles payment after approval.</div>
        </div>
      )}
    </main>
  );

  function HiddenFields(p: {
    dateISO: string; startHour: number; durationHours: number; eventType: string; headcount: string;
    byob: boolean; outsideVendors: boolean; notes: string;
  }) {
    return (
      <>
        <input type="hidden" name="dateISO" value={p.dateISO} readOnly />
        <input type="hidden" name="startHour" value={p.startHour} readOnly />
        <input type="hidden" name="durationHours" value={p.durationHours} readOnly />
        <input type="hidden" name="eventType" value={p.eventType} readOnly />
        <input type="hidden" name="headcount" value={p.headcount} readOnly />
        {p.byob && <input type="hidden" name="byob" value="on" readOnly />}
        {p.outsideVendors && <input type="hidden" name="outsideVendors" value="on" readOnly />}
        <input type="hidden" name="notes" value={p.notes} readOnly />
      </>
    );
  }

  function RenterContactFields() {
    return (
      <div className="mb-3 flex flex-col gap-2">
        <input name="renterName" required placeholder="Your name" className="rounded-[10px] border border-renter-border bg-white px-3.5 py-3 text-sm text-renter-ink" />
        <input name="renterEmail" type="email" required placeholder="you@email.com" className="rounded-[10px] border border-renter-border bg-white px-3.5 py-3 text-sm text-renter-ink" />
        <input name="renterPhone" placeholder="Phone (optional)" className="rounded-[10px] border border-renter-border bg-white px-3.5 py-3 text-sm text-renter-ink" />
      </div>
    );
  }
}
