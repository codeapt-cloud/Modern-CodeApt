/**
 * PURE model of the conversational gap between an answer submit and the next
 * question starting to speak (Step 34 Part B). Browser STT + browser TTS already
 * removed the transcription and speech-out hops; what remained was the LLM work
 * on the submit round-trip. Two fixes are modelled here and measured in the test:
 *
 *  - B (server): grading and the follow-up decision are INDEPENDENT LLM calls, so
 *    they now run CONCURRENTLY — the round-trip is max(grade, followUp) instead of
 *    their sum.
 *  - B1 (client): the next MAIN question is peeked (current.nextMainQuestion) and
 *    pre-synthesized DURING the answer, so its TTS is entirely off the post-submit
 *    path (0 instead of ttsSynthMs).
 *
 * The runner still awaits the follow-up decision to know whether to speak a probe
 * or the (prefetched) main question — but a "thinking" avatar covers that wait, so
 * there is never dead air.
 */
export interface InterviewHopCosts {
  /** LLM grading of the answer just given. */
  readonly gradeMs: number;
  /** LLM adaptive-follow-up decision. */
  readonly followUpMs: number;
  /** Browser TTS synthesis of the next question. */
  readonly ttsSynthMs: number;
}

/** BEFORE: grade THEN follow-up (sequential) on the round-trip, THEN synthesize
 *  the next question once the response says which question to speak. */
export function sequentialGapMs(c: InterviewHopCosts): number {
  return c.gradeMs + c.followUpMs + c.ttsSynthMs;
}

/** AFTER: grade ∥ follow-up (concurrent round-trip) + the main question already
 *  synthesized during the answer (0 on the path). */
export function optimizedGapMs(c: InterviewHopCosts): number {
  return Math.max(c.gradeMs, c.followUpMs);
}

export function latencyImprovementMs(c: InterviewHopCosts): number {
  return sequentialGapMs(c) - optimizedGapMs(c);
}

/** Representative hop costs (ms) for the report's before/after numbers. */
export const REPRESENTATIVE_HOPS: InterviewHopCosts = {
  gradeMs: 1400,
  followUpMs: 1100,
  ttsSynthMs: 350,
};
