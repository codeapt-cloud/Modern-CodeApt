/**
 * Essay semantic-keyword helpers — pure, deterministic, testable.
 *
 * `extractKeywordsDeterministic` is the guaranteed fallback for keyword
 * generation: it always returns SOMETHING usable from a topic's text when the
 * LLM is unconfigured or fails. `normalizeKeywords` cleans/validates a raw list
 * (from the LLM or from manual entry) into the canonical form stored on the
 * topic. No I/O, no randomness.
 */

/** Max keywords proposed/kept, and max length of a single keyword phrase. */
export const ESSAY_KEYWORD_MAX = 12;
export const ESSAY_KEYWORD_MAX_LEN = 60;

/** Common English stopwords — never useful as relevance keywords on their own. */
const KEYWORD_STOPWORDS: ReadonlySet<string> = new Set([
  "the", "a", "an", "and", "or", "but", "nor", "for", "so", "yet", "of", "to",
  "in", "on", "at", "by", "with", "from", "into", "onto", "as", "is", "are",
  "was", "were", "be", "been", "being", "am", "do", "does", "did", "has",
  "have", "had", "will", "would", "shall", "should", "can", "could", "may",
  "might", "must", "this", "that", "these", "those", "it", "its", "they",
  "them", "their", "we", "our", "you", "your", "he", "she", "his", "her",
  "him", "i", "me", "my", "not", "no", "if", "then", "than", "such", "which",
  "who", "whom", "whose", "what", "when", "where", "why", "how", "all", "any",
  "some", "each", "every", "both", "few", "more", "most", "other", "own",
  "same", "about", "above", "below", "between", "over", "under", "again",
  "further", "here", "there", "also", "very", "just", "only", "up", "down",
  "out", "off", "because", "while", "during", "before", "after", "essay",
  "write", "discuss", "argue", "topic", "words", "word", "must", "least",
]);

/**
 * Clean/validate a raw keyword list (LLM output or manual entry) into the
 * canonical stored form: trimmed, lowercased, whitespace-collapsed, empties /
 * over-long / single-word stopwords dropped, deduped, capped.
 */
export function normalizeKeywords(
  raw: unknown,
  cap: number = ESSAY_KEYWORD_MAX,
): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const k = item.trim().toLowerCase().replace(/\s+/g, " ");
    if (!k || k.length > ESSAY_KEYWORD_MAX_LEN) continue;
    // A lone stopword is noise; multi-word phrases are kept as-is.
    if (!k.includes(" ") && KEYWORD_STOPWORDS.has(k)) continue;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(k);
    if (out.length >= cap) break;
  }
  return out;
}

/**
 * Deterministic keyword extraction from a topic's text: salient alphabetic
 * words (length >= 3, non-stopword), ranked by frequency with first-occurrence
 * as a stable tie-break, deduped, capped. The always-available fallback.
 */
export function extractKeywordsDeterministic(text: string, cap = 10): string[] {
  const tokens = (text.toLowerCase().match(/[a-z][a-z'-]*/g) ?? [])
    .map((t) => t.replace(/^['-]+|['-]+$/g, ""))
    .filter((t) => t.length >= 3 && !KEYWORD_STOPWORDS.has(t));

  const freq = new Map<string, number>();
  const firstSeen = new Map<string, number>();
  tokens.forEach((t, i) => {
    freq.set(t, (freq.get(t) ?? 0) + 1);
    if (!firstSeen.has(t)) firstSeen.set(t, i);
  });

  return [...freq.keys()]
    .sort((a, b) => {
      const byFreq = (freq.get(b) ?? 0) - (freq.get(a) ?? 0);
      if (byFreq !== 0) return byFreq;
      return (firstSeen.get(a) ?? 0) - (firstSeen.get(b) ?? 0);
    })
    .slice(0, cap);
}
