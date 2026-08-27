/**
 * PURE near-duplicate detection for interview questions (Step 35 D). The question
 * generator doesn't inherently know what it has already asked; we thread the
 * asked list into every generation call AND defensively detect a near-duplicate
 * that slips through, so a 6+ turn session never repeats itself.
 *
 * "Near-duplicate" is deliberately phrasing-insensitive: two questions match when
 * their CONTENT words overlap heavily, comparing each word by its METAPHONE key
 * (reusing `phonetics.ts`) so "How did you scale the service?" and "How would you
 * scale that service" collapse. Stop-words are dropped so shared scaffolding
 * ("tell me about a time…") doesn't force false matches — the match is on the
 * substantive terms. No I/O, no dependency beyond the shared phonetic matcher.
 */
import { metaphone } from "./phonetics.js";

/** Function words that carry no topic signal — dropped before comparison so two
 *  questions are compared on their SUBSTANTIVE words, not shared scaffolding. */
const STOP_WORDS: ReadonlySet<string> = new Set([
  "a", "an", "the", "and", "or", "but", "if", "then", "so", "of", "to", "in",
  "on", "for", "with", "at", "by", "from", "up", "about", "into", "over",
  "after", "is", "are", "was", "were", "be", "been", "being", "do", "did",
  "does", "have", "has", "had", "can", "could", "would", "should", "will",
  "shall", "may", "might", "must", "you", "your", "yours", "yourself", "i",
  "me", "my", "we", "our", "us", "he", "she", "it", "they", "them", "this",
  "that", "these", "those", "how", "what", "why", "when", "where", "which",
  "who", "whom", "tell", "me", "describe", "explain", "give", "share", "walk",
  "through", "some", "any", "as", "than", "not", "no", "yes", "please",
]);

const WORD = /[A-Za-z0-9]+/g;

/** Content-word phonetic keys of a question (lowercased, stop-words removed,
 *  each surviving word encoded to its Metaphone key). Empty keys are dropped. */
export function questionKeys(question: string): string[] {
  const words = (question.toLowerCase().match(WORD) ?? []).filter(
    (w) => !STOP_WORDS.has(w),
  );
  const keys: string[] = [];
  for (const w of words) {
    const k = metaphone(w);
    // Fall back to the raw word when unencodable (all-digit tokens) so numbers
    // and short tokens still contribute to the overlap.
    keys.push(k || w);
  }
  return keys;
}

/**
 * Jaccard overlap of the two questions' content-word phonetic key SETS, 0..1.
 * Two empty questions are treated as identical (1); one empty vs non-empty is 0.
 */
export function questionSimilarity(a: string, b: string): number {
  const ka = new Set(questionKeys(a));
  const kb = new Set(questionKeys(b));
  if (ka.size === 0 && kb.size === 0) return 1;
  if (ka.size === 0 || kb.size === 0) return 0;
  let inter = 0;
  for (const k of ka) if (kb.has(k)) inter += 1;
  const union = ka.size + kb.size - inter;
  return union === 0 ? 0 : inter / union;
}

/** Default overlap at/above which two questions are treated as the same question.
 *  0.7 = the substantive content words are largely shared regardless of phrasing. */
export const QUESTION_DUPLICATE_THRESHOLD = 0.7;

/**
 * True when `candidate` is a near-duplicate of ANY already-asked question. Also
 * true for a containment case — one question's content words are a superset that
 * fully covers a short prior question (so "Scale the service?" vs "How would you
 * scale the service under load and why?" still flags when the short one is wholly
 * contained), which pure Jaccard can miss when lengths differ a lot.
 */
export function isNearDuplicateQuestion(
  candidate: string,
  asked: readonly string[],
  threshold = QUESTION_DUPLICATE_THRESHOLD,
): boolean {
  const ck = new Set(questionKeys(candidate));
  if (ck.size === 0) return false;
  for (const prior of asked) {
    if (questionSimilarity(candidate, prior) >= threshold) return true;
    // Containment: the shorter question's content words are ALL inside the
    // other's — the same question with extra words / a dropped clause. Requires
    // ≥2 content words on the shorter side so a one-word fragment can't match.
    const pk = new Set(questionKeys(prior));
    if (pk.size >= 2 && ck.size >= 2) {
      const [small, big] = ck.size <= pk.size ? [ck, pk] : [pk, ck];
      let covered = 0;
      for (const k of small) if (big.has(k)) covered += 1;
      if (covered === small.size) return true;
    }
  }
  return false;
}

/**
 * Filter a fresh batch of generated questions, dropping any that duplicate an
 * already-asked question OR an earlier item in the same batch. Returns the kept
 * questions in order. Used as the last-line defence after instructing the model
 * against repetition — see the service's regenerate-once flow.
 */
export function dropDuplicateQuestions<T extends { text: string }>(
  candidates: readonly T[],
  asked: readonly string[],
  threshold = QUESTION_DUPLICATE_THRESHOLD,
): T[] {
  const seen = [...asked];
  const kept: T[] = [];
  for (const c of candidates) {
    if (isNearDuplicateQuestion(c.text, seen, threshold)) continue;
    kept.push(c);
    seen.push(c.text);
  }
  return kept;
}
