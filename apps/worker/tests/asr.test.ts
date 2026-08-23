/**
 * ASR client tests — no real network (fetch is stubbed). Mirrors piston.test.
 * Verifies: valid JSON is parsed into transcript + word timings; the primary
 * endpoint failing falls back once; both failing throws AsrError; a timeout
 * (AbortError) throws; missing config throws with NO network call; ASR_MOCK
 * short-circuits to a canned transcript offline.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { env } from "../src/config/env.js";
import { AsrError, asrTranscribe } from "../src/lib/asr.js";

const INPUT = { audioUrl: "https://cdn.example/audio/a.webm" };

const origUrl = env.ASR_URL;
const origFallback = env.ASR_FALLBACK_URL;
const origMock = env.ASR_MOCK;

afterEach(() => {
  env.ASR_URL = origUrl;
  env.ASR_FALLBACK_URL = origFallback;
  env.ASR_MOCK = origMock;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const okResponse = (body: unknown) =>
  ({ ok: true, json: async () => body }) as unknown as Response;

describe("asrTranscribe — happy path", () => {
  it("parses transcript + word timings from valid JSON", async () => {
    env.ASR_URL = "https://asr.test";
    env.ASR_MOCK = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        okResponse({
          transcript: "hello world",
          words: [
            { word: "hello", start: 0, end: 0.5 },
            { word: "world", start: 0.6, end: 1.0 },
          ],
          language: "en",
          duration: 1.0,
        }),
      ),
    );
    const res = await asrTranscribe(INPUT);
    expect(res.transcript).toBe("hello world");
    expect(res.words).toHaveLength(2);
    expect(res.words[0]).toEqual({ word: "hello", start: 0, end: 0.5 });
    expect(res.language).toBe("en");
  });
});

describe("asrTranscribe — retry + failure", () => {
  it("falls back to the secondary endpoint when the primary fails", async () => {
    env.ASR_URL = "https://primary.test";
    env.ASR_FALLBACK_URL = "https://fallback.test";
    env.ASR_MOCK = false;
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("connreset")) // primary fails
      .mockResolvedValueOnce(okResponse({ transcript: "ok", words: [] })); // fallback
    vi.stubGlobal("fetch", fetchMock);

    const res = await asrTranscribe(INPUT);
    expect(res.transcript).toBe("ok");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]![0]).toContain("primary.test");
    expect(fetchMock.mock.calls[1]![0]).toContain("fallback.test");
  });

  it("throws AsrError when primary AND fallback both fail", async () => {
    env.ASR_URL = "https://primary.test";
    env.ASR_FALLBACK_URL = "https://fallback.test";
    env.ASR_MOCK = false;
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("down");
    }));
    await expect(asrTranscribe(INPUT)).rejects.toBeInstanceOf(AsrError);
  });

  it("maps an aborted request (timeout) to AsrError", async () => {
    env.ASR_URL = "https://primary.test";
    env.ASR_FALLBACK_URL = undefined;
    env.ASR_MOCK = false;
    vi.stubGlobal("fetch", vi.fn(async () => {
      const err = new Error("aborted");
      err.name = "AbortError";
      throw err;
    }));
    await expect(asrTranscribe(INPUT)).rejects.toMatchObject({
      name: "AsrError",
    });
  });

  it("a non-2xx response throws AsrError with the service message", async () => {
    env.ASR_URL = "https://primary.test";
    env.ASR_FALLBACK_URL = undefined;
    env.ASR_MOCK = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        ({
          ok: false,
          status: 500,
          json: async () => ({ error: "model crashed" }),
        }) as unknown as Response,
      ),
    );
    await expect(asrTranscribe(INPUT)).rejects.toThrow(/model crashed/);
  });

  it("throws with NO network call when ASR_URL is unset (not mocked)", async () => {
    env.ASR_URL = undefined;
    env.ASR_MOCK = false;
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await expect(asrTranscribe(INPUT)).rejects.toBeInstanceOf(AsrError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("asrTranscribe — mock", () => {
  it("ASR_MOCK returns a canned transcript offline (no fetch)", async () => {
    env.ASR_MOCK = true;
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const res = await asrTranscribe(INPUT);
    expect(res.transcript.length).toBeGreaterThan(0);
    expect(res.words.length).toBeGreaterThan(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("ASR contract — request/response field names (drift guard)", () => {
  // Fixtures derived from apps/asr/main.py's SNAKE_CASE pydantic schema. The
  // real service rejected a camelCase body with {"loc":["body","audio_url"]} —
  // a stub that accepts anything hides that, so we pin the EXACT wire shape.
  const REQUEST_KEYS = ["audio_url", "word_timestamps", "vad_filter"] as const;

  it("serializes EXACTLY main.py's request fields (snake_case, no camelCase)", async () => {
    env.ASR_URL = "https://asr.test";
    env.ASR_FALLBACK_URL = undefined;
    env.ASR_MOCK = false;
    let sentBody: unknown;
    let sentUrl = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        sentUrl = url;
        sentBody = JSON.parse(String(init.body));
        return okResponse({ transcript: "x", words: [] });
      }),
    );

    await asrTranscribe({ audioUrl: "https://cdn/a.webm" });

    expect(sentUrl).toBe("https://asr.test/transcribe");
    const body = sentBody as Record<string, unknown>;
    // Exact key set — a missing/renamed/extra field fails here.
    expect(Object.keys(body).sort()).toEqual([...REQUEST_KEYS].sort());
    expect(body.audio_url).toBe("https://cdn/a.webm");
    expect(body.word_timestamps).toBe(true);
    expect(body.vad_filter).toBe(true);
    // The exact drift that failed on the VPS must never regress.
    expect(body).not.toHaveProperty("audioUrl");
  });

  it("parses EXACTLY main.py's response shape (incl. duration→durationSeconds)", async () => {
    env.ASR_URL = "https://asr.test";
    env.ASR_MOCK = false;
    // Byte-for-byte what main.py returns.
    const RESPONSE = {
      transcript: "the quick fox",
      words: [
        { word: "the", start: 0.0, end: 0.3 },
        { word: "quick", start: 0.35, end: 0.7 },
        { word: "fox", start: 0.75, end: 1.1 },
      ],
      language: "en",
      duration: 1.1,
    };
    vi.stubGlobal("fetch", vi.fn(async () => okResponse(RESPONSE)));

    const res = await asrTranscribe({ audioUrl: "https://cdn/a.webm" });
    expect(res.transcript).toBe("the quick fox");
    expect(res.words).toEqual(RESPONSE.words);
    expect(res.language).toBe("en");
    expect(res.durationSeconds).toBe(1.1); // reads `duration`, not `durationSeconds`
  });

  it("a response missing `transcript` (renamed field) is rejected, not silently blank", async () => {
    env.ASR_URL = "https://asr.test";
    env.ASR_FALLBACK_URL = undefined;
    env.ASR_MOCK = false;
    // e.g. the service renamed transcript → "text": the client must NOT accept it.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => okResponse({ text: "oops", words: [] })),
    );
    await expect(
      asrTranscribe({ audioUrl: "https://cdn/a.webm" }),
    ).rejects.toBeInstanceOf(AsrError);
  });
});
