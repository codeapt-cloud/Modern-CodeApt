/**
 * ASR-TTS client (Step 19) — the API's thin HTTP wrapper over the faster-whisper
 * container's /synthesize route (Piper), used at AUTHORING time to render a
 * prompt's TEXT to a FIXED-voice WAV. Mirrors the worker's asr.ts convention: a
 * config-driven URL, an AbortController timeout, and every failure surfaced as a
 * thrown typed error. Runs SERVER-SIDE deliberately — never the browser
 * SpeechSynthesis API, whose voice differs per device (two students would then
 * sit different listening tests, and a disputed result would have no fixed
 * artifact). The voice id + version come back in headers so the caller can PIN
 * them on the item; a later regenerate can never silently change the sound.
 */
import { env } from "../config/env.js";

export class TtsError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "TtsError";
  }
}

export interface SynthesizedPrompt {
  /** The rendered WAV bytes (uploaded to Cloudinary by the caller). */
  bytes: Uint8Array;
  /** The FIXED voice + version, echoed from the ASR service, to pin on the item. */
  voiceId: string;
  voiceVersion: string;
}

/**
 * A tiny valid WAV (44-byte header + a few silent samples) for TTS_MOCK / tests,
 * so the authoring flow is exercisable with no Piper container. NOT real speech.
 */
export function cannedSilentWav(): Uint8Array {
  const samples = 16; // a handful of silent 16-bit mono samples
  const dataLen = samples * 2;
  const buf = new ArrayBuffer(44 + dataLen);
  const dv = new DataView(buf);
  const ascii = (off: number, s: string): void => {
    for (let i = 0; i < s.length; i += 1) dv.setUint8(off + i, s.charCodeAt(i));
  };
  ascii(0, "RIFF");
  dv.setUint32(4, 36 + dataLen, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  dv.setUint32(16, 16, true); // PCM chunk size
  dv.setUint16(20, 1, true); // PCM
  dv.setUint16(22, 1, true); // mono
  dv.setUint32(24, 22050, true); // sample rate
  dv.setUint32(28, 22050 * 2, true); // byte rate
  dv.setUint16(32, 2, true); // block align
  dv.setUint16(34, 16, true); // bits per sample
  ascii(36, "data");
  dv.setUint32(40, dataLen, true);
  return new Uint8Array(buf);
}

export const TTS_MOCK_VOICE = {
  voiceId: "mock-voice",
  voiceVersion: "mock-0",
} as const;

export async function synthesizePrompt(text: string): Promise<SynthesizedPrompt> {
  if (env.TTS_MOCK) {
    return {
      bytes: cannedSilentWav(),
      voiceId: TTS_MOCK_VOICE.voiceId,
      voiceVersion: TTS_MOCK_VOICE.voiceVersion,
    };
  }
  if (!env.ASR_URL) {
    throw new TtsError("TTS is not configured (ASR_URL is unset).");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.ASR_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${env.ASR_URL.replace(/\/$/, "")}/synthesize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new TtsError(`TTS timed out after ${env.ASR_TIMEOUT_MS}ms.`, err);
    }
    throw new TtsError("Could not reach the speech service.", err);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const j = (await res.json()) as { detail?: string };
      if (j.detail) message = j.detail;
    } catch {
      /* non-JSON body — keep the status */
    }
    throw new TtsError(`Speech service error: ${message}`);
  }
  const voiceId = res.headers.get("x-voice-id");
  const voiceVersion = res.headers.get("x-voice-version");
  if (!voiceId || !voiceVersion) {
    throw new TtsError("TTS response did not pin a voice id/version.");
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength === 0) {
    throw new TtsError("TTS returned empty audio.");
  }
  return { bytes, voiceId, voiceVersion };
}
