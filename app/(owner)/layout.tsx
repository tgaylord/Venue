import { UserButton } from "@clerk/nextjs";

export default function OwnerLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-owner-bg text-owner-text">
      <header className="flex items-center justify-between border-b border-owner-border px-6 py-4">
        <span className="font-mono text-sm tracking-wide text-owner-muted">VENUEDASH</span>
        <UserButton />
      </header>
      <div className="p-6">{children}</div>
    </div>
  );
}
