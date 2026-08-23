/**
 * Company speaking papers, expressed as ORDERED COMPOSITIONS of the generic
 * speaking item types — never hardcoded into the scoring engine. This is the
 * exact Exam→Section→Question idea applied to speech: the engine knows only item
 * types; a "preset" is data that lays them out in order with section labels. The
 * seed script and (later) the authoring UI stamp these into a real
 * SpeakingAssessment; nothing here changes how any item is scored.
 *
 * The four documented papers differ in real ways — Versant 2024 dropped
 * read-aloud and sentence-builds that Accenture's older Versant shape still has,
 * SVAR adds fill-missing-word + error-correct — so each is its own composition.
 * Content below is representative (enough for a runnable demo / click-through);
 * an author swaps in their own items on the same shape.
 */
import { SpeakingItemType } from "./enums.js";

export interface PresetItemSpec {
  readonly itemType: SpeakingItemType;
  /** Grouping label within the paper (e.g. "Section B", "Part A"). */
  readonly section: string;
  readonly referenceText?: string;
  readonly promptText?: string;
  readonly promptAudioUrl?: string;
  readonly stimulusAudioUrl?: string;
  readonly stimulusPlayLimit?: number;
  readonly answerSet?: readonly string[];
  readonly missingWord?: string;
  readonly keyFacts?: readonly string[];
  readonly prepSeconds?: number;
  readonly responseWindowSeconds?: number;
}

export interface SpeakingPreset {
  readonly key: string;
  readonly name: string;
  readonly description: string;
  readonly items: readonly PresetItemSpec[];
}

// The Norway road-tunnel retell (facts from the source passage) — reused as the
// canonical story_retell demo across presets that include a retell.
const NORWAY_TUNNEL_FACTS = [
  "24.5 km long",
  "took 5 years to build",
  "has 4 caves",
  "about 20 minutes to drive through",
] as const;

/**
 * CTS / Cognizant. Section A = reading + listening item mix; Section B =
 * speaking topics (open_topic). Sections C (grammar MCQ) and D (comprehension)
 * are already built as Exams with an audio stimulus — they are composed as an
 * exam, NOT as speaking items, so they are intentionally absent here.
 */
const CTS: SpeakingPreset = {
  key: "cts",
  name: "CTS / Cognizant — Communication (Sections A & B)",
  description:
    "Section A reading+listening item mix, Section B speaking topics. Grammar (C) and comprehension (D) are composed as an audio-stimulus Exam.",
  items: [
    {
      itemType: SpeakingItemType.READ_ALOUD,
      section: "Section A — Reading & Listening",
      referenceText:
        "The river winds slowly past the old stone bridge and into the valley.",
      promptText: "Read the sentence on screen aloud, clearly and at a natural pace.",
      responseWindowSeconds: 30,
    },
    {
      itemType: SpeakingItemType.REPEAT,
      section: "Section A — Reading & Listening",
      referenceText: "She left her umbrella on the train this morning.",
      promptText: "Listen, then say the sentence back exactly.",
      responseWindowSeconds: 20,
    },
    {
      itemType: SpeakingItemType.SHORT_ANSWER,
      section: "Section A — Reading & Listening",
      promptText: "Would you get water from a bottle or a newspaper?",
      answerSet: ["a bottle", "bottle", "the bottle"],
      responseWindowSeconds: 15,
    },
    {
      itemType: SpeakingItemType.SHORT_ANSWER,
      section: "Section A — Reading & Listening",
      promptText: "How many legs does a typical chair have?",
      answerSet: ["four", "4"],
      responseWindowSeconds: 15,
    },
    {
      itemType: SpeakingItemType.SENTENCE_BUILD,
      section: "Section A — Reading & Listening",
      referenceText: "My mother was reading her favorite magazine.",
      promptText:
        "You will hear three parts of a sentence. Say the whole sentence in the correct order.",
      responseWindowSeconds: 25,
    },
    {
      itemType: SpeakingItemType.CONVERSATION,
      section: "Section A — Reading & Listening",
      promptText:
        "Listen to the short conversation, then answer: where are they planning to meet?",
      stimulusAudioUrl: "",
      answerSet: ["at the library", "the library", "library"],
      responseWindowSeconds: 20,
    },
    {
      itemType: SpeakingItemType.PASSAGE_QUESTION,
      section: "Section A — Reading & Listening",
      promptText:
        "Listen to the passage, then answer: what did the shop run out of?",
      stimulusAudioUrl: "",
      stimulusPlayLimit: 1,
      answerSet: ["bread", "the bread"],
      responseWindowSeconds: 20,
    },
    {
      itemType: SpeakingItemType.FILL_MISSING_WORD,
      section: "Section A — Reading & Listening",
      referenceText: "The meeting has been moved to Friday afternoon.",
      missingWord: "moved",
      promptText:
        "You will hear a sentence with one word missing. Say the complete sentence.",
      responseWindowSeconds: 20,
    },
    {
      itemType: SpeakingItemType.ERROR_CORRECT,
      section: "Section A — Reading & Listening",
      referenceText: "She goes to work by train every day.",
      promptText:
        "The sentence you hear has one grammar mistake. Say it corrected.",
      responseWindowSeconds: 20,
    },
    {
      itemType: SpeakingItemType.STORY_RETELL,
      section: "Section A — Reading & Listening",
      promptText:
        "Listen to the story about the Norway road tunnel, then retell it in your own words (30 seconds).",
      stimulusAudioUrl: "",
      keyFacts: [...NORWAY_TUNNEL_FACTS],
      responseWindowSeconds: 30,
    },
    {
      itemType: SpeakingItemType.OPEN_TOPIC,
      section: "Section B — Speaking",
      promptText: "Talk about healthy eating. You have 90 seconds to prepare and 60 seconds to speak.",
      prepSeconds: 90,
      responseWindowSeconds: 60,
    },
    {
      itemType: SpeakingItemType.OPEN_TOPIC,
      section: "Section B — Speaking",
      promptText: "Talk about the role of sport in society.",
      prepSeconds: 90,
      responseWindowSeconds: 60,
    },
    {
      itemType: SpeakingItemType.OPEN_TOPIC,
      section: "Section B — Speaking",
      promptText:
        "Talk about the most useful thing you learned from your family.",
      prepSeconds: 90,
      responseWindowSeconds: 60,
    },
  ],
};

/**
 * Accenture — the older 8-section Versant shape. Includes read-aloud and jumbled
 * (sentence_build) which the current Versant test has since removed. Pass = 50%,
 * distinction at 60% (thresholds applied by the reporter, not stored here).
 */
const ACCENTURE: SpeakingPreset = {
  key: "accenture",
  name: "Accenture — Versant-style (8 parts)",
  description:
    "Read aloud, listen & repeat, short answer, jumbled sentence, story retelling (3), verb-form questions, conversation, passage comprehension.",
  items: [
    {
      itemType: SpeakingItemType.READ_ALOUD,
      section: "A — Read aloud",
      referenceText: "The train to the coast leaves from platform nine at noon.",
      responseWindowSeconds: 30,
    },
    {
      itemType: SpeakingItemType.REPEAT,
      section: "B — Listen & repeat",
      referenceText: "The report is due before the end of the week.",
      responseWindowSeconds: 20,
    },
    {
      itemType: SpeakingItemType.SHORT_ANSWER,
      section: "C — Short answer",
      promptText: "Is milk a solid or a liquid?",
      answerSet: ["a liquid", "liquid"],
      responseWindowSeconds: 15,
    },
    {
      itemType: SpeakingItemType.SENTENCE_BUILD,
      section: "D — Jumbled sentence",
      referenceText: "The children played in the park after school.",
      responseWindowSeconds: 25,
    },
    {
      itemType: SpeakingItemType.STORY_RETELL,
      section: "E — Story retelling",
      promptText: "Retell the story you just heard (30 seconds).",
      keyFacts: [...NORWAY_TUNNEL_FACTS],
      responseWindowSeconds: 30,
    },
    {
      itemType: SpeakingItemType.SHORT_ANSWER,
      section: "F — Verb-form questions",
      promptText:
        "Complete: Yesterday she ___ to the market. (walk) — say the full sentence.",
      answerSet: ["walked", "she walked", "yesterday she walked to the market"],
      responseWindowSeconds: 15,
    },
    {
      itemType: SpeakingItemType.CONVERSATION,
      section: "G — Conversation",
      promptText: "Listen, then answer: what time does the film start?",
      answerSet: ["eight", "8", "eight o'clock", "at eight"],
      responseWindowSeconds: 20,
    },
    {
      itemType: SpeakingItemType.PASSAGE_QUESTION,
      section: "H — Passage comprehension",
      promptText: "Listen to the passage, then answer: where did the family go on holiday?",
      answerSet: ["to the mountains", "the mountains", "mountains"],
      responseWindowSeconds: 25,
    },
    {
      itemType: SpeakingItemType.OPEN_TOPIC,
      section: "H — Open question",
      promptText: "Describe a place you would like to visit and why (40 seconds).",
      responseWindowSeconds: 40,
    },
  ],
};

/**
 * Versant 2024 (current Pearson). Deliberately DIFFERENT from Accenture: NO
 * read-aloud, NO sentence-build. A answer-the-question, B repeat, C
 * conversations, D passage questions, E retell, F opinion (+ a non-scored 30s
 * sample, represented as an open_topic labelled "sample").
 */
const VERSANT_2024: SpeakingPreset = {
  key: "versant_2024",
  name: "Versant 2024 (Pearson, current)",
  description:
    "A answer-the-question, B repeat, C conversations, D passage questions, E retell, F opinion, plus a non-scored sample. No read-aloud or sentence-build.",
  items: [
    {
      itemType: SpeakingItemType.SHORT_ANSWER,
      section: "A — Answer the question",
      promptText: "Do you write with a pen or with a spoon?",
      answerSet: ["a pen", "pen", "with a pen"],
      responseWindowSeconds: 15,
    },
    {
      itemType: SpeakingItemType.REPEAT,
      section: "B — Repeat",
      referenceText: "We should leave a little earlier to avoid the traffic.",
      responseWindowSeconds: 20,
    },
    {
      itemType: SpeakingItemType.CONVERSATION,
      section: "C — Conversations",
      promptText: "Listen, then answer: why is the speaker calling?",
      answerSet: ["to cancel", "to cancel the booking", "cancel the booking"],
      responseWindowSeconds: 20,
    },
    {
      itemType: SpeakingItemType.PASSAGE_QUESTION,
      section: "D — Passage questions",
      promptText: "Listen to the passage, then answer: what caused the delay?",
      answerSet: ["the weather", "bad weather", "weather"],
      responseWindowSeconds: 20,
    },
    {
      itemType: SpeakingItemType.STORY_RETELL,
      section: "E — Retell",
      promptText: "Retell the story in your own words (30 seconds).",
      keyFacts: [...NORWAY_TUNNEL_FACTS],
      responseWindowSeconds: 30,
    },
    {
      itemType: SpeakingItemType.OPEN_TOPIC,
      section: "F — Opinion",
      promptText:
        "Some people prefer to work in a team; others prefer to work alone. Which do you prefer, and why? (40 seconds)",
      responseWindowSeconds: 40,
    },
    {
      itemType: SpeakingItemType.OPEN_TOPIC,
      section: "Sample — not scored",
      promptText:
        "Warm-up sample (not scored): say a few sentences about your day.",
      responseWindowSeconds: 30,
    },
  ],
};

/**
 * SVAR (IBM / Capgemini / Wipro). Adds fill_missing_word + error_correct and a
 * situational item — role_play is DEFERRED (see the Step-12 report), so the
 * situational slot is represented by an open_topic prompt for now.
 */
const SVAR: SpeakingPreset = {
  key: "svar",
  name: "SVAR (IBM / Capgemini / Wipro)",
  description:
    "Listening+response, situational, read aloud, listen&repeat, fill-missing-word, error-correct, spoken topic with prep.",
  items: [
    {
      itemType: SpeakingItemType.PASSAGE_QUESTION,
      section: "Listening & response",
      promptText: "Listen to the announcement, then answer: which gate has changed?",
      answerSet: ["gate twelve", "gate 12", "twelve", "12"],
      responseWindowSeconds: 20,
    },
    {
      itemType: SpeakingItemType.OPEN_TOPIC,
      section: "Situational (role-play deferred)",
      promptText:
        "A customer is unhappy their order arrived late. Respond politely and offer a solution (40 seconds).",
      responseWindowSeconds: 40,
    },
    {
      itemType: SpeakingItemType.READ_ALOUD,
      section: "Read aloud",
      referenceText:
        "Please confirm your booking reference before you arrive at the desk.",
      responseWindowSeconds: 30,
    },
    {
      itemType: SpeakingItemType.REPEAT,
      section: "Listen & repeat",
      referenceText: "The technician will call you back within the hour.",
      responseWindowSeconds: 20,
    },
    {
      itemType: SpeakingItemType.FILL_MISSING_WORD,
      section: "Fill the missing word",
      referenceText: "You can pay online or at the counter.",
      missingWord: "online",
      promptText: "Say the complete sentence with the missing word.",
      responseWindowSeconds: 20,
    },
    {
      itemType: SpeakingItemType.ERROR_CORRECT,
      section: "Error correction",
      referenceText: "He has worked here since last year.",
      promptText: "Say the sentence corrected.",
      responseWindowSeconds: 20,
    },
    {
      itemType: SpeakingItemType.OPEN_TOPIC,
      section: "Spoken topic",
      promptText:
        "Talk about how technology has changed the way we communicate (60 seconds). You have time to prepare.",
      prepSeconds: 30,
      responseWindowSeconds: 60,
    },
  ],
};

export const SPEAKING_PRESETS: Readonly<Record<string, SpeakingPreset>> = {
  cts: CTS,
  accenture: ACCENTURE,
  versant_2024: VERSANT_2024,
  svar: SVAR,
};

export const SPEAKING_PRESET_KEYS = Object.keys(SPEAKING_PRESETS);

/**
 * Materialize a preset into the ordered item shape a SpeakingAssessment stores.
 * Pure — a data transform, no engine coupling. Fields absent from a spec fall to
 * the same defaults the authoring schema uses, so the result is directly usable
 * by the seed / authoring flow. Returns [] for an unknown key.
 */
export function buildItemsFromPreset(key: string): PresetItemSpec[] {
  const preset = SPEAKING_PRESETS[key];
  return preset ? preset.items.map((it) => ({ ...it })) : [];
}
