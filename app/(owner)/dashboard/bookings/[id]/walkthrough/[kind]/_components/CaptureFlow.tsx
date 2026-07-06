"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { isInAppWebview, compressToJpeg, sha256Hex } from "@/lib/capture";
import { requestUpload, commitPhoto, lockWalkthroughAction, skipWalkthroughAction } from "../actions";
import InstallHint from "./InstallHint";

type Item = { id: string; name: string; hint: string | null };
type Props = {
  bookingId: string; kind: "pre" | "post"; renterName: string; locked: boolean;
  items: Item[]; captured: { checklistItemId: string | null; serverCapturedAt: string }[];
};

const KIND_LABEL: Record<"pre" | "post", string> = { pre: "Pre-event", post: "Post-event" };

function subscribeNoop() {
  // The user agent never changes mid-session — no real subscription needed.
  return () => {};
}
function getServerWebview() {
  return false;
}

async function getGeo(): Promise<{ lat: number | null; lng: number | null }> {
  if (!("geolocation" in navigator)) return { lat: null, lng: null };
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => resolve({ lat: null, lng: null }),
      { enableHighAccuracy: false, timeout: 4000 }
    );
  });
}

function formatTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleString("en-US", {
      month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit",
      timeZoneName: "short",
    });
  } catch {
    return iso;
  }
}

export default function CaptureFlow(props: Props) {
  const { bookingId, kind, renterName, items } = props;
  const [idx, setIdx] = useState(0);
  const [done, setDone] = useState<Record<string, boolean>>(
    () => Object.fromEntries(props.captured.filter(c => c.checklistItemId).map(c => [c.checklistItemId as string, true]))
  );
  const [lastCapturedAt, setLastCapturedAt] = useState<Record<string, string>>(
    () => Object.fromEntries(props.captured.filter(c => c.checklistItemId).map(c => [c.checklistItemId as string, c.serverCapturedAt]))
  );
  const [phase, setPhase] = useState<"intro" | "capture" | "review" | "locked">(props.locked ? "locked" : "intro");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [useFallback, setUseFallback] = useState(false);
  const [shot, setShot] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const webview = useSyncExternalStore(
    subscribeNoop,
    () => isInAppWebview(navigator.userAgent),
    getServerWebview
  );

  async function startCamera() {
    try {
      if (!navigator.mediaDevices?.getUserMedia) { setUseFallback(true); return; }
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
      streamRef.current = stream;
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }
    } catch { setUseFallback(true); }
  }
  function stopCamera() { streamRef.current?.getTracks().forEach(t => t.stop()); streamRef.current = null; }

  useEffect(() => {
    // Synchronizing with the camera hardware (an external system) — startCamera's
    // getUserMedia failure path sets `useFallback`, which the linter's static
    // analysis can't distinguish from a "derive state during render" anti-pattern.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (phase === "capture" && !useFallback && !webview) { startCamera(); }
    // Cleanup runs before every re-invocation of this effect (e.g. `idx` bumping on
    // "Next area") AND on unmount — guaranteeing the prior stream's tracks are
    // stopped before a new getUserMedia() call ever fires, and stopped for good
    // when the component unmounts or leaves the capture phase.
    return () => { stopCamera(); };
  }, [phase, idx, useFallback, webview]);

  async function uploadBlob(item: Item, blob: Blob) {
    setBusy(true); setErr(null);
    try {
      const buf = await blob.arrayBuffer();
      const sha256 = await sha256Hex(buf);
      const start = await requestUpload(bookingId, kind, item.id, "image/jpeg");
      if (!start.ok) { setErr(start.error); return; }
      const put = await fetch(start.uploadUrl, { method: "PUT", headers: { "Content-Type": "image/jpeg" }, body: blob });
      if (!put.ok) { setErr("Upload failed — check your connection and retake."); return; }
      const geo = await getGeo();
      const res = await commitPhoto(bookingId, kind, {
        walkthroughId: start.walkthroughId, checklistItemId: item.id,
        sha256, bytes: blob.size, contentType: "image/jpeg", lat: geo.lat, lng: geo.lng,
      });
      if (!res.ok) { setErr(res.error ?? "Could not save."); return; }
      setDone(d => ({ ...d, [item.id]: true }));
      setLastCapturedAt(m => ({ ...m, [item.id]: new Date().toISOString() }));
      setShot(true);
    } finally { setBusy(false); }
  }

  async function captureFromVideo(item: Item) {
    const v = videoRef.current; if (!v) return;
    const blob = await compressToJpeg(v, v.videoWidth, v.videoHeight);
    await uploadBlob(item, blob);
  }
  async function captureFromFile(item: Item, file: File) {
    const bitmap = await createImageBitmap(file);
    const blob = await compressToJpeg(bitmap, bitmap.width, bitmap.height);
    await uploadBlob(item, blob);
  }

  function retake() {
    setShot(false);
    setErr(null);
    const item = items[idx];
    if (item) setDone(d => { const next = { ...d }; delete next[item.id]; return next; });
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function next() {
    setShot(false);
    setErr(null);
    if (idx + 1 >= items.length) {
      setPhase("review");
    } else {
      setIdx(i => i + 1);
    }
  }

  async function lock() {
    setBusy(true); setErr(null);
    const res = await lockWalkthroughAction(bookingId, kind, items.length);
    setBusy(false);
    if (!res.ok) { setErr(res.error ?? "Could not lock."); return; }
    stopCamera(); setPhase("locked");
  }
  async function skip() {
    if (!confirm("Skip this walkthrough? Without it, no timestamped documentation exists for this event and the deposit will be marked unprotected.")) return;
    await skipWalkthroughAction(bookingId);
    window.location.href = `/dashboard/bookings/${bookingId}`;
  }

  const current = items[idx];
  const currentDone = current ? done[current.id] : false;
  const currentCapturedAt = current ? lastCapturedAt[current.id] : undefined;
  const allDone = items.length > 0 && items.every((it) => done[it.id]);
  const pct = items.length > 0 ? Math.round(((idx + (currentDone ? 1 : 0)) / items.length) * 100) : 0;

  if (phase === "intro") {
    return (
      <div className="mt-4 flex flex-1 flex-col gap-4">
        <div>
          <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.12em] text-warning">
            {KIND_LABEL[kind]} documentation
          </div>
          <h1 className="text-xl font-bold text-owner-text">{renterName}&rsquo;s booking</h1>
        </div>
        <p className="text-sm leading-relaxed text-owner-muted">
          You&rsquo;ll capture one photo per checklist area. Each photo is timestamped by the server
          and geotagged the moment it&rsquo;s uploaded — this becomes the {kind === "pre" ? "pre-event" : "post-event"} timestamped
          documentation for this booking. It takes about 3 minutes.
        </p>
        <InstallHint />
        {webview && (
          <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-[13px] leading-relaxed text-owner-text">
            This link opened inside another app&rsquo;s in-app browser, which can block the live camera.
            Open this page in Safari (or your installed VenueDash app) for the best capture experience,
            or use the file picker below if you continue here.
          </div>
        )}
        {err && <p className="text-sm text-danger">{err}</p>}
        <button
          onClick={() => setPhase("capture")}
          className="mt-auto cursor-pointer rounded-xl bg-owner-accent px-4 py-4 text-[15px] font-bold text-owner-bg"
        >
          Start {kind === "pre" ? "pre-event" : "post-event"} walkthrough
        </button>
        <button
          onClick={skip}
          className="cursor-pointer text-center text-sm font-medium text-owner-muted hover:text-owner-text"
        >
          Skip walkthrough
        </button>
      </div>
    );
  }

  if (phase === "capture" && current) {
    return (
      <div className="mt-2 flex flex-1 flex-col">
        <div className="mb-1 font-mono text-[9.5px] uppercase tracking-[0.12em] text-warning">
          {KIND_LABEL[kind]} documentation
        </div>
        <div className="mb-3 text-xs text-owner-muted">{renterName}&rsquo;s booking</div>
        <div className="mb-4 h-1 overflow-hidden rounded-full bg-owner-border">
          <div className="h-full rounded-full bg-owner-accent transition-[width]" style={{ width: `${pct}%` }} />
        </div>
        <div className="mb-1 font-mono text-[10px] text-owner-muted">ITEM {idx + 1} OF {items.length}</div>
        <div className="mb-1 text-xl font-bold tracking-tight text-owner-text">{current.name}</div>
        {current.hint && <div className="mb-4 text-[12.5px] leading-relaxed text-owner-muted">{current.hint}</div>}

        <div className="relative mb-4 flex flex-1 items-center justify-center overflow-hidden rounded-2xl border border-owner-border bg-owner-panel">
          {shot && currentDone ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2.5 bg-owner-panel-2">
              <div className="flex h-11 w-11 items-center justify-center rounded-full border border-success bg-success/10 text-[19px] text-success">✓</div>
              <div className="text-[13px] font-semibold text-owner-text">Photo captured</div>
              <div className="absolute inset-x-0 bottom-0 flex justify-between bg-black/55 px-3.5 py-2.5 font-mono text-[9.5px] text-owner-muted">
                <span>{currentCapturedAt ? formatTimestamp(currentCapturedAt) : ""} · SERVER</span>
                <span>Geotagged</span>
              </div>
            </div>
          ) : useFallback || webview ? (
            <div className="px-6 text-center font-mono text-[10px] leading-loose tracking-[0.08em] text-owner-muted">
              CAMERA FALLBACK
              <br />
              use the file picker below to attach a photo
            </div>
          ) : (
            <video ref={videoRef} muted playsInline className="h-full w-full object-cover" />
          )}
        </div>

        {err && <p className="mb-2 text-sm text-danger">{err}</p>}

        <div className="flex gap-2.5 pb-2">
          {!shot && (
            <>
              {(useFallback || webview) ? (
                <>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) captureFromFile(current, file);
                    }}
                  />
                  <button
                    disabled={busy}
                    onClick={() => fileInputRef.current?.click()}
                    className="flex-1 cursor-pointer rounded-xl bg-owner-accent px-4 py-4 text-[15px] font-bold text-owner-bg disabled:opacity-60"
                  >
                    {busy ? "Uploading…" : "Choose photo"}
                  </button>
                </>
              ) : (
                <button
                  disabled={busy}
                  onClick={() => captureFromVideo(current)}
                  className="flex-1 cursor-pointer rounded-xl bg-owner-accent px-4 py-4 text-[15px] font-bold text-owner-bg disabled:opacity-60"
                >
                  {busy ? "Uploading…" : "Capture photo"}
                </button>
              )}
            </>
          )}
          {shot && currentDone && (
            <>
              <button
                onClick={retake}
                className="cursor-pointer rounded-xl border border-owner-border px-4 py-4 text-sm font-semibold text-owner-muted"
              >
                Retake
              </button>
              <button
                onClick={next}
                className="flex-1 cursor-pointer rounded-xl bg-owner-accent px-4 py-4 text-[15px] font-bold text-owner-bg"
              >
                {idx + 1 >= items.length ? "Review" : "Next area"}
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  if (phase === "review") {
    return (
      <div className="mt-2 flex flex-1 flex-col">
        <div className="mb-1 font-mono text-[9.5px] uppercase tracking-[0.12em] text-warning">Review before locking</div>
        <h1 className="mb-3.5 text-lg font-bold text-owner-text">
          {allDone ? `All ${items.length} areas documented` : `${items.filter((it) => done[it.id]).length} of ${items.length} areas documented`}
        </h1>
        <div className="mb-4 grid grid-cols-3 gap-2">
          {items.map((it) => (
            <div key={it.id} className="overflow-hidden rounded-[9px] border border-owner-border">
              <div className="flex h-16 items-center justify-center bg-owner-panel text-[14px] text-success">
                {done[it.id] ? "✓" : ""}
              </div>
              <div className="bg-owner-panel-2 px-1.5 py-1">
                <div className="truncate text-[9.5px] font-semibold text-owner-text">{it.name}</div>
                <div className="font-mono text-[8px] text-owner-muted">
                  {lastCapturedAt[it.id] ? formatTimestamp(lastCapturedAt[it.id]) : "—"}
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="mb-4 rounded-lg border border-warning/40 bg-warning/10 px-3.5 py-3 text-xs leading-relaxed text-owner-text">
          Once locked, this record can&rsquo;t be edited — that&rsquo;s what makes it a reliable timestamped record.
        </div>
        {err && <p className="mb-2 text-sm text-danger">{err}</p>}
        <button
          disabled={busy || !allDone}
          onClick={lock}
          className="mt-auto mb-4 cursor-pointer rounded-xl bg-owner-text px-4 py-4 text-[15px] font-bold text-owner-bg disabled:opacity-60"
        >
          {busy ? "Locking…" : `Lock ${kind}-event documentation`}
        </button>
        <button
          onClick={skip}
          className="mb-2 cursor-pointer text-center text-sm font-medium text-owner-muted hover:text-owner-text"
        >
          Skip walkthrough
        </button>
      </div>
    );
  }

  // locked
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3.5 px-4 text-center">
      <div className="flex h-[58px] w-[58px] items-center justify-center rounded-full border border-success bg-success/10 text-2xl text-success">✓</div>
      <div className="text-xl font-bold text-owner-text">Documentation locked</div>
      <div className="font-mono text-[10px] tracking-[0.06em] text-owner-muted">
        {items.length} PHOTOS · SERVER-TIMESTAMPED · GEOTAGGED
      </div>
      <a
        href={`/dashboard/bookings/${bookingId}`}
        className="mt-1.5 cursor-pointer rounded-lg border border-owner-border px-5 py-2.5 text-[13px] font-semibold text-owner-muted hover:text-owner-text"
      >
        Back to dashboard
      </a>
    </div>
  );
}
