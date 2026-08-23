/**
 * Pure speech scoring engine (Communication Sections A/B). No I/O, no DOM, no
 * randomness — every function is a deterministic function of its inputs, so the
 * whole engine unit-tests without a running ASR service, exactly like the essay
 * and email engines. The worker does the I/O (record → upload → transcribe) and
 * hands the transcript + word timings to these functions.
 *
 * Step 10 scores ONE item type — READ ALOUD — on two honest, deterministic
 * dimensions:
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

  // A pair is "aligned" (edit cost 0) when exact OR phonetically equivalent.
  const aligned = (a: string, b: string): boolean =>
    a === b || phoneticMatch(a, b);

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
