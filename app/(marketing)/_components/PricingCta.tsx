import WaitlistForm from "./WaitlistForm";

export default function PricingCta() {
  return (
    <section className="mx-auto max-w-[520px] border-t border-[#1d1e24] pb-20 pt-14 text-center">
      <div className="mb-[10px] text-[32px] font-bold tracking-[-.02em]">$60/month. Flat.</div>
      <div className="mb-7 text-sm leading-[1.7] text-owner-muted">
        Cheaper than one undocumented damage dispute. First 60 days free for the first 10
        Atlanta studios — no card required.
      </div>
      <div className="flex justify-center">
        <WaitlistForm />
      </div>
    </section>
  );
}
