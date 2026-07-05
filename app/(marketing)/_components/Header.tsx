import Link from "next/link";

export default function Header() {
  return (
    <header className="flex items-center justify-between py-[22px]">
      <div className="flex items-center gap-[9px]">
        <div className="flex size-[22px] items-center justify-center rounded-md bg-gradient-to-br from-[#7a86ff] to-[#5560e0] text-xs font-bold text-white">
          V
        </div>
        <span className="text-base font-bold tracking-tight">VenueDash</span>
      </div>
      <Link
        href="/sign-up"
        className="rounded-lg bg-owner-text px-4 py-[9px] text-[12.5px] font-semibold text-owner-bg"
      >
        Get started free
      </Link>
    </header>
  );
}
