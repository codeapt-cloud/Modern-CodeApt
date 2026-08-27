/**
 * PURE domain-term correction for interview transcripts (Step 34 fix #3). Browser
 * STT mishears domain vocabulary ("frontend" → "front end" / "front and",
 * "Kubernetes" → "kubernetis"). We CORRECT the transcript against a KNOWN TERM
 * LIST (extracted from the JD + resume at intake) — we do NOT let an LLM rewrite
 * the answer. This touches TERMS ONLY: it never changes phrasing or content, and
 * it reports exactly which spans it replaced so the original can be disputed.
 *
 * Matching combines edit distance AND the existing phonetic matcher
 * (`phoneticMatch`, metaphone) over 1–3 word n-grams. High-confidence only, so a
 * student who genuinely said "friend" keeps "friend" (see the threshold notes).
 */
import { phoneticMatch } from "./phonetics.js";

export interface TermCorrection {
  /** The original span in the transcript (verbatim). */
  readonly from: string;
  /** The canonical term it was normalized to. */
  readonly to: string;
  /** Why it matched — for auditing a dispute. */
  readonly kind: "exact" | "near" | "phonetic";
}

export interface TranscriptCorrection {
  /** The transcript with domain terms normalized. */
  readonly corrected: string;
  /** The original, unchanged transcript (kept for disputes). */
  readonly original: string;
  /** Every replacement applied, in order. */
  readonly applied: readonly TermCorrection[];
}

/** Terms shorter than this (by comparison key) are never matched — too small to
 *  correct safely. All real domain terms (REST=4, OAuth=5, …) clear it. */
const MIN_KEY_LEN = 3;
/** Normalized edit distance at/under which a NON-exact match is accepted. Tight
 *  on purpose: "front and"→"frontend" is 0.125 (accepted); "friend"→"frontend"
 *  is 0.5 (rejected). */
const NEAR_THRESHOLD = 0.2;
/** A phonetic match is only trusted when the spelling is also reasonably close,
 *  so unrelated homophones can't slip through. */
const PHONETIC_MAX_DISTANCE = 0.34;
/** Longest n-gram considered (so "front end", "node js", "o auth" collapse). */
const MAX_NGRAM = 3;

/**
 * Common English words that are ALSO domain terms (or collide with them). When a
 * candidate is one of these we bias toward LEAVING IT ALONE — "rest" the word must
 * not become "REST" the protocol, "react" the verb must not become "React". Two
 * guards use this set: (1) a single spoken word that IS a common word is never
 * corrected; (2) a TERM whose key is a common word is only ever applied via a
 * MULTI-WORD exact collapse (never a single-word exact/fuzzy match), so bare
 * "rest"/"react"/"go" survive while "front end"→"frontend" still works. The set is
 * curated (tech-vs-English collisions), and deliberately errs toward non-correction.
 */
const COMMON_WORDS: ReadonlySet<string> = new Set([
  "rest", "react", "go", "node", "spring", "swift", "rust", "ruby", "dart",
  "shell", "express", "next", "hack", "arc", "processing", "crystal", "nim",
  "friend", "angular", "scratch", "pike", "io", "julia", "elm", "d", "v",
  "clojure", "run", "build", "test", "deploy", "flow", "storm", "beam",
]);

const WORD = /[A-Za-z0-9.+#]+/g;

/** Comparison key: lowercase, keep only letters+digits (drops spaces/dots/case),
 *  so "Node.js" / "node js" / "NODEJS" all key to "nodejs". */
function key(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const cur = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost);
    }
    prev = cur;
  }
  return prev[b.length]!;
}

interface TermEntry {
  readonly canonical: string;
  readonly key: string;
}

function matchKind(
  gramKey: string,
  term: TermEntry,
  strictLen: boolean,
): TermCorrection["kind"] | null {
  if (gramKey.length < MIN_KEY_LEN || term.key.length < MIN_KEY_LEN) return null;
  if (gramKey === term.key) return "exact";
  // For a MULTI-WORD span, a fuzzy match must be the same length as the term —
  // otherwise a stray short word glues on ("a rest" ≈ "rest") and gets swallowed.
  // Single words keep the normal edit-distance tolerance ("postgres"→"postgresql").
  if (strictLen && gramKey.length !== term.key.length) return null;
  const dist = levenshtein(gramKey, term.key);
  const norm = dist / Math.max(gramKey.length, term.key.length);
  if (norm <= NEAR_THRESHOLD) return "near";
  if (norm <= PHONETIC_MAX_DISTANCE && phoneticMatch(gramKey, term.key)) return "phonetic";
  return null;
}

/**
 * Correct domain terms in `raw` against `terms`. Scans left-to-right, trying the
 * longest n-gram (3→1) at each position; on a high-confidence match it replaces
 * the span with the canonical term (only when the surface actually differs) and
 * skips the consumed words. Non-term words are copied verbatim — phrasing and
 * content are never touched.
 */
export function correctTranscript(
  raw: string,
  terms: readonly string[],
): TranscriptCorrection {
  const entries: TermEntry[] = [];
  const seen = new Set<string>();
  for (const t of terms) {
    const canonical = t.trim();
    const k = key(canonical);
    if (k.length < MIN_KEY_LEN || seen.has(k)) continue;
    seen.add(k);
    entries.push({ canonical, key: k });
  }

  const words = raw.match(WORD) ?? [];
  if (entries.length === 0 || words.length === 0) {
    return { corrected: raw.trim(), original: raw, applied: [] };
  }

  const out: string[] = [];
  const applied: TermCorrection[] = [];
  let i = 0;
  while (i < words.length) {
    let matched = false;
    // Longest n-gram first so multi-word variants collapse before single words.
    for (let n = Math.min(MAX_NGRAM, words.length - i); n >= 1 && !matched; n -= 1) {
      const span = words.slice(i, i + n);
      const gramKey = key(span.join(""));
      // GUARD 1: a single spoken word that is itself a common English word is
      // left alone — the student's real "rest"/"react"/"go"/"friend" wins over
      // any term it happens to resemble.
      if (n === 1 && COMMON_WORDS.has(gramKey)) continue;
      let best: { term: TermEntry; kind: TermCorrection["kind"]; norm: number } | null = null;
      for (const term of entries) {
        const kind = matchKind(gramKey, term, n > 1);
        if (!kind) continue;
        // GUARD 2: a common-word TERM (REST, React, Go…) is only applied via a
        // multi-word EXACT collapse — never a single-word exact/fuzzy match — so
        // it can never overwrite the bare common word or a near variant ("reacts").
        if (COMMON_WORDS.has(term.key) && !(n > 1 && kind === "exact")) continue;
        const norm =
          kind === "exact" ? 0 : levenshtein(gramKey, term.key) / Math.max(gramKey.length, term.key.length);
        if (!best || norm < best.norm) best = { term, kind, norm };
      }
      if (best) {
        const from = span.join(" ");
        // Only record a correction when the surface actually changes.
        if (from !== best.term.canonical) {
          applied.push({ from, to: best.term.canonical, kind: best.kind });
        }
        out.push(best.term.canonical);
        i += n;
        matched = true;
      }
    }
    if (!matched) {
      out.push(words[i]!);
      i += 1;
    }
  }

  return { corrected: out.join(" "), original: raw, applied };
}
