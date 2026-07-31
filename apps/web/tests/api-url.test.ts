/**
 * API URL join — regression for the double-slash that 404'd the code-run SSE
 * stream: `VITE_API_URL` ending in "/" was concatenated with `/api/...` in a
 * hand-built template, yielding `http://host//api/...`. `apiUrl` must collapse
 * base+path to exactly one slash (while keeping the protocol's "//").
 */
import { describe, expect, it } from "vitest";

import { apiUrl } from "../src/lib/url.js";

const streamPath = "/api/execute/job-123/stream";

/** Everything after the protocol must never contain a "//". */
function hasDoubleSlashInPath(url: string): boolean {
  return /\/\//.test(url.replace(/^[a-z]+:\/\//i, ""));
}

describe("apiUrl", () => {
  it("collapses a trailing-slash base + leading-slash path to one slash", () => {
    expect(apiUrl("http://localhost:5173/", streamPath)).toBe(
      "http://localhost:5173/api/execute/job-123/stream",
    );
  });

  it("handles a base with NO trailing slash identically", () => {
    expect(apiUrl("http://localhost:5173", streamPath)).toBe(
      "http://localhost:5173/api/execute/job-123/stream",
    );
  });

  it("collapses multiple trailing slashes too", () => {
    expect(apiUrl("http://localhost:5173///", streamPath)).toBe(
      "http://localhost:5173/api/execute/job-123/stream",
    );
  });

  it("yields a root-relative path for an empty base (dev / Vite proxy)", () => {
    const url = apiUrl("", streamPath);
    expect(url).toBe("/api/execute/job-123/stream");
    expect(hasDoubleSlashInPath(url)).toBe(false);
  });

  it("never leaves a '//' in the path for any base variant", () => {
    for (const base of [
      "",
      "http://localhost:5173",
      "http://localhost:5173/",
      "https://api.example.com/",
    ]) {
      expect(hasDoubleSlashInPath(apiUrl(base, streamPath))).toBe(false);
    }
  });
});
