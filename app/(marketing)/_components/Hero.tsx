import WaitlistForm from "./WaitlistForm";

export default function Hero() {
  return (
    <section className="max-w-[640px] pb-14 pt-[72px]">
      <div className="mb-[18px] font-mono text-[11px] uppercase tracking-[.12em] text-owner-accent">
        For Atlanta studio owners who rent for events
      </div>
      <h1 className="mb-5 text-[52px] font-bold leading-[1.05] tracking-[-.03em] text-pretty">
        Rent your studio for events without betting it on a handshake.
      </h1>
      <p className="mb-8 max-w-[540px] text-[17px] leading-relaxed text-owner-muted text-pretty">
        Signed contracts and timestamped condition photos — the paperwork side of event
        rentals, handled in one place.
      </p>
      <WaitlistForm id="waitlist" />
      <div className="mt-[14px] font-mono text-[10.5px] tracking-[.04em] text-[#5e6070]">
        Atlanta-owned · HBCU-founded · First 60 days free
      </div>
    </section>
  );
}
