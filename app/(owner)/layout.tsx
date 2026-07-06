import { auth } from "@clerk/nextjs/server";
import { UserButton } from "@clerk/nextjs";
import { getDb } from "@/lib/db";
import { getStudioByClerkUserId } from "@/lib/studio";
import Sidebar from "./_components/Sidebar";

export default async function OwnerLayout({ children }: { children: React.ReactNode }) {
  const { userId } = await auth();
  const studio = userId ? await getStudioByClerkUserId(getDb(), userId) : null;

  return (
    <div className="flex min-h-screen bg-owner-bg text-owner-text">
      <Sidebar studioName={studio?.name ?? null} slug={studio?.slug ?? null} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-owner-border px-6 py-3">
          <span className="font-mono text-xs tracking-widest text-owner-muted">VENUEDASH</span>
          <UserButton />
        </header>
        <div className="flex-1 p-6">{children}</div>
      </div>
    </div>
  );
}
