/**
 * Step 34 A2 — pure tests for interviewer-voice selection. Deterministic pick from
 * a preferred list with sane fallbacks across the wildly-varying platform voice
 * lists; stable within a session (the runner picks once).
 */
import { describe, expect, it } from "vitest";

import { pickVoice, type VoiceLike } from "../src/lib/interview-voice.js";

const v = (name: string, lang: string, extra: Partial<VoiceLike> = {}): VoiceLike => ({
  name,
  lang,
  ...extra,
});

describe("pickVoice", () => {
  it("prefers a natural English voice from the preferred list (substring, case-insensitive)", () => {
    const voices = [
      v("Microsoft David - English (United States)", "en-US"),
      v("Microsoft Aria Online (Natural) - English (United States)", "en-US"),
      v("Google UK English Female", "en-GB"),
    ];
    // "Google UK English Female" is first in PREFERRED_VOICES → wins over Aria.
    expect(pickVoice(voices)?.name).toBe("Google UK English Female");
  });

  it("falls back to an en-US/en-GB voice when no preferred name matches", () => {
    const voices = [v("Zarvox", "en-US"), v("Français", "fr-FR")];
    expect(pickVoice(voices)?.name).toBe("Zarvox");
  });

  it("falls back to any English voice, then the default, then the first", () => {
    expect(pickVoice([v("Fred", "en-AU")])?.name).toBe("Fred");
    expect(pickVoice([v("Xy", "de-DE"), v("Zz", "it-IT", { default: true })])?.name).toBe("Zz");
    expect(pickVoice([v("Only", "ja-JP")])?.name).toBe("Only");
  });

  it("returns null only when there are no voices at all", () => {
    expect(pickVoice([])).toBeNull();
  });

  it("is deterministic — same input, same pick (stable within a session)", () => {
    const voices = [v("Samantha", "en-US"), v("Google US English", "en-US")];
    expect(pickVoice(voices)?.name).toBe(pickVoice(voices)?.name);
  });
});
