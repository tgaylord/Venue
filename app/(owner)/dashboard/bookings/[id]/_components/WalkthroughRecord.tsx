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
          {photos.map((photo) => {
            const href = `/dashboard/bookings/${bookingId}/walkthrough/${kind}/photo/${photo.id}`;
            const time = photo.serverCapturedAt.toLocaleTimeString();
            return (
              <a key={photo.id} href={href} className="block overflow-hidden rounded border border-owner-border hover:border-owner-accent">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={href}
                  alt={`${label} photo captured ${time}`}
                  loading="lazy"
                  className="h-16 w-16 object-cover"
                />
              </a>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
