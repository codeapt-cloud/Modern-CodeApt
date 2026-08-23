/**
 * Pure speech scoring engine (Communication Sections A/B). No I/O, no DOM, no
 * randomness — every function is a deterministic function of its inputs, so the
 * whole engine unit-tests without a running ASR service, exactly like the essay
 * and email engines. The worker does the I/O (record → upload → transcribe) and
 * hands the transcript + word timings to these functions.
 *
 * Step 10 scored ONE item type (READ ALOUD); Step 12 adds the rest of the
 * Communication item types on the same honest, deterministic footing:
 *   - Reference-known SPOKEN (repeat / sentence_build / error_correct /
 *     fill_missing_word, and the answer-set match for short_answer /
 *     conversation / passage_question) reuse the phonetic-tolerant WER below.
 *   - DICTATION is TYPED — the same alignment with phonetic tolerance OFF.
 *   - LLM-judged HYBRID (story_retell / open_topic) each expose a COMPLETE
 *     deterministic floor (out of the full 100) plus an optional AI blend.
 * Two honest, deterministic dimensions underpin all of it:
 *   - Word accuracy: word-level WER against the known reference, plus the exact
 *     missed / mis-said / extra words (from the alignment backtrace).
 *   - Fluency: speech rate, pauses, and filler rate, all derived from Whisper's
 *     word-level timestamps.
 * There is deliberately NO pronunciation or clarity score: Whisper returns
 * words, not phonemes, so a pronunciation number is not honestly derivable from
 * it (see the module docs). accent/clarity is not scored anywhere.
 *
 * Word comparison is PHONETIC-TOLERANT (see ./phonetics.ts): a pair counts as
 * correct if it matches exactly OR phonetically, so the student is NOT penalised
 * for Whisper writing a homophone ("right"→"write") when their articulation was
 * correct. This removes false NEGATIVES; it does not invent tolerance for poor
 * reading — vowel distinctions ("ten"/"tin", "bed"/"bad") and distinct
 * consonants ("ride"/"right") still score as errors, because a read-aloud test
 * legitimately checks them. The result reports THREE categories (exact /
 * phonetic / error) so an operator can see what the tolerance did.
 */
import { phoneticMatch } from "./phonetics.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** One transcribed word with start/end offsets in seconds (Whisper word ts). */
export interface WordTiming {
  readonly word: string;
  readonly start: number;
  readonly end: number;
}

/** A word the speaker was expected to say but didn't (or said as something else). */
export interface MisspokenWord {
  readonly expected: string;
  readonly heard: string;
}

export interface WordAccuracyResult {
  readonly referenceWordCount: number;
  readonly hypothesisWordCount: number;
  /** Reference words transcribed identically. */
  readonly exactMatches: number;
  /**
   * Reference words that were NOT identical but matched PHONETICALLY (Whisper's
   * homophone spelling — "right" transcribed as "write"). Counted as correct,
   * NOT as errors. Kept as {expected, heard} pairs so an operator can audit what
   * the phonetic tolerance did; the student view collapses these into "correct".
   */
  readonly phoneticMatches: readonly MisspokenWord[];
  /** GENUINE substitutions — a real, phonetically-distinct misreading. */
  readonly substitutions: number;
  readonly deletions: number;
  readonly insertions: number;
  /**
   * Word Error Rate = (genuineSubstitutions + D + I) / referenceWordCount.
   * Phonetic matches are NOT errors, so they do not raise the WER. Can exceed 1.
   */
  readonly wer: number;
  /** 0..100 = clamp(1 - WER) * 100. The student-facing "word accuracy". */
  readonly wordAccuracy: number;
  /** Reference words that were not said (deletions). */
  readonly missedWords: readonly string[];
  /** Reference words genuinely mis-read (substitutions; NOT phonetic matches). */
  readonly missaidWords: readonly MisspokenWord[];
  /** Extra words in the transcript with no reference counterpart (insertions). */
  readonly extraWords: readonly string[];
}

export interface FluencyResult {
  readonly wordCount: number;
  /** Span from the first word's start to the last word's end, in seconds. */
  readonly durationSeconds: number;
  /** Words per second across the spoken span (0 when <2 words / no duration). */
  readonly speechRate: number;
  /** Gaps between consecutive words longer than the pause threshold. */
  readonly pauseCount: number;
  readonly longestPauseSeconds: number;
  readonly fillerCount: number;
  /** fillerCount / wordCount (0..1); 0 when there are no words. */
  readonly fillerRate: number;
}

export interface ReadAloudScore {
  readonly wordAccuracy: number;
  readonly wer: number;
  /** Count of exactly-matched reference words (operator detail). */
  readonly exactMatches: number;
  /** Homophone spellings accepted as correct (operator detail). */
  readonly phoneticMatches: readonly MisspokenWord[];
  readonly missedWords: readonly string[];
  readonly missaidWords: readonly MisspokenWord[];
  readonly extraWords: readonly string[];
  readonly fluency: FluencyResult;
}

// ---------------------------------------------------------------------------
// Constants (tunable; exported so tests + UI agree on the thresholds)
// ---------------------------------------------------------------------------

/** A silence longer than this (seconds) between two words counts as a pause. */
export const PAUSE_THRESHOLD_SECONDS = 0.5;

/**
 * Canned transcript + word timings for ASR_MOCK (offline demo only — the worker
 * returns this when no ASR container is reachable, so the whole speech pipeline
 * can be exercised without a GPU/CPU box). NEVER used in production.
 */
export const ASR_MOCK_TRANSCRIPT: {
  readonly text: string;
  readonly words: readonly WordTiming[];
} = {
  text: "the quick brown fox jumps over the lazy dog",
  words: [
    { word: "the", start: 0.0, end: 0.3 },
    { word: "quick", start: 0.35, end: 0.7 },
    { word: "brown", start: 0.75, end: 1.1 },
    { word: "fox", start: 1.15, end: 1.5 },
    { word: "jumps", start: 1.6, end: 2.0 },
    { word: "over", start: 2.05, end: 2.4 },
    { word: "the", start: 2.45, end: 2.6 },
    { word: "lazy", start: 2.65, end: 3.0 },
    { word: "dog", start: 3.05, end: 3.4 },
  ],
};

/** Filler words counted toward the filler rate (small, deliberately common). */
export const FILLER_WORDS: ReadonlySet<string> = new Set([
  "um",
  "uh",
  "erm",
  "er",
  "ah",
  "hmm",
  "mm",
  "like",
  "basically",
  "actually",
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const clamp = (n: number, lo = 0, hi = 100): number =>
  Math.min(hi, Math.max(lo, n));

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Normalize free text into comparable lowercase word tokens: strip everything
 * but letters/digits/apostrophes, collapse whitespace. Used on both the
 * reference and the transcript so WER compares content, not punctuation/case.
 */
export function normalizeWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}'\s]/gu, " ")
    .split(/\s+/)
    .map((w) => w.trim())
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// Word accuracy (word-level WER via Levenshtein alignment + backtrace)
// ---------------------------------------------------------------------------

/**
 * Word Error Rate between a reference and a hypothesis, with the specific
 * missed / mis-said / extra words recovered from the edit-distance backtrace.
 *
 * Honest edge cases:
 *   - empty hypothesis → every reference word is a deletion → WER 1, accuracy 0.
 *   - empty reference, empty hypothesis → nothing said, nothing expected →
 *     accuracy 100 (a vacuously perfect match).
 *   - empty reference, non-empty hypothesis → accuracy 0 (all insertions; WER
 *     is undefined over N=0 so it is reported as the insertion count).
 */
export function wordErrorRate(
  reference: string,
  hypothesis: string,
): WordAccuracyResult {
  // Reference-known SPOKEN comparison → phonetic tolerance ON.
  return computeWordAccuracy(reference, hypothesis, true);
}

/**
 * Word accuracy for DICTATION — the student TYPES the sentence, so there is no
 * ASR and no homophone-spelling problem to forgive: a typed "write" for "right"
 * is a genuine spelling error, not a transcription artefact. Phonetic tolerance
 * is therefore DELIBERATELY OFF here (allowPhonetic=false). This is the concrete
 * enforcement of the phonetics SCOPE rule: tolerance is a transcription concern,
 * and dictation has no transcription step.
 */
export function dictationAccuracy(
  reference: string,
  typed: string,
): WordAccuracyResult {
  return computeWordAccuracy(reference, typed, false);
}

/**
 * The shared word-alignment core. `allowPhonetic` decides whether a homophone
 * pair costs 0 (spoken items, where Whisper's spelling is not the student's
 * error) or 1 (typed dictation, where a homophone IS the student's error). This
 * is the ONLY place phoneticMatch may be reached from a scorer, and only when
 * allowPhonetic is true — see the SCOPE comment in phonetics.ts.
 */
function computeWordAccuracy(
  reference: string,
  hypothesis: string,
  allowPhonetic: boolean,
): WordAccuracyResult {
  const ref = normalizeWords(reference);
  const hyp = normalizeWords(hypothesis);
  const n = ref.length;
  const m = hyp.length;

  if (n === 0) {
    return {
      referenceWordCount: 0,
      hypothesisWordCount: m,
      exactMatches: 0,
      phoneticMatches: [],
      substitutions: 0,
      deletions: 0,
      insertions: m,
      wer: m === 0 ? 0 : m,
      wordAccuracy: m === 0 ? 100 : 0,
      missedWords: [],
      missaidWords: [],
      extraWords: hyp,
    };
  }

  // A pair is "aligned" (edit cost 0) when exact OR (for spoken items only)
  // phonetically equivalent. Typed dictation passes allowPhonetic=false, so only
  // an exact match costs 0 and a homophone is scored as a substitution.
  const aligned = (a: string, b: string): boolean =>
    a === b || (allowPhonetic && phoneticMatch(a, b));

  // DP edit-distance table (n+1 x m+1). d[i][j] = cost to turn ref[:i] → hyp[:j].
  const d: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  );
  for (let i = 0; i <= n; i++) d[i]![0] = i;
  for (let j = 0; j <= m; j++) d[0]![j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const cost = aligned(ref[i - 1]!, hyp[j - 1]!) ? 0 : 1;
      d[i]![j] = Math.min(
        d[i - 1]![j]! + 1, // deletion (ref word not said)
        d[i]![j - 1]! + 1, // insertion (extra hyp word)
        d[i - 1]![j - 1]! + cost, // (exact/phonetic) match or substitution
      );
    }
  }

  // Backtrace, preferring diagonal on ties so matches/subs are counted first.
  let i = n;
  let j = m;
  let exactMatches = 0;
  let substitutions = 0;
  let deletions = 0;
  let insertions = 0;
  const phoneticMatches: MisspokenWord[] = [];
  const missedWords: string[] = [];
  const missaidWords: MisspokenWord[] = [];
  const extraWords: string[] = [];
  while (i > 0 || j > 0) {
    const cur = d[i]![j]!;
    if (i > 0 && j > 0) {
      const r = ref[i - 1]!;
      const h = hyp[j - 1]!;
      const cost = aligned(r, h) ? 0 : 1;
      if (cur === d[i - 1]![j - 1]! + cost) {
        if (cost === 0) {
          // Category split: identical vs a phonetic (homophone) match.
          if (r === h) exactMatches++;
          else phoneticMatches.push({ expected: r, heard: h });
        } else {
          substitutions++;
          missaidWords.push({ expected: r, heard: h });
        }
        i--;
        j--;
        continue;
      }
    }
    if (i > 0 && cur === d[i - 1]![j]! + 1) {
      deletions++;
      missedWords.push(ref[i - 1]!);
      i--;
      continue;
    }
    // j > 0 insertion.
    insertions++;
    extraWords.push(hyp[j - 1]!);
    j--;
  }
  phoneticMatches.reverse();
  missedWords.reverse();
  missaidWords.reverse();
  extraWords.reverse();

  // Phonetic matches are correct → only genuine substitutions count as errors.
  const wer = (substitutions + deletions + insertions) / n;
  return {
    referenceWordCount: n,
    hypothesisWordCount: m,
    exactMatches,
    phoneticMatches,
    substitutions,
    deletions,
    insertions,
    wer: round2(wer),
    wordAccuracy: round2(clamp((1 - wer) * 100)),
    missedWords,
    missaidWords,
    extraWords,
  };
}

// ---------------------------------------------------------------------------
// Fluency (from word timestamps)
// ---------------------------------------------------------------------------

/**
 * Fluency metrics from word-level timestamps. Pure and defensive: fewer than
 * two words (no measurable span) yields a 0 rate rather than NaN/Infinity, and
 * an empty list yields all-zeros (an honest "nothing to measure").
 */
export function fluencyMetrics(
  timings: readonly WordTiming[],
  opts: { pauseThresholdSeconds?: number } = {},
): FluencyResult {
  const threshold = opts.pauseThresholdSeconds ?? PAUSE_THRESHOLD_SECONDS;
  const wordCount = timings.length;
  if (wordCount === 0) {
    return {
      wordCount: 0,
      durationSeconds: 0,
      speechRate: 0,
      pauseCount: 0,
      longestPauseSeconds: 0,
      fillerCount: 0,
      fillerRate: 0,
    };
  }

  const first = timings[0]!;
  const last = timings[wordCount - 1]!;
  const durationSeconds = Math.max(0, last.end - first.start);
  // Rate is a pace ACROSS words: it needs at least two words and a positive
  // span. A single word (or a zero span) has no measurable pace → 0, never a
  // misleading number from one word's own tiny duration.
  const speechRate =
    wordCount >= 2 && durationSeconds > 0
      ? round2(wordCount / durationSeconds)
      : 0;

  let pauseCount = 0;
  let longestPause = 0;
  for (let k = 1; k < wordCount; k++) {
    const gap = timings[k]!.start - timings[k - 1]!.end;
    if (gap > threshold) pauseCount++;
    if (gap > longestPause) longestPause = gap;
  }

  const fillerCount = timings.filter((t) =>
    FILLER_WORDS.has(t.word.toLowerCase().replace(/[^\p{L}']/gu, "")),
  ).length;

  return {
    wordCount,
    durationSeconds: round2(durationSeconds),
    speechRate,
    pauseCount,
    longestPauseSeconds: round2(Math.max(0, longestPause)),
    fillerCount,
    fillerRate: round2(fillerCount / wordCount),
  };
}

// ---------------------------------------------------------------------------
// Read-aloud: the composite score for the one Step-10 item type
// ---------------------------------------------------------------------------

/**
 * Score a read-aloud attempt: word accuracy against the reference text + fluency
 * from the word timings. Pure — reference + transcript + timings in, scores out.
 * No pronunciation/clarity dimension (not derivable from Whisper output).
 */
export function scoreReadAloud(
  referenceText: string,
  transcript: string,
  wordTimings: readonly WordTiming[],
): ReadAloudScore {
  const acc = wordErrorRate(referenceText, transcript);
  return {
    wordAccuracy: acc.wordAccuracy,
    wer: acc.wer,
    exactMatches: acc.exactMatches,
    phoneticMatches: acc.phoneticMatches,
    missedWords: acc.missedWords,
    missaidWords: acc.missaidWords,
    extraWords: acc.extraWords,
    fluency: fluencyMetrics(wordTimings),
  };
}

// ===========================================================================
// Step 12 — the remaining Communication item types.
//
// Three scoring families:
//   1. Reference-known SPOKEN, reuse the phonetic-tolerant WER above
//      (repeat / sentence_build / error_correct / fill_missing_word — and the
//      answer-set match for short_answer / conversation / passage_question).
//   2. TYPED (dictation) — same WER machinery but phonetic tolerance OFF.
//   3. LLM-judged HYBRID (story_retell / open_topic) — a complete, honest
//      DETERMINISTIC FLOOR (out of the full 100) plus an optional AI blend. The
//      floor is never phonetic (the hard constraint keeps phonetics out of the
//      LLM-judged items); story_retell paraphrase tolerance comes from keyword
//      overlap + number-word normalization instead.
// ===========================================================================

/** Whether a hybrid item's total is the deterministic floor alone or AI-blended. */
export type SpeechScoreSource = "deterministic_floor" | "ai_hybrid";

/**
 * Fraction of a hybrid item's total that the AI judgement contributes when it
 * IS available. Deliberately minority weights: most of the score stays on the
 * checkable deterministic signal (fact coverage / fluency), so the AI can refine
 * but never dominate — and when the AI is down, dropping its share leaves a
 * complete score, not a hole. Mirrors ESSAY_AI_BLEND.
 */
export const STORY_RETELL_AI_BLEND = 0.4; // coverage-dominant
export const OPEN_TOPIC_AI_BLEND = 0.5;

/** A fact counts as covered when at least this fraction of its salient tokens
 *  appear in the retell — < 1 so a paraphrase that drops a word still counts. */
export const FACT_COVERAGE_TOKEN_RATIO = 0.6;

// ---------------------------------------------------------------------------
// Answer-set matching (short_answer / conversation / passage_question)
// ---------------------------------------------------------------------------

export interface AnswerMatchResult {
  readonly kind: "answer_set";
  /** True when the transcript satisfies at least one acceptable answer. */
  readonly matched: boolean;
  /** The acceptable answer that matched (as authored), or null. */
  readonly matchedAnswer: string | null;
  /** 100 when matched, else 0 — a short answer is right or it isn't. */
  readonly score: number;
  readonly transcript: string;
  readonly acceptableAnswers: readonly string[];
}

/** Articles that carry no answer content ("a bottle" answers "bottle"). */
const ANSWER_STOPWORDS: ReadonlySet<string> = new Set(["a", "an", "the"]);

/**
 * Does the transcript contain every CONTENT token of `answer`, in order, as a
 * (not necessarily contiguous) subsequence — comparing tokens phonetically so
 * "four" is accepted for a transcript Whisper wrote as "for"? Articles are
 * dropped from the answer so "a bottle" matches "the bottle" / "bottle please".
 * Reference-known spoken item → phonetic tolerance is in-scope here.
 */
function transcriptSatisfiesAnswer(
  transcriptTokens: readonly string[],
  answer: string,
): boolean {
  const needed = normalizeWords(answer).filter((t) => !ANSWER_STOPWORDS.has(t));
  if (needed.length === 0) return false; // an all-stopword answer is unusable
  let ti = 0;
  for (const want of needed) {
    let found = false;
    while (ti < transcriptTokens.length) {
      const got = transcriptTokens[ti]!;
      ti++;
      if (got === want || phoneticMatch(got, want)) {
        found = true;
        break;
      }
    }
    if (!found) return false;
  }
  return true;
}

/**
 * Match a spoken short answer against an authored ANSWER SET (multiple
 * acceptable answers). Fuzzy (articles ignored, subsequence) + phonetic. The
 * first acceptable answer that is satisfied wins; a wrong answer matches none.
 */
export function matchAnswerSet(
  transcript: string,
  acceptableAnswers: readonly string[],
): AnswerMatchResult {
  const tokens = normalizeWords(transcript);
  for (const answer of acceptableAnswers) {
    if (transcriptSatisfiesAnswer(tokens, answer)) {
      return {
        kind: "answer_set",
        matched: true,
        matchedAnswer: answer,
        score: 100,
        transcript,
        acceptableAnswers,
      };
    }
  }
  return {
    kind: "answer_set",
    matched: false,
    matchedAnswer: null,
    score: 0,
    transcript,
    acceptableAnswers,
  };
}

// ---------------------------------------------------------------------------
// fill_missing_word — the gap word is present AND the full sentence matches
// ---------------------------------------------------------------------------

export interface FillMissingWordScore {
  readonly kind: "fill_missing_word";
  /** Was the specific missing word spoken (phonetic-tolerant)? */
  readonly missingWordPresent: boolean;
  /** Word accuracy of the full spoken sentence vs the complete reference. */
  readonly sentenceAccuracy: number;
  /** Combined: half for the gap word, half for the full sentence. */
  readonly score: number;
  readonly missedWords: readonly string[];
  readonly missaidWords: readonly MisspokenWord[];
  readonly extraWords: readonly string[];
  readonly fluency: FluencyResult;
}

/**
 * Score a fill-missing-word attempt. The item authors the COMPLETE sentence
 * (referenceSentence) and the single word that was blanked (missingWord). Two
 * independent checks, per the item design:
 *   1. missingWordPresent — the gap word appears in the transcript (phonetic).
 *   2. sentenceAccuracy — the whole utterance matches the complete sentence.
 * The score gives half its weight to each so that getting the word but mangling
 * the sentence (or vice-versa) is a genuine partial, not a pass or a zero.
 */
export function scoreFillMissingWord(
  referenceSentence: string,
  missingWord: string,
  transcript: string,
  wordTimings: readonly WordTiming[],
): FillMissingWordScore {
  const acc = wordErrorRate(referenceSentence, transcript);
  const tokens = normalizeWords(transcript);
  const want = normalizeWords(missingWord)[0] ?? "";
  const missingWordPresent =
    want !== "" &&
    tokens.some((t) => t === want || phoneticMatch(t, want));
  const score = round2(
    (missingWordPresent ? 100 : 0) * 0.5 + acc.wordAccuracy * 0.5,
  );
  return {
    kind: "fill_missing_word",
    missingWordPresent,
    sentenceAccuracy: acc.wordAccuracy,
    score,
    missedWords: acc.missedWords,
    missaidWords: acc.missaidWords,
    extraWords: acc.extraWords,
    fluency: fluencyMetrics(wordTimings),
  };
}

// ---------------------------------------------------------------------------
// dictation — TYPED, string comparison, phonetics OFF (a typed homophone is an error)
// ---------------------------------------------------------------------------

export interface DictationScore {
  readonly kind: "dictation";
  readonly wordAccuracy: number;
  readonly wer: number;
  readonly exactMatches: number;
  readonly missedWords: readonly string[];
  readonly missaidWords: readonly MisspokenWord[];
  readonly extraWords: readonly string[];
  /** Always false — recorded so the report can state that a typed homophone counted as an error. */
  readonly phoneticTolerant: false;
}

/**
 * Score a dictation attempt: the student's TYPED text vs the reference. Uses the
 * same alignment as read-aloud but with phonetic tolerance OFF, so a homophone
 * ("write" for "right") is a real substitution. No fluency (nothing was spoken).
 */
export function scoreDictation(
  referenceText: string,
  typedText: string,
): DictationScore {
  const acc = dictationAccuracy(referenceText, typedText);
  return {
    kind: "dictation",
    wordAccuracy: acc.wordAccuracy,
    wer: acc.wer,
    exactMatches: acc.exactMatches,
    missedWords: acc.missedWords,
    missaidWords: acc.missaidWords,
    extraWords: acc.extraWords,
    phoneticTolerant: false,
  };
}

// ---------------------------------------------------------------------------
// story_retell — deterministic key-fact coverage floor + optional AI coherence
// ---------------------------------------------------------------------------

/** Small spelled-number → digit map so "five years" covers a "5 years" fact. */
const NUMBER_WORDS: Readonly<Record<string, string>> = {
  zero: "0", one: "1", two: "2", three: "3", four: "4", five: "5",
  six: "6", seven: "7", eight: "8", nine: "9", ten: "10", eleven: "11",
  twelve: "12", thirteen: "13", fourteen: "14", fifteen: "15",
  sixteen: "16", seventeen: "17", eighteen: "18", nineteen: "19",
  twenty: "20", thirty: "30", forty: "40", fifty: "50", sixty: "60",
  seventy: "70", eighty: "80", ninety: "90", hundred: "100",
  thousand: "1000", million: "1000000",
};

/**
 * Canonicalize a token for coverage comparison: a spelled number word becomes
 * its digit string ("five"→"5") so the digit and word forms of a number match.
 * Non-numbers are returned unchanged. This is what lets a PARAPHRASE ("it took
 * five years") cover a fact authored with digits ("5 years to build").
 */
function canonicalizeToken(token: string): string {
  return NUMBER_WORDS[token] ?? token;
}

/** Content words dropped when extracting a fact's salient tokens. */
const FACT_STOPWORDS: ReadonlySet<string> = new Set([
  "a", "an", "the", "to", "of", "in", "on", "at", "it", "is", "was", "were",
  "and", "or", "for", "with", "that", "this", "by", "as", "be", "been", "are",
  "he", "she", "they", "his", "her", "their", "them", "its", "had", "has",
]);

/** Salient (content + number) tokens of a fact, canonicalized. */
function salientTokens(text: string): string[] {
  return normalizeWords(text)
    .filter((t) => !FACT_STOPWORDS.has(t))
    .map(canonicalizeToken);
}

export interface FactCoverage {
  /** The authored fact, verbatim. */
  readonly fact: string;
  readonly covered: boolean;
  /** How many of the fact's salient tokens were found (for auditing). */
  readonly matchedTokens: number;
  readonly requiredTokens: number;
}

export interface StoryRetellCoverage {
  readonly covered: number;
  readonly total: number;
  /** covered / total, 0..1. */
  readonly ratio: number;
  readonly facts: readonly FactCoverage[];
}

export interface StoryRetellScore {
  readonly kind: "story_retell";
  readonly source: SpeechScoreSource;
  readonly coverage: StoryRetellCoverage;
  /** 0..100 = 100 * covered/total. The complete deterministic FLOOR. */
  readonly coverageScore: number;
  /** LLM coherence/completeness 0..100, or null when AI is unavailable. */
  readonly aiCoherence: number | null;
  /** The reported total. Floor alone when source is deterministic_floor. */
  readonly total: number;
  /** True only when an AI judgement contributed (label the total "approximate"). */
  readonly approximate: boolean;
  readonly fluency: FluencyResult;
}

/**
 * Key-fact coverage — the deterministic, paraphrase-tolerant heart of the retell
 * floor. A retell is paraphrase by nature ("it took five years to build" vs the
 * fact "5 years to build"), so coverage is NOT surface-string matching: each
 * fact is reduced to its salient tokens (content words + numbers, canonicalized
 * so "five"≡"5"), and a fact is covered when at least FACT_COVERAGE_TOKEN_RATIO
 * of those tokens appear anywhere in the retell. Literal substring matching here
 * would systematically under-credit correct retells — the homophone unfairness
 * arriving through a different door — which is exactly what this avoids.
 *
 * NOTE: deliberately NO phoneticMatch. The hard constraint keeps phonetic
 * tolerance out of the LLM-judged items; number-word canonicalization gives the
 * paraphrase tolerance a retell needs without reaching into phonetics.
 */
export function computeFactCoverage(
  keyFacts: readonly string[],
  transcript: string,
): StoryRetellCoverage {
  const spoken = new Set(normalizeWords(transcript).map(canonicalizeToken));
  const facts: FactCoverage[] = keyFacts.map((fact) => {
    const tokens = salientTokens(fact);
    const required = tokens.length;
    const matched = tokens.filter((t) => spoken.has(t)).length;
    const covered =
      required > 0 && matched / required >= FACT_COVERAGE_TOKEN_RATIO;
    return { fact, covered, matchedTokens: matched, requiredTokens: required };
  });
  const total = facts.length;
  const covered = facts.filter((f) => f.covered).length;
  return {
    covered,
    total,
    ratio: total === 0 ? 0 : round2(covered / total),
    facts,
  };
}

/**
 * The DETERMINISTIC FLOOR for a story retell: key-fact coverage scaled to the
 * full 0..100, plus fluency for context. This is a COMPLETE, honest score with
 * no AI — total === coverageScore, out of the same 100 the AI-blended path uses.
 * A student is never penalised for our AI being unavailable: the AI share is
 * simply not taken, it is not left as a hole in the total.
 */
export function scoreStoryRetellFloor(
  keyFacts: readonly string[],
  transcript: string,
  wordTimings: readonly WordTiming[],
): StoryRetellScore {
  const coverage = computeFactCoverage(keyFacts, transcript);
  const coverageScore = round2(coverage.ratio * 100);
  return {
    kind: "story_retell",
    source: "deterministic_floor",
    coverage,
    coverageScore,
    aiCoherence: null,
    total: coverageScore,
    approximate: false,
    fluency: fluencyMetrics(wordTimings),
  };
}

/**
 * Blend an LLM coherence/completeness judgement (0..100) into the retell floor.
 * total = coverage*(1-b) + ai*b, coverage-dominant (b=STORY_RETELL_AI_BLEND), so
 * most of the score stays checkable. `approximate` becomes true. If `aiCoherence`
 * is not a finite number the floor is returned UNCHANGED (never a partial score).
 */
export function blendStoryRetell(
  floor: StoryRetellScore,
  aiCoherence: number | null | undefined,
): StoryRetellScore {
  if (typeof aiCoherence !== "number" || !Number.isFinite(aiCoherence)) {
    return floor;
  }
  const ai = clamp(aiCoherence);
  const total = round2(
    floor.coverageScore * (1 - STORY_RETELL_AI_BLEND) + ai * STORY_RETELL_AI_BLEND,
  );
  return {
    ...floor,
    source: "ai_hybrid",
    aiCoherence: ai,
    total,
    approximate: true,
  };
}

// ---------------------------------------------------------------------------
// open_topic — deterministic fluency floor + optional AI relevance/grammar
// ---------------------------------------------------------------------------

export interface OpenTopicScore {
  readonly kind: "open_topic";
  readonly source: SpeechScoreSource;
  readonly fluency: FluencyResult;
  /** 0..100 fluency-only score — the complete deterministic FLOOR. */
  readonly fluencyScore: number;
  /** Seconds of silence before the first word (thinking/latency). */
  readonly latencySeconds: number;
  /** LLM relevance 0..100 (APPROXIMATE), or null when AI is unavailable. */
  readonly aiRelevance: number | null;
  /** LLM grammar 0..100 (APPROXIMATE), or null when AI is unavailable. */
  readonly aiGrammar: number | null;
  readonly total: number;
  /** True only when AI contributed — relevance/grammar are labelled approximate. */
  readonly approximate: boolean;
}

/**
 * Map fluency metrics to a 0..100 fluency score — a deliberately simple, honest
 * heuristic (documented, not a black box): full marks for a natural pace
 * (~1.5–3.5 words/sec), tapering to 0 outside [0.5, 5.5]; minus a filler penalty
 * (up to 30) and a pause penalty (up to 20 for many long pauses). An utterance
 * with too few words to measure a pace scores low, honestly.
 */
export function fluencyScore(fluency: FluencyResult): number {
  if (fluency.wordCount < 2 || fluency.speechRate <= 0) return 0;
  const r = fluency.speechRate;
  let rate: number;
  if (r >= 1.5 && r <= 3.5) rate = 100;
  else if (r < 1.5) rate = clamp(((r - 0.5) / 1.0) * 100);
  else rate = clamp(((5.5 - r) / 2.0) * 100);
  const fillerPenalty = Math.min(30, fluency.fillerRate * 100);
  const pauseRatio = fluency.pauseCount / fluency.wordCount;
  const pausePenalty = Math.min(20, pauseRatio * 100);
  return round2(clamp(rate - fillerPenalty - pausePenalty));
}

/**
 * The DETERMINISTIC FLOOR for an open-topic response: fluency only (rate,
 * pauses, fillers, latency) — the honest, checkable signal. Relevance and
 * grammar are NOT judged here (they need an LLM). total === fluencyScore, out of
 * the full 100, so the AI-down path is a complete score, never a penalty.
 */
export function scoreOpenTopicFloor(
  wordTimings: readonly WordTiming[],
): OpenTopicScore {
  const fluency = fluencyMetrics(wordTimings);
  const fScore = fluencyScore(fluency);
  const latencySeconds =
    wordTimings.length > 0 ? round2(Math.max(0, wordTimings[0]!.start)) : 0;
  return {
    kind: "open_topic",
    source: "deterministic_floor",
    fluency,
    fluencyScore: fScore,
    latencySeconds,
    aiRelevance: null,
    aiGrammar: null,
    total: fScore,
    approximate: false,
  };
}

/**
 * Blend LLM relevance + grammar (each 0..100, APPROXIMATE) into the open-topic
 * floor. total = fluency*(1-b) + avg(relevance,grammar)*b (b=OPEN_TOPIC_AI_BLEND).
 * Only the dimensions the AI actually returned are used; if it returned neither
 * usable number the floor is returned UNCHANGED. `approximate` becomes true.
 */
export function blendOpenTopic(
  floor: OpenTopicScore,
  ai: { relevance?: number | null; grammar?: number | null },
): OpenTopicScore {
  const parts: number[] = [];
  const rel =
    typeof ai.relevance === "number" && Number.isFinite(ai.relevance)
      ? clamp(ai.relevance)
      : null;
  const gram =
    typeof ai.grammar === "number" && Number.isFinite(ai.grammar)
      ? clamp(ai.grammar)
      : null;
  if (rel !== null) parts.push(rel);
  if (gram !== null) parts.push(gram);
  if (parts.length === 0) return floor;
  const aiAvg = parts.reduce((s, v) => s + v, 0) / parts.length;
  const total = round2(
    floor.fluencyScore * (1 - OPEN_TOPIC_AI_BLEND) + aiAvg * OPEN_TOPIC_AI_BLEND,
  );
  return {
    ...floor,
    source: "ai_hybrid",
    aiRelevance: rel,
    aiGrammar: gram,
    total,
    approximate: true,
  };
}
