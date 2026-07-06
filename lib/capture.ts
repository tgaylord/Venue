export function parseKind(raw: string): "pre" | "post" | null {
  return raw === "pre" || raw === "post" ? raw : null;
}

const WEBVIEW_MARKERS = [/FBAN|FBAV|FB_IAB/i, /Instagram/i, /\bLine\//i, /GmailApp/i, /\bMicroMessenger\b/i];
export function isInAppWebview(ua: string): boolean {
  return WEBVIEW_MARKERS.some((re) => re.test(ua));
}

export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Downscale a captured frame/image to a compressed JPEG. Browser-only. */
export async function compressToJpeg(
  source: CanvasImageSource, srcW: number, srcH: number, maxEdge = 1600, quality = 0.8
): Promise<Blob> {
  const scale = Math.min(1, maxEdge / Math.max(srcW, srcH));
  const w = Math.round(srcW * scale), h = Math.round(srcH * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  ctx.drawImage(source, 0, 0, w, h);
  return await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/jpeg", quality)
  );
}
