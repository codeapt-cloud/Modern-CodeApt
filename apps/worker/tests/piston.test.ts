/**
 * Piston client tests — mock the HTTP layer (global fetch); no live Piston.
 * Covers response parsing (run + compile stages), error mapping (non-2xx,
 * unreachable, bad body), and the timeout path.
 */
import { CodeLanguage } from "@codeapt/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

import { env } from "../src/config/env.js";
import { PistonError, pistonExecute } from "../src/lib/piston.js";

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as unknown as Response;
}

// Snapshot the endpoint env so fallback tests can set distinct primary/fallback
// URLs hermetically (the suite otherwise inherits the developer's real .env,
// where PISTON_URL === PISTON_FALLBACK_URL and the fallback is a no-op).
const ORIGINAL_PISTON_URL = env.PISTON_URL;
const ORIGINAL_PISTON_FALLBACK_URL = env.PISTON_FALLBACK_URL;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  env.PISTON_URL = ORIGINAL_PISTON_URL;
  env.PISTON_FALLBACK_URL = ORIGINAL_PISTON_FALLBACK_URL;
});

describe("pistonExecute", () => {
  it("parses run + compile stages into RunOutputs", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          language: "c++",
          version: "10.2.0",
          compile: { stdout: "", stderr: "", code: 0, signal: null },
          run: { stdout: "Hello\n", stderr: "", code: 0, signal: null },
        }),
      ),
    );

    const result = await pistonExecute({
      language: CodeLanguage.CPP,
      source: "int main(){}",
    });

    expect(result.run.stdout).toBe("Hello\n");
    expect(result.run.exitCode).toBe(0);
    expect(result.run.signal).toBeNull();
    expect(result.compile).not.toBeNull();
    expect(result.timedOut).toBe(false);
    expect(result.version).toBe("10.2.0");
  });

  it("marks a signal-killed run as timedOut with null exit code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          language: "python",
          version: "3.10.0",
          run: { stdout: "", stderr: "Killed", code: null, signal: "SIGKILL" },
        }),
      ),
    );

    const result = await pistonExecute({
      language: CodeLanguage.PYTHON,
      source: "while True: pass",
    });

    expect(result.run.exitCode).toBeNull();
    expect(result.run.signal).toBe("SIGKILL");
    expect(result.timedOut).toBe(true);
    expect(result.compile).toBeNull();
  });

  it("throws PistonError on a non-2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ message: "runtime unknown" }, false, 400),
      ),
    );

    await expect(
      pistonExecute({ language: CodeLanguage.PYTHON, source: "x" }),
    ).rejects.toBeInstanceOf(PistonError);
  });

  it("throws PistonError when the service is unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    );

    await expect(
      pistonExecute({ language: CodeLanguage.PYTHON, source: "x" }),
    ).rejects.toBeInstanceOf(PistonError);
  });

  it("maps an aborted request to a timeout PistonError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const err = new Error("aborted");
        err.name = "AbortError";
        throw err;
      }),
    );

    await expect(
      pistonExecute({ language: CodeLanguage.PYTHON, source: "x" }),
    ).rejects.toThrow(/timed out/i);
  });

  it("requests version '*' by default so any installed runtime matches", async () => {
    // Self-hosted Piston instances rarely match the emkc-pinned patch versions,
    // so the request must not pin (e.g. python 3.10.0) — it sends the wildcard.
    let sentBody: { language?: string; version?: string } = {};
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        sentBody = JSON.parse((init?.body as string) ?? "{}");
        return jsonResponse({
          language: "python",
          version: "3.12.0",
          run: { stdout: "ok\n", stderr: "", code: 0, signal: null },
        });
      }),
    );

    await pistonExecute({ language: CodeLanguage.PYTHON, source: "print(1)" });

    expect(sentBody.version).toBe("*");
    expect(sentBody.language).toBe("python");
  });

  it("falls back to the secondary endpoint when the primary fails, returning its result", async () => {
    env.PISTON_URL = "http://primary.test/api/v2";
    env.PISTON_FALLBACK_URL = "http://fallback.test/api/v2";
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        urls.push(url);
        if (url.includes("primary.test")) throw new Error("ECONNREFUSED");
        return jsonResponse({
          language: "python",
          version: "3.12.0",
          run: { stdout: "from-fallback\n", stderr: "", code: 0, signal: null },
        });
      }),
    );

    const result = await pistonExecute({
      language: CodeLanguage.PYTHON,
      source: "print(1)",
    });

    expect(result.run.stdout).toBe("from-fallback\n");
    // Primary attempted first, then the fallback.
    expect(urls).toEqual([
      expect.stringContaining("primary.test"),
      expect.stringContaining("fallback.test"),
    ]);
  });

  it("throws PistonError only when BOTH primary and fallback fail", async () => {
    env.PISTON_URL = "http://primary.test/api/v2";
    env.PISTON_FALLBACK_URL = "http://fallback.test/api/v2";
    const fetchMock = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      pistonExecute({ language: CodeLanguage.PYTHON, source: "x" }),
    ).rejects.toBeInstanceOf(PistonError);
    // Both endpoints were tried (primary + fallback) before giving up.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("skips the fallback when it is identical to the primary (single attempt)", async () => {
    env.PISTON_URL = "http://same.test/api/v2";
    env.PISTON_FALLBACK_URL = "http://same.test/api/v2";
    const fetchMock = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      pistonExecute({ language: CodeLanguage.PYTHON, source: "x" }),
    ).rejects.toBeInstanceOf(PistonError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
