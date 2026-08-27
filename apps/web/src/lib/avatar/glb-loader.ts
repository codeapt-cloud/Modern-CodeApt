/**
 * Measured GLB loader (Step 37.2). Instead of trusting `navigator.connection`, we
 * START the avatar download and ABORT it if the MEASURED rate is genuinely too
 * slow — and VALIDATE the response so a 404 / SPA `index.html` fallback (the exact
 * case where the file was never deployed) is reported clearly instead of blowing
 * up inside the GLTF parser. The pure decisions (`shouldAbortGlb`,
 * `validateGlbResponse`) are unit-tested; `fetchGlbObjectUrl` is a thin,
 * fully-guarded wrapper over fetch + a stream reader.
 */

/** Grace before the rate check kicks in (let TLS/first bytes settle). */
export const GLB_GRACE_MS = 6_000;
/** After grace, abort if the projected TOTAL time exceeds this (known size). */
export const GLB_MAX_PROJECTED_MS = 60_000;
/** Fallback when size is unknown: abort if the rate is below this (bytes/sec). */
export const GLB_MIN_RATE_BPS = 60_000; // ~60 KB/s
/** Absolute hard cap regardless. */
export const GLB_HARD_CAP_MS = 120_000;

export type GlbFailReason = "not-found" | "not-glb" | "too-slow" | "network" | "aborted";

export interface GlbValidation {
  readonly ok: boolean;
  readonly reason?: GlbFailReason;
}

/** The GLB magic number: ASCII "glTF" (0x46546C67 little-endian). */
const GLB_MAGIC = [0x67, 0x6c, 0x54, 0x46];

/**
 * Validate the response headers + first bytes. Rejects a 404 and, crucially, an
 * HTML body (a SPA catch-all serving index.html when the file isn't deployed) —
 * so "the GLB wasn't deployed" surfaces as a clear reason, not a parser crash.
 */
export function validateGlbResponse(
  status: number,
  contentType: string | null,
  firstBytes?: Uint8Array | null,
): GlbValidation {
  if (status >= 400) return { ok: false, reason: "not-found" };
  const ct = (contentType ?? "").toLowerCase();
  if (ct.includes("text/html")) return { ok: false, reason: "not-found" }; // SPA fallback
  if (firstBytes && firstBytes.length >= 4) {
    const isGlb = GLB_MAGIC.every((b, i) => firstBytes[i] === b);
    if (!isGlb) return { ok: false, reason: "not-glb" };
  }
  return { ok: true };
}

/**
 * Should we abort the in-flight download? `forced` (an override) never aborts.
 * Before the grace window we always continue. After it, we abort when the
 * projected total time (from the measured rate) is too long, or — when the size
 * is unknown — when the rate itself is below the floor, or past the hard cap.
 */
export function shouldAbortGlb(args: {
  loaded: number;
  total: number | null;
  elapsedMs: number;
  forced: boolean;
}): boolean {
  const { loaded, total, elapsedMs, forced } = args;
  if (forced) return false;
  if (elapsedMs > GLB_HARD_CAP_MS) return true;
  if (elapsedMs < GLB_GRACE_MS) return false;
  const bytesPerSec = loaded / (elapsedMs / 1000);
  if (bytesPerSec <= 0) return true; // no progress after the grace window
  if (total && total > 0) {
    const projectedMs = (total / bytesPerSec) * 1000;
    return projectedMs > GLB_MAX_PROJECTED_MS;
  }
  return bytesPerSec < GLB_MIN_RATE_BPS;
}

export interface GlbLoadResult {
  readonly objectUrl: string;
  readonly bytes: number;
}

/**
 * Fetch the GLB with progress + measured rate-abort + validation. Resolves an
 * object URL (for TalkingHead's `showAvatar`) or throws `{ reason }`. `now` is
 * injectable for testing; defaults to performance.now.
 */
export async function fetchGlbObjectUrl(
  url: string,
  opts: {
    forced?: boolean;
    onProgress?: (loaded: number, total: number | null) => void;
    now?: () => number;
  } = {},
): Promise<GlbLoadResult> {
  const forced = !!opts.forced;
  const now = opts.now ?? (() => performance.now());
  const controller = new AbortController();
  const start = now();
  let res: Response;
  try {
    res = await fetch(url, { signal: controller.signal, cache: "force-cache" });
  } catch {
    throw { reason: "network" as GlbFailReason };
  }
  const headCheck = validateGlbResponse(res.status, res.headers.get("content-type"));
  if (!headCheck.ok) throw { reason: headCheck.reason };
  const total = Number(res.headers.get("content-length")) || null;

  if (!res.body) {
    // No stream (rare) — fall back to a plain blob, still validating the magic.
    const buf = new Uint8Array(await res.arrayBuffer());
    const v = validateGlbResponse(res.status, res.headers.get("content-type"), buf.slice(0, 4));
    if (!v.ok) throw { reason: v.reason };
    return { objectUrl: URL.createObjectURL(new Blob([buf] as BlobPart[])), bytes: buf.byteLength };
  }

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  let checkedMagic = false;
  for (;;) {
    let chunk: ReadableStreamReadResult<Uint8Array>;
    try {
      chunk = await reader.read();
    } catch {
      throw { reason: "network" as GlbFailReason };
    }
    if (chunk.done) break;
    const value = chunk.value;
    if (!checkedMagic && value.length >= 4) {
      const v = validateGlbResponse(res.status, res.headers.get("content-type"), value.slice(0, 4));
      if (!v.ok) {
        controller.abort();
        throw { reason: v.reason };
      }
      checkedMagic = true;
    }
    chunks.push(value);
    loaded += value.length;
    opts.onProgress?.(loaded, total);
    if (shouldAbortGlb({ loaded, total, elapsedMs: now() - start, forced })) {
      controller.abort();
      throw { reason: "too-slow" as GlbFailReason };
    }
  }
  return { objectUrl: URL.createObjectURL(new Blob(chunks as BlobPart[])), bytes: loaded };
}
