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

/** One line of the running conversation transcript (Step 36 A). The interviewer's
 *  greeting/acknowledgement/closing are DISTINCT `kind`s from a `question`, so the
 *  UI can style them apart — and so a test can assert they were actually threaded
 *  (the Step-35 wiring gap: they reached the runner but were only shown for the
 *  sub-second "asking" phase, with no persistent surface). */
export interface InterviewMessage {
  readonly id: number;
  readonly role: "interviewer" | "candidate";
  readonly kind: "greeting" | "acknowledgement" | "question" | "answer" | "closing";
  readonly text: string;
}

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
  /** The visible conversation transcript, built as events flow (Step 36 A). */
  readonly messages: readonly InterviewMessage[];
  /** Monotonic id source for messages (deterministic for tests). */
  readonly nextMessageId: number;
}

export type InterviewEvent =
  // `greeting` is the interviewer's opening line (from the start payload); it
  // seeds the transcript so it's never lost after the "asking" phase.
  | { type: "started"; current: InterviewCurrentResponse; greeting?: string }
  | { type: "question_spoken" }
  | { type: "answer_submitting" }
  // `answerText` is the candidate's (corrected) transcript, logged before the
  // interviewer's acknowledgement so the conversation reads in order.
  | { type: "answered"; response: SubmitInterviewAnswerResponse; answerText?: string }
  | { type: "prefetch_synthesized" }
  // Re-sync to the server's authoritative `current` after a stale submit (409
  // NOT_CURRENT_TURN). Does NOT touch counters — nothing was newly answered, we
  // just realign; the runner then re-asks whatever turn the server is really on.
  | { type: "resynced"; current: InterviewCurrentResponse };

export const INITIAL_INTERVIEW_STATE: InterviewRunnerState = {
  phase: "intro",
  current: null,
  turnsAnswered: 0,
  followUpsSeen: 0,
  finished: false,
  prefetched: null,
  prefetchSynthesized: false,
  messages: [],
  nextMessageId: 0,
};

/** Append transcript messages immutably, assigning monotonic ids. Empty-text
 *  entries are skipped so an absent greeting/ack never leaves a blank line. */
function pushMessages(
  state: InterviewRunnerState,
  entries: ReadonlyArray<Omit<InterviewMessage, "id">>,
): Pick<InterviewRunnerState, "messages" | "nextMessageId"> {
  let id = state.nextMessageId;
  const added: InterviewMessage[] = [];
  for (const e of entries) {
    if (e.text.trim() === "") continue;
    added.push({ ...e, id: id++ });
  }
  return {
    messages: added.length ? [...state.messages, ...added] : state.messages,
    nextMessageId: id,
  };
}

/** The last interviewer QUESTION text in the transcript (to avoid re-logging the
 *  same question on a resync). */
function lastQuestionText(state: InterviewRunnerState): string {
  for (let i = state.messages.length - 1; i >= 0; i -= 1) {
    if (state.messages[i]!.kind === "question") return state.messages[i]!.text;
  }
  return "";
}

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
      // Seed the transcript: the greeting (interviewer), then the first question.
      const seed = pushMessages(state, [
        { role: "interviewer", kind: "greeting", text: event.greeting ?? "" },
        {
          role: "interviewer",
          kind: "question",
          text: done ? "" : (event.current.turn?.question ?? ""),
        },
      ]);
      return {
        ...state,
        ...seed,
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
      // Log, in conversational order: the candidate's answer → the interviewer's
      // acknowledgement → then either the closing (done) or the next question.
      const entries: ReadonlyArray<Omit<InterviewMessage, "id">> = [
        { role: "candidate", kind: "answer", text: event.answerText ?? "" },
        { role: "interviewer", kind: "acknowledgement", text: response.acknowledgement ?? "" },
        done
          ? { role: "interviewer", kind: "closing", text: response.closing ?? "" }
          : { role: "interviewer", kind: "question", text: response.current.turn?.question ?? "" },
      ];
      return {
        ...state,
        ...pushMessages(state, entries),
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
    case "resynced": {
      const done = isInterviewDone(event.current);
      // Only log the re-asked question if it isn't already the last one shown.
      const q = done ? "" : (event.current.turn?.question ?? "");
      const seed =
        q && q !== lastQuestionText(state)
          ? pushMessages(state, [{ role: "interviewer", kind: "question", text: q }])
          : { messages: state.messages, nextMessageId: state.nextMessageId };
      return {
        ...state,
        ...seed,
        current: event.current,
        phase: done ? "done" : "asking",
        finished: done,
        prefetched: done ? null : event.current.nextMainQuestion,
        prefetchSynthesized: false,
      };
    }
    default:
      return state;
  }
}

/** The index the runner must submit for the CURRENT turn — always read from the
 *  live reducer state, never a captured constant (the Step-34.2 stale-index bug).
 *  Null when finished/expired/no-turn. */
export function currentTurnIndex(state: InterviewRunnerState): number | null {
  const c = state.current;
  if (!c || !c.turn || c.expired || state.finished) return null;
  return c.currentIndex;
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
