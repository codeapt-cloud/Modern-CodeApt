/**
 * Pure email-writing scoring engine (Communication module, Round 2 scenario
 * email). No I/O, no DOM, no randomness — like {@link ./essay.ts} every function
 * is a deterministic function of its inputs, so the whole engine is exhaustively
 * unit-testable and identical on the API, the worker, and the web client.
 *
 * The email rubric EXTENDS the essay engine, it does not replace it. The four
 * mechanics dimensions — grammar, spelling, punctuation, readability — are the
 * SAME analyzers imported verbatim from the essay engine (identical concerns,
 * one implementation, so an email score is directly comparable to an essay
 * score). The three essay "meaning" dimensions are swapped for four
 * email-specific ones:
 *   - `format`   — subject line, salutation, sign-off, paragraphing, length.
 *   - `register` — no contractions / slang / ALL-CAPS shouting.
 *   - `content`  — addresses the scenario, with a clear call-to-action.
 *   - `tone`     — courteous and appropriate for the recipient.
 *
 * `format` and `register` are genuinely checkable, so they are DETERMINISTIC
 * ONLY. `content` and `tone` have a real deterministic baseline (keyword
 * coverage / a politeness heuristic) that the LLM only *refines* — exactly the
 * `blendHybrid` discipline of the essay engine: mechanics AND structure can
 * never be touched by a model, and a deterministic-only score is always a
 * complete, honest result. Weights live in EMAIL_SCORE_WEIGHTS (Σ = 1.00).
 */
import {
  EMAIL_AI_BLEND,
  EMAIL_BONUS_DIMENSIONS,
  EMAIL_SCORE_WEIGHTS,
  ESSAY_BONUS_POINTS,
  ESSAY_BONUS_THRESHOLD,
  type EmailScoreDimension,
} from "./constants.js";
import {
  computeTextStats,
  countParagraphs,
  scoreGrammar,
  scorePunctuation,
  scoreReadability,
  scoreRelevance,
  scoreSpelling,
  type EssayTextStats,
  type IsKnownWord,
} from "./essay.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A 0..100 sub-score for each of the eight weighted email dimensions. */
export type EmailDimensionScores = Record<EmailScoreDimension, number>;

/** The prompt-side inputs the deterministic engine reads (admin-owned data). */
export interface EmailPromptRef {
  /**
   * Keywords the scenario-coverage (`content`) analyzer measures against —
   * the same admin-only field the essay relevance analyzer uses. Never sent to
   * a student.
   */
  readonly referenceKeywords: readonly string[];
}

/** Result of the deterministic engine: per-dimension breakdown + total. */
export interface DeterministicEmailScore extends EssayTextStats {
  readonly dimensions: EmailDimensionScores;
  /** 0..100 weighted total, including the bonus if earned. */
  readonly total: number;
  readonly bonusApplied: boolean;
}

/** Result of blending an AI analysis into a deterministic email breakdown. */
export interface BlendedEmailScore {
  readonly dimensions: EmailDimensionScores;
  readonly total: number;
  readonly bonusApplied: boolean;
}

// ---------------------------------------------------------------------------
// Small numeric helpers (mirrors essay.ts; kept local so this module is
// self-contained and the essay engine stays untouched).
// ---------------------------------------------------------------------------

const clamp = (n: number, lo = 0, hi = 100): number =>
  Math.min(hi, Math.max(lo, n));

const round2 = (n: number): number => Math.round(n * 100) / 100;

const DIMENSIONS = Object.keys(EMAIL_SCORE_WEIGHTS) as EmailScoreDimension[];

/**
 * A 0..100 band score: 100 inside [lo, hi], decaying linearly outside it. Used
 * for "appropriate length" the way the essay engine bands readability.
 */
function bandScore(
  value: number,
  lo: number,
  hi: number,
  decayPerUnit: number,
): number {
  if (value >= lo && value <= hi) return 100;
  const distance = value < lo ? lo - value : value - hi;
  return clamp(100 - distance * decayPerUnit);
}

// ---------------------------------------------------------------------------
// Reference lists (small, deliberately illustrative — a deterministic signal,
// not a complete lexicon; same philosophy as the essay word lists).
// ---------------------------------------------------------------------------

/** Contractions that a formal email should avoid. */
const CONTRACTION_RE =
  /\b(?:\w+n't|i'm|it's|you're|we're|they're|he's|she's|that's|there's|let's|i'll|we'll|you'll|they'll|he'll|she'll|i'd|we'd|you'd|i've|we've|you've|they've)\b/gi;

/** Casual / slang tokens inappropriate in a professional email. */
const SLANG = new Set([
  "gonna",
  "wanna",
  "gotta",
  "yeah",
  "yep",
  "nope",
  "hey",
  "lol",
  "kinda",
  "sorta",
  "dunno",
  "cuz",
  "coz",
  "u",
  "ur",
  "pls",
  "plz",
  "thx",
  "guys",
  "stuff",
  "awesome",
  "cool",
  "ok",
  "okay",
  "asap",
]);

/** Acronyms that are legitimately upper-case and must not count as shouting. */
const ACRONYM_ALLOW = new Set([
  "OK",
  "FYI",
  "ASAP",
  "EOD",
  "CEO",
  "CTO",
  "HR",
  "IT",
  "PDF",
  "URL",
  "FAQ",
  "ID",
  "PR",
  "QA",
  "USA",
  "UK",
  "AM",
  "PM",
]);

/** Courtesy markers that lift the deterministic tone baseline. */
const POLITE_MARKERS = [
  "please",
  "thank you",
  "thanks",
  "kindly",
  "appreciate",
  "grateful",
  "request",
  "regards",
  "sincerely",
  "apologies",
  "apologize",
];

const GREETING_RE =
  /^\s*(?:dear|hi|hello|hey|respected|greetings|good\s+(?:morning|afternoon|evening))\b/i;

const SIGNOFF_RE =
  /\b(?:regards|sincerely|thanks|thank you|best(?:\s+regards|\s+wishes)?|yours\s+(?:truly|sincerely|faithfully)|cheers|respectfully|warm\s+regards)\b/i;

const SUBJECT_RE = /^\s*subject\s*:\s*(.*)$/im;

// ---------------------------------------------------------------------------
// Email-specific deterministic analyzers (0..100)
// ---------------------------------------------------------------------------

/** Non-empty lines, trimmed — the working unit for salutation / sign-off. */
function nonEmptyLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

/**
 * Email shape: subject line, salutation, sign-off, body paragraphing, and an
 * appropriate length. Each sub-check is 0..1 and combined by fixed intra-format
 * weights that sum to 1.
 */
export function scoreEmailFormat(text: string): number {
  const lines = nonEmptyLines(text);

  // Subject: a "Subject: ..." line with non-trivial content.
  const subjectMatch = SUBJECT_RE.exec(text);
  const subject = subjectMatch
    ? (subjectMatch[1]?.trim().length ?? 0) >= 3
      ? 1
      : 0.4
    : 0;

  // Salutation: the first non-subject line opens with a greeting.
  const bodyLines = subjectMatch
    ? lines.filter((l) => !/^\s*subject\s*:/i.test(l))
    : lines;
  const salutation = bodyLines.length > 0 && GREETING_RE.test(bodyLines[0]!) ? 1 : 0;

  // Sign-off: a closing phrase appears in the last third of the body.
  const tail = bodyLines.slice(Math.max(0, Math.floor(bodyLines.length * 0.66)));
  const signoff = tail.some((l) => SIGNOFF_RE.test(l)) ? 1 : 0;

  // Body paragraphing: 2+ blocks (greeting / body / closing) reads as structured.
  const paras = countParagraphs(text);
  const structure = paras >= 2 ? 1 : paras === 1 ? 0.5 : 0;

  // Appropriate length: a professional email sits ~40–250 words.
  const words = computeTextStats(text).wordCount;
  const length = bandScore(words, 40, 250, 1.2) / 100;

  const score =
    subject * 0.28 +
    salutation * 0.22 +
    signoff * 0.22 +
    structure * 0.14 +
    length * 0.14;
  return round2(clamp(score * 100));
}

/**
 * Register: formality. Starts at 100 and deducts for contractions, slang, and
 * ALL-CAPS shouting — the mechanical formality signals the CTS rubric names.
 */
export function scoreEmailRegister(text: string): number {
  const contractions = text.match(CONTRACTION_RE)?.length ?? 0;

  const lowerTokens = text.toLowerCase().match(/[a-z']+/g) ?? [];
  const slang = lowerTokens.filter((t) => SLANG.has(t)).length;

  const shouting = (text.match(/\b[A-Z]{3,}\b/g) ?? []).filter(
    (t) => !ACRONYM_ALLOW.has(t),
  ).length;

  const penalty =
    Math.min(40, contractions * 8) +
    Math.min(40, slang * 10) +
    Math.min(30, shouting * 10);
  return round2(clamp(100 - penalty));
}

/**
 * Tone (deterministic baseline). A courtesy heuristic the LLM later refines for
 * recipient-appropriateness: a neutral base lifted by polite markers and a
 * proper greeting+closing, pulled down by shouting. Kept genuinely 0..100 so
 * the deterministic-only grade is honest when the AI is unavailable.
 */
export function scoreEmailToneBaseline(text: string): number {
  const lower = text.toLowerCase();
  const politeHits = POLITE_MARKERS.filter((m) => lower.includes(m)).length;
  const politeness = Math.min(30, politeHits * 10);

  const lines = nonEmptyLines(text);
  const hasGreeting = lines.length > 0 && GREETING_RE.test(lines[0]!);
  const hasClosing = lines.some((l) => SIGNOFF_RE.test(l));
  const courtesy = (hasGreeting ? 8 : 0) + (hasClosing ? 8 : 0);

  const shouting = (text.match(/\b[A-Z]{3,}\b/g) ?? []).filter(
    (t) => !ACRONYM_ALLOW.has(t),
  ).length;
  const shoutPenalty = Math.min(30, shouting * 10);

  return round2(clamp(50 + politeness + courtesy - shoutPenalty));
}

// ---------------------------------------------------------------------------
// Combine + blend (mirrors essay.ts combineDimensions / blendHybrid, over the
// email dimension set + weights + bonus rule — the essay engine is untouched).
// ---------------------------------------------------------------------------

/**
 * Weighted total of an email breakdown, plus the +5 bonus when content, format,
 * AND tone are all >= the bonus threshold. Clamped to 0..100.
 */
export function combineEmailDimensions(dimensions: EmailDimensionScores): {
  total: number;
  bonusApplied: boolean;
} {
  let weighted = 0;
  for (const dim of DIMENSIONS) {
    weighted += dimensions[dim] * EMAIL_SCORE_WEIGHTS[dim];
  }
  const bonusApplied = EMAIL_BONUS_DIMENSIONS.every(
    (d) => dimensions[d] >= ESSAY_BONUS_THRESHOLD,
  );
  const total = clamp(weighted + (bonusApplied ? ESSAY_BONUS_POINTS : 0));
  return { total: round2(total), bonusApplied };
}

/**
 * Score an email with the deterministic engine alone — the guaranteed floor,
 * used directly (AI-off / fallback) and as the base for a hybrid blend. Pure:
 * email text + scenario reference keywords in, scores out.
 */
export function scoreEmailDeterministic(
  email: string,
  prompt: EmailPromptRef,
  opts: { isKnownWord?: IsKnownWord } = {},
): DeterministicEmailScore {
  const dimensions: EmailDimensionScores = {
    grammar: scoreGrammar(email),
    spelling: scoreSpelling(email, opts.isKnownWord),
    punctuation: scorePunctuation(email),
    readability: scoreReadability(email),
    format: scoreEmailFormat(email),
    register: scoreEmailRegister(email),
    content: scoreRelevance(email, prompt.referenceKeywords),
    tone: scoreEmailToneBaseline(email),
  };
  const { total, bonusApplied } = combineEmailDimensions(dimensions);
  return { dimensions, total, bonusApplied, ...computeTextStats(email) };
}

/**
 * Blend a partial AI analysis into a deterministic email breakdown using
 * per-dimension weights: `det*(1 - b) + ai*b`, and ONLY for dimensions the
 * blend map names (content, tone). Every other dimension — the four mechanics
 * plus `format` and `register` — stays fully deterministic even if the AI
 * returns a value for it, so the LLM can never touch mechanics or structure.
 * The total is recomputed (with the bonus) from the blended breakdown.
 */
export function blendEmailHybrid(
  aiDimensions: Partial<EmailDimensionScores>,
  deterministic: EmailDimensionScores,
  blend: Partial<Record<EmailScoreDimension, number>> = EMAIL_AI_BLEND,
): BlendedEmailScore {
  const dimensions = { ...deterministic };
  for (const dim of DIMENSIONS) {
    const ai = aiDimensions[dim];
    const b = blend[dim];
    if (typeof ai === "number" && Number.isFinite(ai) && typeof b === "number") {
      const bb = clamp(b, 0, 1);
      dimensions[dim] = round2(clamp(deterministic[dim] * (1 - bb) + ai * bb));
    }
  }
  const { total, bonusApplied } = combineEmailDimensions(dimensions);
  return { dimensions, total, bonusApplied };
}
