/**
 * Step 37.2 — PURE tests for the measured GLB loader's decisions: validating the
 * response (a 404 or SPA index.html fallback → clear reason, not a parser crash)
 * and the rate-abort (start the download, abort only if the MEASURED rate is truly
 * too slow; a forced override never aborts).
 */
import {
  GLB_GRACE_MS,
  GLB_HARD_CAP_MS,
  shouldAbortGlb,
  validateGlbResponse,
} from "../src/lib/avatar/glb-loader.js";
import { describe, expect, it } from "vitest";

const glbHead = new Uint8Array([0x67, 0x6c, 0x54, 0x46]); // "glTF"

describe("validateGlbResponse", () => {
  it("accepts a real GLB (octet-stream + glTF magic)", () => {
    expect(validateGlbResponse(200, "model/gltf-binary", glbHead)).toEqual({ ok: true });
    expect(validateGlbResponse(200, "application/octet-stream", glbHead)).toEqual({ ok: true });
  });

  it("rejects a 404 as not-found", () => {
    expect(validateGlbResponse(404, "text/html", null)).toEqual({ ok: false, reason: "not-found" });
  });

  it("rejects the SPA index.html fallback (file not deployed) as not-found", () => {
    // The exact production symptom: 200 OK but Content-Type text/html.
    expect(validateGlbResponse(200, "text/html; charset=utf-8", null)).toEqual({
      ok: false,
      reason: "not-found",
    });
  });

  it("rejects a 200 whose bytes aren't a GLB", () => {
    const html = new Uint8Array([0x3c, 0x21, 0x64, 0x6f]); // "<!do"
    expect(validateGlbResponse(200, "application/octet-stream", html)).toEqual({
      ok: false,
      reason: "not-glb",
    });
  });
});

describe("shouldAbortGlb — measure, don't guess", () => {
  it("never aborts during the grace window", () => {
    expect(
      shouldAbortGlb({ loaded: 1, total: 36_800_000, elapsedMs: GLB_GRACE_MS - 1, forced: false }),
    ).toBe(false);
  });

  it("a genuinely slow link (tiny progress after grace) aborts", () => {
    // ~5 KB in 10s on a 36.8 MB file → projected hours → abort.
    expect(
      shouldAbortGlb({ loaded: 5_000, total: 36_800_000, elapsedMs: 10_000, forced: false }),
    ).toBe(true);
  });

  it("a fine link (that the browser mislabelled '3g') is NOT aborted", () => {
    // ~4 MB in 10s ≈ 400 KB/s → 36.8 MB projects to ~92s… still > 60s cap → abort?
    // Use a clearly-fine rate: ~8 MB in 10s ≈ 800 KB/s → ~46s projected → keep.
    expect(
      shouldAbortGlb({ loaded: 8_000_000, total: 36_800_000, elapsedMs: 10_000, forced: false }),
    ).toBe(false);
  });

  it("forced (override) never aborts, even when crawling", () => {
    expect(
      shouldAbortGlb({ loaded: 1_000, total: 36_800_000, elapsedMs: 30_000, forced: true }),
    ).toBe(false);
  });

  it("the hard cap aborts regardless of rate", () => {
    expect(
      shouldAbortGlb({ loaded: 30_000_000, total: 36_800_000, elapsedMs: GLB_HARD_CAP_MS + 1, forced: false }),
    ).toBe(true);
  });

  it("unknown size falls back to a rate floor", () => {
    expect(shouldAbortGlb({ loaded: 100_000, total: null, elapsedMs: 10_000, forced: false })).toBe(
      true, // 10 KB/s < 60 KB/s floor
    );
    expect(shouldAbortGlb({ loaded: 2_000_000, total: null, elapsedMs: 10_000, forced: false })).toBe(
      false, // 200 KB/s
    );
  });
});
