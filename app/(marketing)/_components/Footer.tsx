import Link from "next/link";

export default function Footer() {
  return (
    <footer className="border-t border-[#1d1e24] pb-8 pt-5">
      <p className="mb-3 text-[11px] leading-relaxed text-[#5e6070]">
        VenueDash is not a law firm and does not provide legal advice. Contract templates are
        provided as-is; have your own attorney review anything you sign.
      </p>
      <div className="flex items-center justify-between">
        <div className="font-mono text-[10px] tracking-[.05em] text-[#43444d]">
          VENUEDASH · MADE IN ATLANTA, GA
        </div>
        <div className="flex gap-4 font-mono text-[10px] tracking-[.05em]">
          <Link href="/terms" className="text-[#5e6070] hover:text-owner-muted">
            Terms
          </Link>
          <Link href="/privacy" className="text-[#5e6070] hover:text-owner-muted">
            Privacy
          </Link>
        </div>
      </div>
    </footer>
  );
}
