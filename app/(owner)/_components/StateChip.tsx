import type { ChipTone } from "@/lib/domain/booking-view";

const TONE: Record<ChipTone, string> = {
  success: "border-[#1e6b3f] bg-[#0b1a10] text-success",
  warning: "border-[#5a4718] bg-[#1b1710] text-warning",
  danger: "border-[#5a2822] bg-[#1a0f0d] text-danger",
  muted: "border-owner-border bg-owner-panel-2 text-owner-muted",
};

export default function StateChip({ label, tone }: { label: string; tone: ChipTone }) {
  return (
    <span className={`inline-block rounded-full border px-2.5 py-1 text-[11px] font-medium ${TONE[tone]}`}>
      {label}
    </span>
  );
}
