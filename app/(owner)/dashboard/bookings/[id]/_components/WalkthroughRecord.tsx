import Link from "next/link";
import type { Photo, Walkthrough, WalkthroughKind } from "@/lib/walkthrough";

type WalkthroughRecordProps = {
  label: string;
  bookingId: string;
  kind: WalkthroughKind;
  record: { walkthrough: Walkthrough; photos: Photo[] } | null;
};

export default function WalkthroughRecord({ label, bookingId, kind, record }: WalkthroughRecordProps) {
  if (!record || !record.walkthrough.lockedAt) {
    return (
      <div>
        <div className="font-mono text-[10px] uppercase tracking-wider text-owner-muted">{label}</div>
        <p className="mt-1 text-xs text-owner-muted">{record ? "In progress" : "Not started"}</p>
      </div>
    );
  }

  const { walkthrough, photos } = record;

  return (
    <div>
      <div className="font-mono text-[10px] uppercase tracking-wider text-owner-muted">{label}</div>
      <p className="mt-1 text-xs text-owner-text">
        Locked · {photos.length} photo{photos.length === 1 ? "" : "s"} · {walkthrough.lockedAt!.toLocaleDateString()}
      </p>
      {photos.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {photos.map((photo) => (
            <Link
              key={photo.id}
              href={`/dashboard/bookings/${bookingId}/walkthrough/${kind}/photo/${photo.id}`}
              className="rounded border border-owner-border px-2 py-1 font-mono text-[10px] text-owner-muted hover:border-owner-accent hover:text-owner-text"
            >
              {photo.serverCapturedAt.toLocaleTimeString()}
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}
