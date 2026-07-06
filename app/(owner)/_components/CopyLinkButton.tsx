"use client";

import { useState } from "react";

export default function CopyLinkButton({ slug }: { slug: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(`${window.location.origin}/book/${slug}`);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className="rounded-[9px] bg-owner-accent px-4 py-2 text-xs font-bold text-[#0d0e14]"
    >
      {copied ? "Copied!" : "Copy link"}
    </button>
  );
}
