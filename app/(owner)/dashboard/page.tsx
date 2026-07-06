import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { getDb } from "@/lib/db";
import { getStudioByClerkUserId } from "@/lib/studio";
import CopyLinkButton from "@/app/(owner)/_components/CopyLinkButton";

export default async function Dashboard() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const studio = await getStudioByClerkUserId(getDb(), userId);
  if (!studio) redirect("/settings");

  return (
    <main className="mx-auto max-w-3xl">
      <h1 className="font-serif text-3xl">Dashboard</h1>
      <p className="mt-2 font-mono text-sm text-owner-muted">{studio.name}</p>

      <div className="mt-8 rounded-[11px] border border-[#1e4a2c] bg-[#101a12] p-8 text-center">
        <div className="mb-2 font-mono text-[9.5px] uppercase tracking-[.12em] text-success">
          Share your booking link
        </div>
        <div className="mb-2.5 text-lg font-bold">/book/{studio.slug}</div>
        <p className="mx-auto mb-4 max-w-sm text-xs leading-relaxed text-owner-muted">
          Booking requests will appear here when renters use your link. Drop it in your
          Instagram bio, Peerspace profile, anywhere.
        </p>
        <CopyLinkButton slug={studio.slug} />
      </div>

      <p className="mt-6 text-xs text-owner-muted">
        Rates, rules, or checklist changed?{" "}
        <Link href="/settings" className="text-owner-accent">Edit settings &amp; policies</Link>
      </p>
    </main>
  );
}
