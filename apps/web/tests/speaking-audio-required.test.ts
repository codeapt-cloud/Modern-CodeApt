/**
 * Step 27 — the "needs audio to answer" classification is ONE shared source of
 * truth used by the runner (via the server-computed view flag), the publish
 * guard, and the seed. This pins the type-level set AND the instance-level rule
 * that makes sentence_build listen-based ONLY when it has scrambled chunks.
 */
import {
  SpeakingItemType,
  speakingItemNeedsAudio,
  speakingItemRequiresAudio,
} from "@codeapt/shared";
import { describe, expect, it } from "vitest";

const ALWAYS_LISTEN = [
  "repeat",
  "short_answer",
  "conversation",
  "passage_question",
  "fill_missing_word",
  "error_correct",
  "story_retell",
  "dictation",
];

describe("speaking audio-required classification", () => {
  it("the eight always-listen types require audio (type-level)", () => {
    for (const t of ALWAYS_LISTEN) {
      expect(speakingItemRequiresAudio(t)).toBe(true);
      expect(speakingItemNeedsAudio({ itemType: t })).toBe(true);
    }
  });

  it("read_aloud / open_topic never require audio", () => {
    for (const t of [SpeakingItemType.READ_ALOUD, SpeakingItemType.OPEN_TOPIC]) {
      expect(speakingItemRequiresAudio(t)).toBe(false);
      expect(speakingItemNeedsAudio({ itemType: t })).toBe(false);
    }
  });

  it("sentence_build needs audio ONLY when it has chunks to speak", () => {
    // Type-level: never in the always-set (its need is content-dependent).
    expect(speakingItemRequiresAudio(SpeakingItemType.SENTENCE_BUILD)).toBe(false);
    // Instance-level: chunks present → needs audio; none → does not.
    expect(
      speakingItemNeedsAudio({
        itemType: SpeakingItemType.SENTENCE_BUILD,
        chunks: ["was reading", "my mother", "her favorite magazine"],
      }),
    ).toBe(true);
    expect(
      speakingItemNeedsAudio({ itemType: SpeakingItemType.SENTENCE_BUILD, chunks: [] }),
    ).toBe(false);
    expect(
      speakingItemNeedsAudio({ itemType: SpeakingItemType.SENTENCE_BUILD }),
    ).toBe(false);
  });
});
