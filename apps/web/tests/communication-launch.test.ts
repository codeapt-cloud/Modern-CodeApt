/**
 * The composite launch URL contract — college (slug-bound) and the B2C / global
 * variant (S30 B3). Each part must route into the right engine runner, carry a
 * `?from=` back to the composite, and — for B2C — hit the slug-free engines
 * (/exam, /essays, the new /speaking/:id). The return target is guarded by
 * safeReturnPath (shared with the college flow), asserted here for the B2C case.
 */
import { describe, expect, it } from "vitest";

import {
  communicationRunnerPath,
  communicationRunnerPathGlobal,
} from "../src/lib/communication-launch.js";
import { safeReturnPath } from "../src/lib/return-to.js";

describe("communicationRunnerPathGlobal — B2C per-part destinations", () => {
  const from = "/communication/C1";
  const back = `from=${encodeURIComponent(from)}`;

  it("routes each part into its GLOBAL engine runner (no slug, no ?c=)", () => {
    expect(communicationRunnerPathGlobal("exam", "E1", from)).toBe(`/exam/E1?${back}`);
    expect(communicationRunnerPathGlobal("essay", "T1", from)).toBe(
      `/essays/T1?${back}`,
    );
    // Speaking uses the NEW slug-free runner, NOT /c/:slug/speaking.
    expect(communicationRunnerPathGlobal("speaking", "S1", from)).toBe(
      `/speaking/S1?${back}`,
    );
  });

  it("never emits a college (/c/) path or a ?c= param", () => {
    for (const t of ["exam", "essay", "speaking"] as const) {
      const p = communicationRunnerPathGlobal(t, "X", from);
      expect(p.startsWith("/c/")).toBe(false);
      expect(p).not.toContain("c=");
    }
  });
});

describe("communicationRunnerPath — college variant is unchanged", () => {
  it("still binds ?c=slug and routes speaking through the college page", () => {
    const from = "/c/acme/communication/assessments/C1";
    expect(communicationRunnerPath("acme", "exam", "E1", from)).toContain("c=acme");
    expect(communicationRunnerPath("acme", "speaking", "S1", from)).toContain(
      "/c/acme/speaking?assessment=S1",
    );
  });
});

describe("B2C return path is guarded (malicious ?from= rejected)", () => {
  it("accepts an in-app composite path but rejects open-redirects", () => {
    expect(safeReturnPath("/communication/C1")).toBe("/communication/C1");
    expect(safeReturnPath("//evil.com")).toBeNull();
    expect(safeReturnPath("https://evil.com")).toBeNull();
    expect(safeReturnPath("/\\evil.com")).toBeNull();
  });
});
