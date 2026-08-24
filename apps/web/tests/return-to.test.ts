/**
 * Step 25 C3 — the composite carries a `?from=` return target into the engine
 * runners. It's user-controllable, so `safeReturnPath` must accept ONLY an
 * in-app path and reject anything that could become an open redirect. And
 * `communicationRunnerPath` must build the right additive query params per part.
 */
import { describe, expect, it } from "vitest";

import { communicationRunnerPath } from "../src/lib/communication-launch.js";
import { safeReturnPath } from "../src/lib/return-to.js";

describe("safeReturnPath — open-redirect guard", () => {
  it("accepts a genuine in-app path", () => {
    expect(safeReturnPath("/c/acme/communication/assessments/abc123")).toBe(
      "/c/acme/communication/assessments/abc123",
    );
    expect(safeReturnPath("/exams")).toBe("/exams");
  });

  it("rejects absolute URLs and non-path schemes", () => {
    expect(safeReturnPath("https://evil.com")).toBeNull();
    expect(safeReturnPath("http://evil.com/path")).toBeNull();
    expect(safeReturnPath("javascript:alert(1)")).toBeNull();
    expect(safeReturnPath("mailto:x@y.z")).toBeNull();
  });

  it("rejects protocol-relative and backslash host tricks", () => {
    expect(safeReturnPath("//evil.com")).toBeNull();
    expect(safeReturnPath("/\\evil.com")).toBeNull();
    expect(safeReturnPath("/\\/evil.com")).toBeNull();
    expect(safeReturnPath("/a\\b")).toBeNull();
  });

  it("rejects path traversal and control chars", () => {
    expect(safeReturnPath("/a/../../etc/passwd")).toBeNull();
    expect(safeReturnPath("/..")).toBeNull();
    expect(safeReturnPath("/ok\nLocation: https://evil.com")).toBeNull();
    expect(safeReturnPath("/has space")).toBeNull();
  });

  it("rejects empty / relative / over-long", () => {
    expect(safeReturnPath(null)).toBeNull();
    expect(safeReturnPath("")).toBeNull();
    expect(safeReturnPath("relative/path")).toBeNull();
    expect(safeReturnPath("/" + "a".repeat(600))).toBeNull();
  });
});

describe("communicationRunnerPath — additive launch URLs", () => {
  const from = "/c/acme/communication/assessments/asmt1";
  const enc = encodeURIComponent(from);

  it("exam/essay carry ?c=<slug> AND ?from=<composite>", () => {
    expect(communicationRunnerPath("acme", "exam", "ex1", from)).toBe(
      `/exam/ex1?c=acme&from=${enc}`,
    );
    expect(communicationRunnerPath("acme", "essay", "es1", from)).toBe(
      `/essays/es1?c=acme&from=${enc}`,
    );
  });

  it("speaking deep-links with ?assessment=<ref> AND ?from=<composite>", () => {
    expect(communicationRunnerPath("acme", "speaking", "sp1", from)).toBe(
      `/c/acme/speaking?assessment=sp1&from=${enc}`,
    );
  });

  it("the from target round-trips through safeReturnPath (so runners honour it)", () => {
    const url = communicationRunnerPath("acme", "exam", "ex1", from);
    const back = new URLSearchParams(url.split("?")[1]).get("from");
    expect(safeReturnPath(back)).toBe(from);
  });
});
