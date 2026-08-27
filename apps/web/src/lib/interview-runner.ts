/**
 * PURE turn-loop model for the interview runner (Step 34 A1). The loop is
 * SERVER-driven (start → current; submit → {index, followUpAdded, current}); this
 * module holds the client phase machine and the B1 prefetch bookkeeping so the
 * React runner is a thin shell over it and the logic is unit-tested (node, no DOM).
 *
 * Key behaviours modelled: follow-ups appear INLINE (the server splices one in and
 * returns it as the next `current.turn` with isFollowUp=true — the client just
 * speaks it); and the next MAIN question is peeked via `current.nextMainQuestion`
 * so it can be pre-synthesized during the answer (B1).
 */
import type {
  InterviewCurrentResponse,
  InterviewNextMain,
  SubmitInterviewAnswerResponse,
} from "@codeapt/shared";

export type InterviewPhase =
  | "intro" // pre-flight / intake, before the first question
  | "asking" // the avatar is speaking the question
  | "answering" // the student is speaking; live transcript
  | "thinking" // answer submitted; awaiting the server (never dead air)
  | "done"; // interview finished (scored or expired)

export interface InterviewRunnerState {
  readonly phase: InterviewPhase;
  readonly current: InterviewCurrentResponse | null;
  readonly turnsAnswered: number;
  readonly followUpsSeen: number;
  readonly finished: boolean;
  /** The next MAIN question, peeked so its TTS can be pre-synthesized (B1). */
  readonly prefetched: InterviewNextMain | null;
  /** True once the prefetched question's TTS has been synthesized ahead of time. */
  readonly prefetchSynthesized: boolean;
}

export type InterviewEvent =
  | { type: "started"; current: InterviewCurrentResponse }
  | { type: "question_spoken" }
  | { type: "answer_submitting" }
  | { type: "answered"; response: SubmitInterviewAnswerResponse }
  | { type: "prefetch_synthesized" };

export const INITIAL_INTERVIEW_STATE: InterviewRunnerState = {
  phase: "intro",
  current: null,
  turnsAnswered: 0,
  followUpsSeen: 0,
  finished: false,
  prefetched: null,
  prefetchSynthesized: false,
};

/** A disclosed envelope is terminal when it is scored/expired or has no turn. */
export function isInterviewDone(current: InterviewCurrentResponse): boolean {
  return current.status === "scored" || current.expired || current.turn === null;
}

export function interviewReducer(
  state: InterviewRunnerState,
  event: InterviewEvent,
): InterviewRunnerState {
  switch (event.type) {
    case "started": {
      const done = isInterviewDone(event.current);
      return {
        ...state,
        current: event.current,
        phase: done ? "done" : "asking",
        finished: done,
        prefetched: done ? null : event.current.nextMainQuestion,
        prefetchSynthesized: false,
      };
    }
    case "question_spoken":
      return state.phase === "asking" ? { ...state, phase: "answering" } : state;
    case "answer_submitting":
      return state.phase === "answering" ? { ...state, phase: "thinking" } : state;
    case "answered": {
      const { response } = event;
      const done = isInterviewDone(response.current);
      return {
        ...state,
        current: response.current,
        turnsAnswered: state.turnsAnswered + 1,
        followUpsSeen: state.followUpsSeen + (response.followUpAdded ? 1 : 0),
        phase: done ? "done" : "asking",
        finished: done,
        prefetched: done ? null : response.current.nextMainQuestion,
        prefetchSynthesized: false,
      };
    }
    case "prefetch_synthesized":
      return { ...state, prefetchSynthesized: true };
    default:
      return state;
  }
}

/**
 * The B1 test predicate: did the prefetch HIT — i.e. was the turn the server
 * disclosed after a submit exactly the MAIN question we had already fetched (and
 * pre-synthesized) during the answer? True only when no follow-up was inserted
 * and the disclosed turn is that same main question. When true, the runner speaks
 * with NO post-submit fetch or synthesis; when false (a follow-up landed) it
 * speaks the freshly-returned follow-up instead.
 */
export function wasPrefetchHit(
  prefetched: InterviewNextMain | null,
  response: SubmitInterviewAnswerResponse,
): boolean {
  const turn = response.current.turn;
  return (
    !response.followUpAdded &&
    !!prefetched &&
    !!turn &&
    !turn.isFollowUp &&
    turn.index === prefetched.index
  );
}

/** What the avatar should speak next, given the disclosed turn — the follow-up
 *  (LLM-fresh) or the (possibly prefetched) main question. Null when done. */
export function nextSpokenQuestion(
  current: InterviewCurrentResponse,
): { question: string; isFollowUp: boolean } | null {
  if (!current.turn) return null;
  return { question: current.turn.question, isFollowUp: current.turn.isFollowUp };
}
