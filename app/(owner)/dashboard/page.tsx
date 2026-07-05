export default function Dashboard() {
  return (
    <main className="mx-auto max-w-3xl">
      <h1 className="font-serif text-3xl">Dashboard</h1>
      <p className="mt-2 font-mono text-sm text-owner-muted">
        No studio configured yet — foundation skeleton (phase 0).
      </p>
      <div className="mt-8 rounded-lg border border-owner-border bg-owner-panel p-8 text-owner-muted">
        Bookings will appear here.
      </div>
    </main>
  );
}
