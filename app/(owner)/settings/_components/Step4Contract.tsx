import Link from "next/link";
import type { Space, Studio } from "@/lib/studio";

const POLICY_LABELS: Record<string, string> = {
  byob_with_acknowledgment: "BYOB with acknowledgment",
  prohibited: "Alcohol prohibited",
  licensed_bartender_only: "Licensed bartender only",
};

function dollars(cents: number | null): string {
  return cents === null ? "—" : `$${(cents / 100).toLocaleString()}`;
}

export default function Step4Contract({ studio, spaces }: { studio: Studio; spaces: Space[] }) {
  const maxCap = spaces.reduce((m, s) => Math.max(m, s.maxOccupancy ?? 0), 0);
  const lines = [
    studio.equipmentList ? `Equipment hands-off clause (${studio.equipmentList})` : "Equipment hands-off clause",
    `${maxCap > 0 ? `Max occupancy ${maxCap} · ` : ""}${POLICY_LABELS[studio.alcoholPolicy ?? ""] ?? "Alcohol policy from step 2"}`,
    `${studio.noiseCurfew ? `${studio.noiseCurfew} curfew · ` : ""}Atlanta Code § 74-133 referenced`,
    `${dollars(studio.depositCents)} deposit stated as a contract term — collected by you`,
    "Cancellation ladder · Georgia jurisdiction",
  ];
  return (
    <div>
      <h2 className="mb-1.5 text-[22px] font-bold tracking-tight">Your contract</h2>
      <p className="mb-6 text-[13px] leading-relaxed text-owner-muted">
        Generated from your answers. Georgia jurisdiction, ready to send with every booking.
      </p>
      <div className="mb-3.5 rounded-[11px] border border-owner-border bg-owner-panel p-[18px]">
        <div className="mb-3 text-[13.5px] font-bold">Standard Event Rental Agreement</div>
        <div className="text-[12.5px] leading-[1.9] text-owner-muted">
          {lines.map((l) => (
            <div key={l}>✓ {l}</div>
          ))}
        </div>
      </div>
      <p className="mb-6 text-[11px] leading-relaxed text-[#5e6070]">
        VenueDash is not a law firm and does not provide legal advice. This template will be
        reviewed by a Georgia attorney before launch; have your own attorney review anything you sign.
      </p>
      <Link
        href="/settings?step=5"
        className="inline-block rounded-[9px] bg-owner-accent px-5 py-3 text-sm font-bold text-[#0d0e14]"
      >
        Continue
      </Link>
    </div>
  );
}
