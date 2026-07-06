import Link from "next/link";
import WaitlistForm from "./WaitlistForm";

export default function PricingCta() {
  return (
    <section className="mx-auto max-w-[520px] border-t border-[#1d1e24] pb-20 pt-14 text-center">
      <div className="mb-[10px] text-[32px] font-bold tracking-[-.02em]">$60/month. Flat.</div>
      <div className="mb-7 text-sm leading-[1.7] text-owner-muted">
        Cheaper than one undocumented damage dispute. First 60 days free for the first 10
        Atlanta studios — no card required.
      </div>
      <div className="mb-8 flex justify-center">
        <Link
          href="/sign-up"
          className="rounded-[9px] bg-owner-accent px-8 py-[15px] text-[15px] font-bold text-[#0d0e14]"
        >
          Get started free
        </Link>
      </div>
      <div className="border-t border-[#1d1e24] pt-6">
        <p className="mb-3 text-xs text-owner-muted">
          Not ready yet? Join the list and we&apos;ll check in.
        </p>
        <div className="flex justify-center">
          <WaitlistForm id="waitlist" />
        </div>
      </div>
    </section>
  );
}
