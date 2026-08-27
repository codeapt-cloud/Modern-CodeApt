/**
 * PURE conversational glue for the mock interview (Step 35 F). An interview should
 * not read like a form: it opens with a greeting, acknowledges each answer before
 * moving on, transitions naturally, and closes. The LLM generates these WITH the
 * questions / on the existing per-answer calls (no extra LLM call per turn — see
 * interview-ai). This module is the deterministic FALLBACK phrase bank used when
 * the AI is unavailable, plus the shared shape the AI fills.
 *
 * Determinism: selection is by a caller-supplied integer seed (the turn index),
 * never Date.now()/Math.random() — so a session is reproducible and tests are
 * stable. Acknowledgements are deliberately NEUTRAL: they signal "heard you, moving
 * on", never approval or a score ("good answer" is avoided — it would imply a grade).
 */

/** The conversational lines the AI produces alongside the questions. Every field
 *  is optional; a missing field falls back to the phrase bank. */
export interface InterviewConversation {
  /** Opening line, ideally using the candidate's first name. */
  readonly greeting: string;
  /** Closing line at the end of the interview. */
  readonly closing: string;
}

const norm = (s: string): string => s.trim().replace(/\s+/g, " ");

/** A safe first name for a greeting: the first whitespace-delimited token of the
 *  full name, letters/hyphen/apostrophe only, capped — or "" when unusable. */
export function firstNameFor(fullName: string | null | undefined): string {
  const first = norm(fullName ?? "").split(" ")[0] ?? "";
  const cleaned = first.replace(/[^A-Za-z'-]/g, "");
  return cleaned.slice(0, 40);
}

/** Neutral acknowledgements — "heard you, let's continue", never a verdict. */
const ACKNOWLEDGEMENTS: readonly string[] = [
  "Thanks for walking me through that.",
  "Got it — thank you.",
  "Okay, that gives me a clear picture.",
  "Thank you, that's helpful context.",
  "Understood — appreciate the detail.",
  "Right, thank you for explaining that.",
  "Noted — thanks.",
  "Okay, thank you for that.",
];

/** Transitions into the next question / a follow-up. */
const TRANSITIONS: readonly string[] = [
  "Let's move on.",
  "I'd like to explore something else.",
  "Building on that,",
  "Let me ask you about something different.",
  "Staying on this for a moment,",
  "Next,",
];

const FOLLOWUP_TRANSITIONS: readonly string[] = [
  "Let me dig into that a little.",
  "I'd like to go a bit deeper here.",
  "One more thing on that.",
  "Can we unpack that a little further?",
];

const CLOSINGS: readonly string[] = [
  "That's everything from me — thank you for your time today.",
  "That wraps up our interview. Thanks for talking me through your experience.",
  "We're all done. Thank you for taking the time.",
];

/** Deterministic index into a bank from a seed (never random). */
function pick(bank: readonly string[], seed: number): string {
  const i = ((Math.trunc(seed) % bank.length) + bank.length) % bank.length;
  return bank[i]!;
}

/** Greeting fallback. Uses the first name when we have a usable one. */
export function interviewGreeting(fullName?: string | null): string {
  const name = firstNameFor(fullName);
  return name
    ? `Hello ${name}, thanks for joining me today. Let's get started.`
    : "Hello, thanks for joining me today. Let's get started.";
}

/** Neutral per-answer acknowledgement (varied by turn index). */
export function interviewAcknowledgement(seed: number): string {
  return pick(ACKNOWLEDGEMENTS, seed);
}

/** Transition into the next spoken question (a follow-up gets its own phrasing). */
export function interviewTransition(seed: number, isFollowUp: boolean): string {
  return pick(isFollowUp ? FOLLOWUP_TRANSITIONS : TRANSITIONS, seed);
}

/** Closing fallback. */
export function interviewClosing(seed = 0): string {
  return pick(CLOSINGS, seed);
}

/**
 * Compose the full line the interviewer SPEAKS before a question: an optional
 * acknowledgement of the previous answer + the question. Both are trimmed and
 * joined with a single space; an empty acknowledgement yields just the question.
 * Kept pure so the runner is a thin caller and this is unit-tested.
 */
export function composeSpokenQuestion(
  acknowledgement: string | null | undefined,
  question: string,
): string {
  const ack = norm(acknowledgement ?? "");
  const q = norm(question);
  return ack ? `${ack} ${q}` : q;
}
