/**
 * ASR (speech-to-text) client — the worker's thin HTTP wrapper over the
 * self-hosted faster-whisper container (apps/asr), mirroring `piston.ts` exactly:
 * a config-driven primary URL + optional fallback, a per-request AbortController
 * timeout, ONE retry against the fallback, and every failure surfaced as a
 * thrown typed error (never a null/sentinel). Word-level timestamps + VAD are
 * requested so the fluency scorer has the timings it needs.
 */
import {
  ASR_MOCK_TRANSCRIPT,
  type WordTiming,
} from "@codeapt/shared";

import { env } from "../config/env.js";
import { logger } from "./logger.js";

export class AsrError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "AsrError";
  }
}

export interface AsrTranscribeInput {
  /** The hosted audio URL (Cloudinary). Only the URL crosses to the ASR box. */
  audioUrl: string;
}

export interface AsrTranscribeResult {
  transcript: string;
  words: WordTiming[];
  /** Detected language (informational; not scored). */
  language?: string;
  /** Audio duration in seconds as reported by the ASR service. */
  durationSeconds?: number;
}

/** Coerce the ASR service's JSON into a validated result, or throw. */
function parseAsrResponse(raw: unknown): AsrTranscribeResult {
  if (typeof raw !== "object" || raw === null) {
    throw new AsrError("ASR service returned an invalid response.");
  }
  const obj = raw as Record<string, unknown>;
  const transcript = typeof obj.transcript === "string" ? obj.transcript : null;
  if (transcript === null) {
    throw new AsrError("ASR service response had no transcript.");
  }
  const rawWords = Array.isArray(obj.words) ? obj.words : [];
  const words: WordTiming[] = [];
  for (const w of rawWords) {
    if (typeof w !== "object" || w === null) continue;
    const ww = w as Record<string, unknown>;
    if (
      typeof ww.word === "string" &&
      typeof ww.start === "number" &&
      typeof ww.end === "number"
    ) {
      words.push({ word: ww.word, start: ww.start, end: ww.end });
    }
  }
  return {
    transcript,
    words,
    language: typeof obj.language === "string" ? obj.language : undefined,
    durationSeconds:
      typeof obj.duration === "number" ? obj.duration : undefined,
  };
}

async function transcribeAgainst(
  url: string,
  headers: Record<string, string>,
  body: string,
): Promise<AsrTranscribeResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.ASR_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${url.replace(/\/$/, "")}/transcribe`, {
      method: "POST",
      headers,
      body,
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new AsrError(
        `Transcription timed out after ${env.ASR_TIMEOUT_MS}ms.`,
        err,
      );
    }
    throw new AsrError("Could not reach the speech service.", err);
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const j = (await res.json()) as { error?: string };
      if (j.error) message = j.error;
    } catch {
      // non-JSON body — keep the HTTP status.
    }
    throw new AsrError(`Speech service error: ${message}`);
  }
  let json: unknown;
  try {
    json = await res.json();
  } catch (err) {
    throw new AsrError("ASR service returned an invalid response.", err);
  }
  return parseAsrResponse(json);
}

/**
 * Transcribe one audio clip. Mock short-circuits (offline demo). Tries the
 * primary URL, then — on ANY AsrError — the fallback once. Throws on failure so
 * the processor can finalize the item as a failed transcription.
 */
export async function asrTranscribe(
  input: AsrTranscribeInput,
): Promise<AsrTranscribeResult> {
  if (env.ASR_MOCK) {
    logger.warn("ASR_MOCK enabled — returning a canned transcript (no network)");
    return {
      transcript: ASR_MOCK_TRANSCRIPT.text,
      words: ASR_MOCK_TRANSCRIPT.words as WordTiming[],
      language: "en",
      durationSeconds:
        ASR_MOCK_TRANSCRIPT.words[ASR_MOCK_TRANSCRIPT.words.length - 1]?.end ??
        0,
    };
  }
  if (!env.ASR_URL) {
    throw new AsrError("Speech is not configured (ASR_URL is unset).");
  }

  const primaryHeaders: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (env.ASR_HEADER_NAME && env.ASR_HEADER_VALUE) {
    primaryHeaders[env.ASR_HEADER_NAME] = env.ASR_HEADER_VALUE;
  }
  const body = JSON.stringify({
    audio_url: input.audioUrl,
    word_timestamps: true,
    vad_filter: true,
  });

  const primary = env.ASR_URL.replace(/\/$/, "");
  const fallback = (env.ASR_FALLBACK_URL ?? "").replace(/\/$/, "");
  const canFallback = fallback.length > 0 && fallback !== primary;

  try {
    return await transcribeAgainst(primary, primaryHeaders, body);
  } catch (primaryErr) {
    if (!canFallback) throw primaryErr;
    logger.warn(
      { endpoint: primary, err: (primaryErr as Error).message },
      "asr: primary endpoint failed — retrying against fallback",
    );
    try {
      return await transcribeAgainst(
        fallback,
        { "Content-Type": "application/json" },
        body,
      );
    } catch (fallbackErr) {
      logger.error(
        { primary, fallback },
        "asr: primary AND fallback endpoints both failed",
      );
      throw fallbackErr;
    }
  }
}
