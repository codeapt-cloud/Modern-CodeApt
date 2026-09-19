// @vitest-environment jsdom
/**
 * Run-button cooldown (10s throttle). After a run the hook exposes cooldownMs > 0
 * and ignores a second run fired within the window — preventing the server 429
 * ("running code too quickly") and the request burst that trips the refresh race.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/api-client.js", () => ({
  api: {
    execute: {
      submit: vi.fn(async () => ({ jobId: "job-1" })),
      status: vi.fn(async () => ({ status: "completed", result: null, error: null })),
      streamUrl: () => "http://localhost/stream/job-1",
    },
  },
  parseApiError: (e: unknown) => ({ message: String(e), status: null }),
}));

import { api } from "../src/lib/api-client.js";
import { RUN_COOLDOWN_MS, useCodeRunner } from "../src/lib/use-code-runner.js";

const submit = api.execute.submit as unknown as ReturnType<typeof vi.fn>;

afterEach(() => vi.clearAllMocks());

describe("useCodeRunner — run cooldown", () => {
  it("starts a ~10s cooldown after a run and blocks a run fired within it", async () => {
    const { result, unmount } = renderHook(() => useCodeRunner());
    expect(result.current.cooldownMs).toBe(0);

    await act(async () => {
      await result.current.run({ language: "python", source: "print(1)" } as never);
    });
    expect(submit).toHaveBeenCalledTimes(1);
    expect(result.current.cooldownMs).toBeGreaterThan(0);
    expect(result.current.cooldownMs).toBeLessThanOrEqual(RUN_COOLDOWN_MS);

    // A second run within the cooldown is ignored (no extra submit).
    await act(async () => {
      await result.current.run({ language: "python", source: "print(2)" } as never);
    });
    expect(submit).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("counts the cooldown down toward 0 over time", async () => {
    const { result, unmount } = renderHook(() => useCodeRunner());
    await act(async () => {
      await result.current.run({ language: "python", source: "x" } as never);
    });
    const first = result.current.cooldownMs;
    await waitFor(() => expect(result.current.cooldownMs).toBeLessThan(first), {
      timeout: 2000,
    });
    unmount();
  });
});
