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
  speakingPromptAudioText,
  speakingStimulusAudioText,
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

describe("speakingPromptAudioText — the prompt clip speaks the prompt, never the reference", () => {
  it("speaks the on-screen prompt / instruction for every type", () => {
    // short_answer: the prompt IS the question.
    expect(
      speakingPromptAudioText({
        itemType: SpeakingItemType.SHORT_ANSWER,
        promptText: "Is milk a solid or a liquid?",
      }),
    ).toBe("Is milk a solid or a liquid?");
    // fill_missing_word / error_correct: the prompt is spoken; the reference is
    // the withheld answer and is not even accepted by the helper any more.
    expect(
      speakingPromptAudioText({
        itemType: SpeakingItemType.FILL_MISSING_WORD,
        promptText: "You will hear a sentence with one word missing. Say the complete sentence.",
      }),
    ).toBe("You will hear a sentence with one word missing. Say the complete sentence.");
  });

  it("sentence_build is the sole exception — it speaks its scrambled chunks", () => {
    expect(
      speakingPromptAudioText({
        itemType: SpeakingItemType.SENTENCE_BUILD,
        chunks: ["was reading", "my mother", "her favorite magazine"],
      }),
    ).toBe("was reading. my mother. her favorite magazine");
  });

  it("returns empty when there is nothing to speak yet (Generate stays disabled)", () => {
    expect(speakingPromptAudioText({ itemType: SpeakingItemType.REPEAT })).toBe("");
    expect(
      speakingPromptAudioText({ itemType: SpeakingItemType.SENTENCE_BUILD, chunks: [] }),
    ).toBe("");
  });
});

describe("speakingStimulusAudioText — the hidden heard clip", () => {
  it("voices the authored stimulus text, trimmed; empty when none", () => {
    expect(
      speakingStimulusAudioText({ stimulusText: "  She left her umbrella on the train.  " }),
    ).toBe("She left her umbrella on the train.");
    expect(speakingStimulusAudioText({})).toBe("");
    expect(speakingStimulusAudioText({ stimulusText: "   " })).toBe("");
  });
});
