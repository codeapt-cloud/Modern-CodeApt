/**
 * Pure essay scoring engine. No I/O, no DOM, no randomness — every function is
 * a deterministic function of its inputs, so the whole engine is exhaustively
 * unit-testable and identical on the API, the worker, and the web client.
 *
 * The design mirrors the original Django `scoring_service.py`: seven
 * deterministic sub-scores on a 0..100 scale, combined by fixed WEIGHTS (which
 * sum to 1.00) into a 0..100 total, with a small bonus when the three
 * "meaning" dimensions (vocabulary, structure, relevance) are all excellent.
 *
 * The AI layer (worker-only) never replaces this engine — it can only *blend*
 * into three dimensions (vocabulary, structure & relevance). `scoreDeterministic`
 * is the guaranteed floor: if the AI is disabled, unreachable, or slow, grading
 * still completes with a fully deterministic result.
 *
 *   Final weights: grammar 0.12, spelling 0.05, punctuation 0.05,
 *                  readability 0.08, vocabulary 0.22, structure 0.23,
 *                  relevance 0.25   (Σ = 1.00)
 *   Bonus: +5 if vocabulary, structure AND relevance are all >= 80.
 *   AI blend (blend = det*(1-b) + AI*b): vocabulary b=0.5, structure b=0.5,
 *                  relevance b=0.6.
 */
import {
  ESSAY_AI_BLEND,
  ESSAY_BONUS_POINTS,
  ESSAY_BONUS_THRESHOLD,
  ESSAY_SCORE_WEIGHTS,
  type EssayScoreDimension,
} from "./constants.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A 0..100 sub-score for each of the seven weighted dimensions. */
export type EssayDimensionScores = Record<EssayScoreDimension, number>;

/** The prompt-side inputs the deterministic engine reads (admin-owned data). */
export interface EssayPromptRef {
  /**
   * Keywords the relevance analyzer measures coverage against. These live in
   * the ADMIN projection only — they must never be sent to a student.
   */
  readonly referenceKeywords: readonly string[];
}

/** Text statistics computed once and reused across analyzers + persistence. */
export interface EssayTextStats {
  readonly wordCount: number;
  readonly characterCount: number;
  readonly paragraphCount: number;
  readonly sentenceCount: number;
}

/** Result of the deterministic engine: per-dimension breakdown + total. */
export interface DeterministicScore extends EssayTextStats {
  readonly dimensions: EssayDimensionScores;
  /** 0..100 weighted total, including the bonus if earned. */
  readonly total: number;
  readonly bonusApplied: boolean;
}

/** Result of blending an AI analysis into a deterministic breakdown. */
export interface BlendedScore {
  readonly dimensions: EssayDimensionScores;
  readonly total: number;
  readonly bonusApplied: boolean;
}

// ---------------------------------------------------------------------------
// Small numeric helpers
// ---------------------------------------------------------------------------

const clamp = (n: number, lo = 0, hi = 100): number =>
  Math.min(hi, Math.max(lo, n));

/** Round to 2 decimals so persisted scores are stable and readable. */
const round2 = (n: number): number => Math.round(n * 100) / 100;

const DIMENSIONS = Object.keys(ESSAY_SCORE_WEIGHTS) as EssayScoreDimension[];

// ---------------------------------------------------------------------------
// Tokenization (pure, ES2022 — no Node/DOM APIs)
// ---------------------------------------------------------------------------

/** Whitespace-delimited word count (matches the UI's counter). */
export function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

/** Blank-line-separated paragraphs; a non-empty single block counts as one. */
export function countParagraphs(text: string): number {
  const blocks = text
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean);
  if (blocks.length > 0) return blocks.length;
  return text.trim() ? 1 : 0;
}

/** Sentence segments split on terminal punctuation. */
function splitSentences(text: string): string[] {
  return text
    .split(/[.!?]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Lowercased alphabetic tokens (apostrophes kept) for lexical analysis. */
function alphaTokens(text: string): string[] {
  return text.toLowerCase().match(/[a-z]+(?:'[a-z]+)?/g) ?? [];
}

/** All text statistics in one pass-friendly bundle. */
export function computeTextStats(text: string): EssayTextStats {
  return {
    wordCount: countWords(text),
    characterCount: text.length,
    paragraphCount: countParagraphs(text),
    sentenceCount: splitSentences(text).length,
  };
}

// ---------------------------------------------------------------------------
// Reference word lists (small, deliberately illustrative — the point is a
// deterministic signal, not a linguistically complete lexicon).
// ---------------------------------------------------------------------------

const ACADEMIC_WORDS = new Set([
  "analyze",
  "approach",
  "assess",
  "concept",
  "consequently",
  "context",
  "demonstrate",
  "derive",
  "distinct",
  "emphasize",
  "establish",
  "evaluate",
  "evident",
  "framework",
  "furthermore",
  "hypothesis",
  "implication",
  "infer",
  "significant",
  "substantial",
  "subsequently",
  "therefore",
  "thus",
  "whereas",
  "moreover",
  "nevertheless",
  "consequence",
  "perspective",
  "fundamental",
  "comprehensive",
]);

const FILLER_WORDS = new Set([
  "really",
  "very",
  "just",
  "actually",
  "basically",
  "literally",
  "stuff",
  "things",
  "kinda",
  "sorta",
  "maybe",
  "somewhat",
  "totally",
  "definitely",
  "like",
]);

const TRANSITION_WORDS = new Set([
  "however",
  "therefore",
  "moreover",
  "furthermore",
  "consequently",
  "additionally",
  "nevertheless",
  "meanwhile",
  "thus",
  "hence",
  "although",
  "whereas",
  "similarly",
  "conversely",
  "firstly",
  "secondly",
  "finally",
  "overall",
  "instead",
  "accordingly",
]);

/**
 * A tiny common-misspelling map (original used a large `COMMON_MISSPELLINGS`).
 * Keys are lowercased misspellings; presence is treated as a spelling error.
 */
const COMMON_MISSPELLINGS = new Set([
  "teh",
  "recieve",
  "seperate",
  "definately",
  "occured",
  "untill",
  "wich",
  "becuase",
  "beleive",
  "acheive",
  "adress",
  "arguement",
  "enviroment",
  "goverment",
  "neccessary",
  "occassion",
  "publically",
  "reccomend",
  "succesful",
  "tommorow",
  "wierd",
  "alot",
  "thier",
  "youre",
]);

// ---------------------------------------------------------------------------
// Per-dimension analyzers — each returns a normalized 0..100 sub-score.
// ---------------------------------------------------------------------------

/**
 * Vocabulary richness: lexical diversity (type-token ratio) as the base, with
 * an academic-word bonus and a filler-word penalty. Empty text scores 0.
 */
export function scoreVocabulary(text: string): number {
  const tokens = alphaTokens(text);
  const total = tokens.length;
  if (total === 0) return 0;

  const unique = new Set(tokens).size;
  const diversity = unique / total; // 0..1
  // A well-varied medium essay lands near diversity 0.7 → base ~80.
  const base = Math.min(1, diversity / 0.7) * 80;

  let academic = 0;
  let filler = 0;
  for (const t of tokens) {
    if (ACADEMIC_WORDS.has(t)) academic++;
    if (FILLER_WORDS.has(t)) filler++;
  }
  const academicBonus = Math.min(20, (academic / total) * 100 * 2);
  const fillerPenalty = Math.min(20, (filler / total) * 100 * 2);

  return round2(clamp(base + academicBonus - fillerPenalty));
}

/**
 * Structure quality: paragraph organization (intro/body/conclusion → 3+),
 * transition-word usage, and sentence-length variety (a monotone or extreme
 * cadence reads as weak structure).
 */
export function scoreStructure(text: string): number {
  const sentences = splitSentences(text);
  const sentenceCount = sentences.length;
  if (sentenceCount === 0) return 0;

  // Paragraph organization — up to 40 pts, full at 3 paragraphs.
  const paragraphs = countParagraphs(text);
  const paragraphScore = Math.min(1, paragraphs / 3) * 40;

  // Transitions — up to 30 pts, full when ~30% of sentences carry one.
  const tokens = alphaTokens(text);
  let transitions = 0;
  for (const t of tokens) if (TRANSITION_WORDS.has(t)) transitions++;
  const transitionRatio = transitions / sentenceCount;
  const transitionScore = Math.min(1, transitionRatio / 0.3) * 30;

  // Sentence-length variety — up to 30 pts. Reward an average near 18 words
  // and a non-trivial spread (single-sentence essays get little credit).
  const lengths = sentences.map((s) => countWords(s));
  const avg = lengths.reduce((a, b) => a + b, 0) / sentenceCount;
  const variance =
    lengths.reduce((a, b) => a + (b - avg) ** 2, 0) / sentenceCount;
  const stdev = Math.sqrt(variance);
  const avgScore = clamp(1 - Math.abs(avg - 18) / 18, 0, 1); // 0..1
  const spreadScore = Math.min(1, stdev / 6); // 0..1, full at stdev 6
  const varietyScore = (avgScore * 0.6 + spreadScore * 0.4) * 30;

  return round2(clamp(paragraphScore + transitionScore + varietyScore));
}

/**
 * Relevance: coverage of the prompt's reference keywords, shaped by
 * `coverage_ratio ** 1.5 * 100` (rewards broad coverage, punishes sparse). A
 * keyword matches as a whole word (single token) or a substring (phrase).
 * When a prompt declares no reference keywords there is nothing to measure, so
 * relevance is neutral (returns 100 — it cannot drag the score down).
 */
export function scoreRelevance(
  text: string,
  referenceKeywords: readonly string[],
): number {
  const keywords = referenceKeywords
    .map((k) => k.trim().toLowerCase())
    .filter(Boolean);
  if (keywords.length === 0) return 100;

  const haystack = text.toLowerCase();
  const wordSet = new Set(alphaTokens(text));
  let matched = 0;
  for (const kw of keywords) {
    const isPhrase = /\s/.test(kw);
    if (isPhrase ? haystack.includes(kw) : wordSet.has(kw)) matched++;
  }
  const coverage = matched / keywords.length; // 0..1
  return round2(clamp(coverage ** 1.5 * 100));
}

/**
 * Grammar heuristics (NOT a real grammar model): sentence capitalization and
 * repeated-word errors ("the the"). Starts at 100 and deducts.
 */
export function scoreGrammar(text: string): number {
  const sentences = splitSentences(text);
  if (sentences.length === 0) return 0;

  const capitalized = sentences.filter((s) => /^[A-Z"']/.test(s)).length;
  const capRatio = capitalized / sentences.length; // 0..1

  const repeated = text.toLowerCase().match(/\b(\w+)\s+\1\b/g)?.length ?? 0;

  const base = capRatio * 100;
  const repeatedPenalty = Math.min(30, repeated * 8);
  return round2(clamp(base - repeatedPenalty));
}

/** A word-membership predicate (injected by the worker's real dictionary). */
export type IsKnownWord = (word: string) => boolean;

/**
 * Spelling score (0..100). When an `isKnownWord` predicate is supplied (the
 * worker injects a real English dictionary), this runs a fair dictionary-based
 * check with false-positive avoidance; otherwise it falls back to the legacy
 * common-misspellings heuristic so the engine stays self-contained and pure on
 * clients/tests that don't load a dictionary. The 0..100 output shape is
 * identical in both paths, so the weighted combine is unchanged.
 */
export function scoreSpelling(text: string, isKnownWord?: IsKnownWord): number {
  return isKnownWord
    ? scoreSpellingWithDictionary(text, isKnownWord)
    : scoreSpellingHeuristic(text);
}

/** Legacy fallback: fraction of tokens in the tiny common-misspelling set. */
function scoreSpellingHeuristic(text: string): number {
  const tokens = alphaTokens(text);
  if (tokens.length === 0) return 0;
  let errors = 0;
  for (const t of tokens) if (COMMON_MISSPELLINGS.has(t)) errors++;
  const errorRatio = errors / tokens.length;
  // Each 1% of misspelled words costs ~4 points; clamps at 0.
  return round2(clamp(100 - errorRatio * 100 * 4));
}

/**
 * Classify a whitespace-delimited token for spelling: `skip` (not prose we can
 * fairly check), `ok` (a real word), or `error` (a checkable word not in the
 * dictionary). Skips numbers, URLs/emails/paths, dotted code (`foo.bar`),
 * code-ish tokens, camelCase, proper nouns / sentence-initial / ALLCAPS words,
 * and very short tokens. Hyphenated compounds pass when every part is known;
 * contractions/possessives pass on the whole word OR the pre-apostrophe root.
 */
/**
 * Curated supplement of common technical terms absent from the plain English
 * word list, so legitimate lowercase jargon (microservices, backend, webhook,
 * …) is not flagged as a misspelling. Lowercase and matched case-insensitively
 * (the classifier lowercases first). This is a pragmatic, NON-EXHAUSTIVE
 * allowlist — extend as real reviewer noise surfaces. Acronyms written in caps
 * (API, JSON, OAuth) are already skipped by the leading-uppercase rule; these
 * lowercase entries cover prose that spells them lowercase.
 */
export const ESSAY_TECH_TERMS: ReadonlySet<string> = new Set([
  "microservice",
  "microservices",
  "backend",
  "frontend",
  "fullstack",
  "webhook",
  "webhooks",
  "middleware",
  "runtime",
  "dataset",
  "datasets",
  "api",
  "apis",
  "cli",
  "sdk",
  "json",
  "yaml",
  "xml",
  "sql",
  "nosql",
  "auth",
  "oauth",
  "graphql",
  "kubernetes",
  "docker",
  "postgres",
  "postgresql",
  "mysql",
  "redis",
  "mongodb",
  "devops",
  "serverless",
  "terraform",
  "nginx",
  "javascript",
  "typescript",
  "nodejs",
  "npm",
  "async",
  "boolean",
  "enum",
  "config",
  "configs",
  "repo",
  "repos",
  "login",
  "logout",
  "signup",
  "timestamp",
  "timestamps",
  "filename",
  "hostname",
  "namespace",
  "namespaces",
  "workflow",
  "workflows",
  "dropdown",
  "tooltip",
  "changelog",
  "endpoint",
  "endpoints",
  "url",
  "uri",
  "cdn",
]);

/** A word is acceptable if it's in the real dictionary OR the tech allowlist. */
function isKnownOrTech(w: string, isKnownWord: IsKnownWord): boolean {
  return isKnownWord(w) || ESSAY_TECH_TERMS.has(w);
}

export function classifySpellingToken(
  raw: string,
  isKnownWord: IsKnownWord,
): "skip" | "ok" | "error" {
  // Numbers, emails, URLs, paths, and dotted code (foo.bar) are not prose.
  if (/\d/.test(raw)) return "skip";
  if (/[@/\\]/.test(raw)) return "skip";
  if (/[A-Za-z]\.[A-Za-z]/.test(raw)) return "skip";

  // Trim edge punctuation/quotes to the letter core (keep interior ' and -).
  const core = raw.replace(/^[^A-Za-z]+/, "").replace(/[^A-Za-z]+$/, "");
  if (!core) return "skip";
  // Interior symbols beyond letters/apostrophe/hyphen → code-ish.
  if (/[^A-Za-z'-]/.test(core)) return "skip";
  // Proper nouns / sentence-initial / acronyms: leading uppercase.
  if (/^[A-Z]/.test(core)) return "skip";
  // camelCase / mixed-case identifiers.
  if (/[a-z][A-Z]/.test(core)) return "skip";

  const w = core.toLowerCase();
  if (w.length <= 2) return "skip";

  // Hyphenated compound: correct iff every (non-trivial) part is acceptable.
  if (w.includes("-")) {
    const parts = w.split("-").filter((p) => p.length > 0);
    if (parts.length === 0) return "skip";
    return parts.every((p) => p.length <= 2 || isKnownOrTech(p, isKnownWord))
      ? "ok"
      : "error";
  }
  // Contractions / possessives: accept the whole OR the pre-apostrophe root.
  if (w.includes("'")) {
    const root = w.slice(0, w.indexOf("'"));
    return isKnownOrTech(w, isKnownWord) ||
      (root.length > 0 && isKnownOrTech(root, isKnownWord))
      ? "ok"
      : "error";
  }
  return isKnownOrTech(w, isKnownWord) ? "ok" : "error";
}

/** Dictionary-based spelling: bounded misspelling ratio → 0..100. */
function scoreSpellingWithDictionary(
  text: string,
  isKnownWord: IsKnownWord,
): number {
  const raws = text.split(/\s+/).filter(Boolean);
  let checked = 0;
  let errors = 0;
  for (const raw of raws) {
    const verdict = classifySpellingToken(raw, isKnownWord);
    if (verdict === "skip") continue;
    checked++;
    if (verdict === "error") errors++;
  }
  if (checked === 0) return 100; // nothing checkable → nothing to penalize
  const errorRatio = errors / checked;
  // Same penalty scale as the heuristic: ~4 points per 1% misspelled.
  return round2(clamp(100 - errorRatio * 100 * 4));
}

/**
 * Punctuation: rewards sentences that terminate cleanly and penalizes obvious
 * mistakes — a space before a comma/period, and doubled punctuation.
 */
export function scorePunctuation(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;

  // Count terminal marks relative to sentence-like segments.
  const segments = splitSentences(text).length;
  const terminals = (text.match(/[.!?]/g) ?? []).length;
  const terminalRatio = segments === 0 ? 0 : Math.min(1, terminals / segments);

  const spaceBefore = (text.match(/\s+[,.;:!?]/g) ?? []).length;
  const doubled = (text.match(/[,;:]{2,}|\.{4,}/g) ?? []).length;

  const base = terminalRatio * 100;
  const penalty = Math.min(30, spaceBefore * 3 + doubled * 5);
  return round2(clamp(base - penalty));
}

/** Count vowel groups as a syllable heuristic (min 1). */
function countSyllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return 0;
  const groups = w.match(/[aeiouy]+/g)?.length ?? 0;
  let n = groups;
  if (w.endsWith("e") && n > 1) n--; // silent trailing 'e'
  return Math.max(1, n);
}

/**
 * Ideal Flesch Reading Ease band for competent formal/academic prose. Raw
 * Flesch rewards short words + short sentences, so mapping "higher Flesch =
 * better" punishes sophisticated writing and rewards simplistic rambling — the
 * dimension ends up inversely correlated with quality. Instead we score by
 * DISTANCE FROM AN IDEAL BAND: within the band → 100, decaying as prose falls
 * outside it in EITHER direction (too simplistic OR needlessly impenetrable).
 *
 * Band [20, 60]: Flesch 30–60 is the "standard → fairly difficult" range, and
 * 20–30 is "difficult (college/graduate)" — where dense-but-competent formal
 * writing legitimately lands (this engine's syllable heuristic runs formal
 * prose low, per calibration). Above 60 is "plain/easy", which for a graded
 * academic essay reads as over-simplified, so it decays too. DECAY = 2.5 score
 * points per Flesch point outside the band (→ 0 at ~40 points out).
 */
export const READABILITY_IDEAL_MIN = 20;
export const READABILITY_IDEAL_MAX = 60;
const READABILITY_DECAY = 2.5;

/** Map a raw Flesch Reading Ease value to the 0..100 band sub-score (pure). */
export function readabilityBandScore(flesch: number): number {
  if (flesch >= READABILITY_IDEAL_MIN && flesch <= READABILITY_IDEAL_MAX) {
    return 100;
  }
  const distance =
    flesch < READABILITY_IDEAL_MIN
      ? READABILITY_IDEAL_MIN - flesch
      : flesch - READABILITY_IDEAL_MAX;
  return round2(clamp(100 - READABILITY_DECAY * distance));
}

/**
 * Readability sub-score: Flesch Reading Ease
 *   206.835 − 1.015*(words/sentences) − 84.6*(syllables/words)
 * mapped through {@link readabilityBandScore} so clarity-appropriate-to-purpose
 * prose scores highest and both extremes (over-simple / impenetrable) decay.
 */
export function scoreReadability(text: string): number {
  const sentences = splitSentences(text);
  const tokens = alphaTokens(text);
  if (sentences.length === 0 || tokens.length === 0) return 0;

  const syllables = tokens.reduce((sum, w) => sum + countSyllables(w), 0);
  const wordsPerSentence = tokens.length / sentences.length;
  const syllablesPerWord = syllables / tokens.length;

  const flesch = 206.835 - 1.015 * wordsPerSentence - 84.6 * syllablesPerWord;
  return readabilityBandScore(flesch);
}

// ---------------------------------------------------------------------------
// Combine + blend
// ---------------------------------------------------------------------------

/**
 * Weighted total of a per-dimension breakdown, plus the +5 bonus when
 * vocabulary, structure AND relevance are all >= the bonus threshold. Result
 * is clamped to 0..100.
 */
export function combineDimensions(dimensions: EssayDimensionScores): {
  total: number;
  bonusApplied: boolean;
} {
  let weighted = 0;
  for (const dim of DIMENSIONS) {
    weighted += dimensions[dim] * ESSAY_SCORE_WEIGHTS[dim];
  }
  const bonusApplied =
    dimensions.vocabulary >= ESSAY_BONUS_THRESHOLD &&
    dimensions.structure >= ESSAY_BONUS_THRESHOLD &&
    dimensions.relevance >= ESSAY_BONUS_THRESHOLD;
  const total = clamp(weighted + (bonusApplied ? ESSAY_BONUS_POINTS : 0));
  return { total: round2(total), bonusApplied };
}

/**
 * Score an essay with the deterministic engine alone. This is the guaranteed
 * floor used both directly (AI-off / fallback) and as the base for a hybrid
 * blend. Pure: text + prompt reference keywords in, scores out.
 */
export function scoreDeterministic(
  essay: string,
  prompt: EssayPromptRef,
  opts: { isKnownWord?: IsKnownWord } = {},
): DeterministicScore {
  const dimensions: EssayDimensionScores = {
    grammar: scoreGrammar(essay),
    spelling: scoreSpelling(essay, opts.isKnownWord),
    punctuation: scorePunctuation(essay),
    readability: scoreReadability(essay),
    vocabulary: scoreVocabulary(essay),
    structure: scoreStructure(essay),
    relevance: scoreRelevance(essay, prompt.referenceKeywords),
  };
  const { total, bonusApplied } = combineDimensions(dimensions);
  return { dimensions, total, bonusApplied, ...computeTextStats(essay) };
}

/**
 * Blend a partial AI analysis into a deterministic breakdown using PER-DIMENSION
 * weights. A dimension is blended only when the AI supplies a finite value AND
 * the blend map has a weight for it: `det*(1 - b) + ai*b`. Dimensions without a
 * blend weight (i.e. mechanics — grammar/spelling/punctuation/readability) stay
 * fully deterministic even if the AI returns a value for them, so the LLM can
 * never touch mechanics. The total is recomputed (with the bonus) from the
 * blended breakdown.
 *
 * Pure and general: the policy of which dimensions are AI-influenced lives
 * entirely in the `blend` map (default {@link ESSAY_AI_BLEND}).
 */
export function blendHybrid(
  aiDimensions: Partial<EssayDimensionScores>,
  deterministic: EssayDimensionScores,
  blend: Partial<Record<EssayScoreDimension, number>> = ESSAY_AI_BLEND,
): BlendedScore {
  const dimensions = { ...deterministic };
  for (const dim of DIMENSIONS) {
    const ai = aiDimensions[dim];
    const b = blend[dim];
    if (typeof ai === "number" && Number.isFinite(ai) && typeof b === "number") {
      const bb = clamp(b, 0, 1);
      dimensions[dim] = round2(clamp(deterministic[dim] * (1 - bb) + ai * bb));
    }
  }
  const { total, bonusApplied } = combineDimensions(dimensions);
  return { dimensions, total, bonusApplied };
}
