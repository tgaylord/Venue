import { auth } from "@clerk/nextjs/server";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getDb } from "@/lib/db";
import { getStudioByClerkUserId } from "@/lib/studio";
import { getBookingForOwner, getBookingEvents } from "@/lib/booking";
import { getContractForBooking } from "@/lib/contract";
import { toBookingView, walkthroughEntries } from "@/lib/domain/booking-view";
import { getWalkthroughSummary, getWalkthroughWithPhotos } from "@/lib/walkthrough";
import { formatAtlantaRange } from "@/lib/tz";
import { formatCents } from "@/lib/money";
import StateChip from "../../../_components/StateChip";
import LifecycleRail from "./_components/LifecycleRail";
import ActionButtons from "./_components/ActionButtons";
import DepositControl from "./_components/DepositControl";
import WalkthroughRecord from "./_components/WalkthroughRecord";
import { DEPOSIT_LABELS } from "./forms";

export default async function BookingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");
  const db = getDb();
  const studio = await getStudioByClerkUserId(db, userId);
  if (!studio) redirect("/settings");

  const booking = await getBookingForOwner(db, id, studio.id);
  if (!booking) notFound();
  const events = await getBookingEvents(db, id);
  const contract = await getContractForBooking(db, id);
  const view = toBookingView(booking, new Date());
  const snap = (booking.rateSnapshot ?? {}) as Record<string, unknown>;
  const wtSummary = await getWalkthroughSummary(db, id);
  const entries = walkthroughEntries(view.effectiveState, wtSummary);
  const preRecord = wtSummary.preLocked ? await getWalkthroughWithPhotos(db, id, "pre") : null;
  const postRecord = wtSummary.postLocked ? await getWalkthroughWithPhotos(db, id, "post") : null;

  return (
    <main className="mx-auto max-w-4xl">
      <Link href="/dashboard" className="text-sm text-owner-muted hover:text-owner-text">← Dashboard</Link>

      <header className="mt-3 flex items-start justify-between">
        <div>
          <h1 className="font-serif text-3xl text-owner-text">{booking.eventType ?? "Event request"}</h1>
          <p className="mt-1 text-sm text-owner-muted">
            {booking.renterName} · {booking.renterEmail}{booking.renterPhone ? ` · ${booking.renterPhone}` : ""}
          </p>
        </div>
        <StateChip label={view.chip.label} tone={view.chip.tone} />
      </header>

      <div className="mt-3 flex flex-wrap gap-2 font-mono text-[11px] text-owner-muted">
        <span className="rounded border border-owner-border px-2 py-1">{formatAtlantaRange(booking.startsAt, booking.endsAt)}</span>
        {booking.headcount != null ? <span className="rounded border border-owner-border px-2 py-1">{booking.headcount} guests</span> : null}
        <span className="rounded border border-owner-border px-2 py-1">{booking.byob ? "BYOB" : "No BYOB"}</span>
        <span className="rounded border border-owner-border px-2 py-1">{booking.outsideVendors ? "Outside vendors" : "In-house only"}</span>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-[240px_1fr]">
        <LifecycleRail current={view.effectiveState} events={events} />

        <div className="flex flex-col gap-4">
          {/* Primary action card, by effective state */}
          {view.effectiveState === "pending" ? (
            <div className="rounded-xl border border-[#4a3a1a] bg-[#1b1710] p-4">
              <div className="font-mono text-[10px] uppercase tracking-wider text-warning">New booking request</div>
              <p className="mt-2 text-sm text-owner-text">
                {booking.renterName} requested this date. Approving generates the rental agreement and sends it to the renter.
              </p>
              <div className="mt-4"><ActionButtons bookingId={booking.id} actions={view.legalActions} /></div>
            </div>
          ) : null}

          {view.effectiveState === "awaiting_contract" ? (
            <div className="rounded-xl border border-owner-border bg-owner-panel p-4">
              <div className="font-mono text-[10px] uppercase tracking-wider text-owner-muted">Contract</div>
              <p className="mt-2 text-sm text-owner-text">
                Generate the Standard Event Rental Agreement from this booking&rsquo;s terms. It&rsquo;s stored for download,
                and the booking moves to awaiting signature so you can send it for signing.
              </p>
              <div className="mt-4"><ActionButtons bookingId={booking.id} actions={view.legalActions} /></div>
            </div>
          ) : null}

          {view.effectiveState === "awaiting_signature" ? (
            <div className="rounded-xl border border-[#4a3a1a] bg-[#1b1710] p-4">
              <div className="font-mono text-[10px] uppercase tracking-wider text-warning">Get this contract signed</div>
              <p className="mt-2 text-sm text-owner-text">
                The renter already has a download link by email. To get it signed, use any free e-sign
                tool (DocuSign, Adobe Sign, HelloSign) or print and sign at the pre-event walkthrough.
              </p>
              {contract?.pdfR2Key ? (
                <a
                  href={`/dashboard/bookings/${booking.id}/contract`}
                  className="mt-3 inline-block rounded-lg border border-owner-border px-4 py-2 text-sm text-owner-text hover:border-owner-accent"
                >
                  Download agreement (PDF)
                </a>
              ) : null}
              <div className="mt-4 border-t border-owner-border pt-4">
                <p className="mb-3 text-sm text-owner-muted">
                  Once both parties have signed, mark it below to confirm the booking.
                </p>
                <ActionButtons bookingId={booking.id} actions={view.legalActions} />
              </div>
            </div>
          ) : null}

          {view.effectiveState === "confirmed" ? (
            <div className="rounded-xl border border-[#1e6b3f] bg-[#0b1a10] p-4">
              <div className="font-mono text-[10px] uppercase tracking-wider text-success">Confirmed</div>
              <p className="mt-2 text-sm text-owner-text">This booking is confirmed. Cancel below if plans change before the event.</p>
              <div className="mt-4"><ActionButtons bookingId={booking.id} actions={view.legalActions} /></div>
            </div>
          ) : null}

          {view.effectiveState === "event_day" && !entries.includes("start_pre_walkthrough") ? (
            <div className="rounded-xl border border-[#4a3a1a] bg-[#1b1710] p-4">
              <div className="font-mono text-[10px] uppercase tracking-wider text-warning">Event today</div>
              <p className="mt-2 text-sm text-owner-text">Pre-event documentation locked.</p>
            </div>
          ) : null}

          {view.effectiveState === "post_event" && !entries.includes("start_post_walkthrough") ? (
            <div className="rounded-xl border border-owner-border bg-owner-panel p-4">
              <div className="font-mono text-[10px] uppercase tracking-wider text-owner-muted">Ready to close out</div>
              <p className="mt-2 text-sm text-owner-text">
                Post-event documentation locked. Return the renter&rsquo;s deposit off-platform, update its
                status below, then close out this booking when everything is settled.
              </p>
              <div className="mt-4"><ActionButtons bookingId={booking.id} actions={view.legalActions} /></div>
            </div>
          ) : null}

          {entries.includes("start_pre_walkthrough") ? (
            <div className="rounded-xl border border-[#4a3a1a] bg-[#1b1710] p-4">
              <div className="font-mono text-[10px] uppercase tracking-wider text-warning">Pre-event walkthrough</div>
              <p className="mt-2 text-sm text-owner-text">
                Photograph every area before {booking.renterName} arrives — each photo is server-timestamped and
                locked into a timestamped record.
              </p>
              <Link
                href={`/dashboard/bookings/${booking.id}/walkthrough/pre`}
                className="mt-4 inline-block rounded-lg bg-owner-accent px-4 py-2 text-sm font-bold text-[#0d0e14]"
              >
                Start pre-event walkthrough
              </Link>
            </div>
          ) : null}

          {entries.includes("start_post_walkthrough") ? (
            <div className="rounded-xl border border-owner-border bg-owner-panel p-4">
              <div className="font-mono text-[10px] uppercase tracking-wider text-owner-muted">Post-event walkthrough</div>
              <p className="mt-2 text-sm text-owner-text">
                Photograph the space after the event — each photo is server-timestamped and locked into a
                timestamped record.
              </p>
              <Link
                href={`/dashboard/bookings/${booking.id}/walkthrough/post`}
                className="mt-4 inline-block rounded-lg bg-owner-accent px-4 py-2 text-sm font-bold text-[#0d0e14]"
              >
                Start post-event walkthrough
              </Link>
            </div>
          ) : null}

          {view.effectiveState === "closed" || view.effectiveState === "declined" || view.effectiveState === "canceled" ? (
            <div className="rounded-xl border border-owner-border bg-owner-panel p-4">
              <div className="font-mono text-[10px] uppercase tracking-wider text-owner-muted">{view.chip.label}</div>
              <p className="mt-2 text-sm text-owner-muted">
                {view.effectiveState === "declined"
                  ? "You declined this request."
                  : view.effectiveState === "canceled"
                    ? "This booking was canceled."
                    : "This booking is closed out."}
              </p>
            </div>
          ) : null}

          {/* Intake + agreed terms (always useful for the owner) */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-owner-border bg-owner-panel p-4">
              <div className="font-mono text-[10px] uppercase tracking-wider text-owner-muted">Intake details</div>
              <dl className="mt-2 space-y-1 text-sm text-owner-text">
                <div>Event type — {booking.eventType ?? "—"}</div>
                <div>Estimated headcount — {booking.headcount ?? "—"}</div>
                <div>{booking.byob ? "BYOB" : "No BYOB"} · {booking.outsideVendors ? "Outside vendors" : "In-house only"}</div>
                {booking.notes ? <div className="text-owner-muted">&ldquo;{booking.notes}&rdquo;</div> : null}
              </dl>
            </div>
            <div className="rounded-xl border border-owner-border bg-owner-panel p-4">
              <div className="font-mono text-[10px] uppercase tracking-wider text-owner-muted">Agreed terms</div>
              <dl className="mt-2 space-y-1 text-sm text-owner-text">
                <div>Rate — {snap.hourlyRateCents != null ? `${formatCents(Number(snap.hourlyRateCents))}/hr` : "—"}</div>
                <div>Minimum — {snap.minHours != null ? `${snap.minHours} hrs` : "—"}</div>
                <div>Deposit — {booking.depositCents != null ? formatCents(booking.depositCents) : "—"}</div>
                <div>Alcohol — {(snap.alcoholPolicy as string) ?? "—"}</div>
                <div>Vendors — {(snap.vendorPolicy as string) ?? "—"}</div>
              </dl>
            </div>
          </div>

          {/* Status grid — Contract / Deposit / Documentation (COI dropped for v0.5) */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="rounded-xl border border-owner-border bg-owner-panel p-4">
              <div className="font-mono text-[10px] uppercase tracking-wider text-owner-muted">Contract</div>
              {contract?.status === "signed" ? (
                <p className="mt-2 text-sm text-success">Signed{contract.signedAt ? ` · ${contract.signedAt.toLocaleDateString()}` : ""}</p>
              ) : contract?.pdfR2Key ? (
                <p className="mt-2 text-sm text-owner-text">
                  Generated &amp; sent ·{" "}
                  <a className="underline hover:text-owner-accent" href={`/dashboard/bookings/${booking.id}/contract`}>Download PDF</a>
                </p>
              ) : (
                <p className="mt-2 text-sm text-owner-muted">Standard Event Rental · GA jurisdiction · not yet generated.</p>
              )}
            </div>
            <div className="rounded-xl border border-owner-border bg-owner-panel p-4">
              <div className="font-mono text-[10px] uppercase tracking-wider text-owner-muted">Damage deposit</div>
              <p className="mt-2 text-sm text-owner-text">
                {booking.depositCents != null ? formatCents(booking.depositCents) : "—"} · arranged with the studio directly
              </p>
              {view.depositControlActive ? (
                <div className="mt-3"><DepositControl bookingId={booking.id} current={booking.depositStatus} /></div>
              ) : (
                <p className="mt-2 text-xs text-owner-muted">Status: {DEPOSIT_LABELS[booking.depositStatus]}</p>
              )}
            </div>
            <div className="rounded-xl border border-owner-border bg-owner-panel p-4">
              <div className="font-mono text-[10px] uppercase tracking-wider text-owner-muted">Condition documentation</div>
              {!booking.depositProtected ? (
                <p className="mt-2 text-xs text-warning">
                  Walkthrough skipped — no defensible timestamped record exists for this event.
                </p>
              ) : null}
              <div className="mt-2 space-y-3 text-sm">
                <WalkthroughRecord label="Pre-event" bookingId={booking.id} kind="pre" record={preRecord} />
                <WalkthroughRecord label="Post-event" bookingId={booking.id} kind="post" record={postRecord} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
