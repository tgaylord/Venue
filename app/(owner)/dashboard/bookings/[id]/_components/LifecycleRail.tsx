import type { BookingState } from "@/lib/domain/states";

const SPINE: BookingState[] = [
  "pending", "awaiting_contract", "awaiting_signature",
  "confirmed", "event_day", "post_event", "closed",
];
const LABEL: Record<BookingState, string> = {
  pending: "Requested",
  awaiting_contract: "Approved",
  awaiting_signature: "Contract sent",
  confirmed: "Confirmed",
  event_day: "Event day",
  post_event: "Wrap-up",
  closed: "Closed",
  declined: "Declined",
  canceled: "Canceled",
};

export default function LifecycleRail({
  current, events,
}: { current: BookingState; events: { toState: BookingState }[] }) {
  const terminalOffSpine = current === "declined" || current === "canceled";
  const reached = new Set<BookingState>(events.map((e) => e.toState));
  reached.add(current);
  const currentIdx = SPINE.indexOf(current);

  return (
    <div className="rounded-xl border border-[#1d1e24] bg-[#121317] p-4">
      <div className="mb-3 font-mono text-[10px] uppercase tracking-wider text-owner-muted">Booking lifecycle</div>
      <ol className="flex flex-col gap-3">
        {SPINE.map((state, i) => {
          const isPast = currentIdx >= 0 && i < currentIdx;
          const isCurrent = state === current;
          const dot = isCurrent
            ? "bg-owner-accent ring-2 ring-owner-accent/40"
            : isPast || reached.has(state) ? "bg-success" : "bg-[#2a2b31]";
          const text = isCurrent ? "text-owner-text font-semibold"
            : isPast || reached.has(state) ? "text-owner-muted" : "text-[#5e6070]";
          return (
            <li key={state} className="flex items-center gap-3">
              <span className={`h-2.5 w-2.5 rounded-full ${dot}`} />
              <span className={`text-xs ${text}`}>{LABEL[state]}</span>
            </li>
          );
        })}
        {terminalOffSpine ? (
          <li className="mt-1 flex items-center gap-3 border-t border-[#1d1e24] pt-3">
            <span className="h-2.5 w-2.5 rounded-full bg-danger ring-2 ring-danger/40" />
            <span className="text-xs font-semibold text-danger">{LABEL[current]}</span>
          </li>
        ) : null}
      </ol>
    </div>
  );
}
