/**
 * Step 34 — pure tests for the interview turn-loop model + B1 prefetch predicate.
 * Covers: the phase machine (intro→asking→answering→thinking→asking…→done), a
 * follow-up appearing INLINE after an answer (the server splices it and returns it
 * as the next turn with isFollowUp=true), and the prefetch HIT (the disclosed next
 * main question equals the one peeked during the answer).
 */
import type {
  InterviewCurrentResponse,
  InterviewNextMain,
  SubmitInterviewAnswerResponse,
} from "@codeapt/shared";
import { describe, expect, it } from "vitest";

import {
  INITIAL_INTERVIEW_STATE,
  interviewReducer,
  isInterviewDone,
  nextSpokenQuestion,
  wasPrefetchHit,
} from "../src/lib/interview-runner.js";

const turn = (
  index: number,
  over: Partial<InterviewCurrentResponse["turn"] & object> = {},
): NonNullable<InterviewCurrentResponse["turn"]> => ({
  index,
  question: `Q${index}`,
  category: "behavioural",
  isFollowUp: false,
  source: "llm",
  promptAudioUrl: "",
  answerWindowSeconds: 120,
  prepSeconds: 20,
  ...over,
});

const current = (
  over: Partial<InterviewCurrentResponse> = {},
): InterviewCurrentResponse => ({
  attemptId: "a1",
  status: "in_progress",
  totalTurns: 2,
  currentIndex: 0,
  expiresAt: "",
  remainingSeconds: 1000,
  expired: false,
  turn: turn(0),
  nextMainQuestion: { index: 1, question: "Q1", category: "technical" },
  ...over,
});

const submitRes = (
  over: Partial<SubmitInterviewAnswerResponse> = {},
): SubmitInterviewAnswerResponse => ({
  index: 0,
  followUpAdded: false,
  current: current({ currentIndex: 1, turn: turn(1, { category: "technical" }), nextMainQuestion: null }),
  ...over,
});

describe("interviewReducer — phase machine", () => {
  it("start → asking, then question_spoken → answering, then submitting → thinking", () => {
    let s = interviewReducer(INITIAL_INTERVIEW_STATE, {
      type: "started",
      current: current(),
    });
    expect(s.phase).toBe("asking");
    expect(s.prefetched).toEqual({ index: 1, question: "Q1", category: "technical" });
    s = interviewReducer(s, { type: "question_spoken" });
    expect(s.phase).toBe("answering");
    s = interviewReducer(s, { type: "answer_submitting" });
    expect(s.phase).toBe("thinking");
  });

  it("an answered turn advances and counts; a scored envelope ends the interview", () => {
    let s = interviewReducer(INITIAL_INTERVIEW_STATE, { type: "started", current: current() });
    s = interviewReducer(s, {
      type: "answered",
      response: submitRes(), // advances to turn 1, no follow-up
    });
    expect(s.turnsAnswered).toBe(1);
    expect(s.followUpsSeen).toBe(0);
    expect(s.phase).toBe("asking");
    expect(s.current?.currentIndex).toBe(1);

    // Answering the last turn → server returns a scored envelope → done.
    s = interviewReducer(s, {
      type: "answered",
      response: submitRes({
        index: 1,
        current: current({ status: "scored", turn: null, nextMainQuestion: null }),
      }),
    });
    expect(s.phase).toBe("done");
    expect(s.finished).toBe(true);
    expect(s.turnsAnswered).toBe(2);
  });

  it("a follow-up appears INLINE: the next disclosed turn is a follow-up and is counted", () => {
    let s = interviewReducer(INITIAL_INTERVIEW_STATE, { type: "started", current: current() });
    const followUp = submitRes({
      followUpAdded: true,
      current: current({
        currentIndex: 1,
        turn: turn(1, { isFollowUp: true, question: "Probe?" }),
        // the main Q1 is still ahead → still peekable
        nextMainQuestion: { index: 2, question: "Q1", category: "technical" },
      }),
    });
    s = interviewReducer(s, { type: "answered", response: followUp });
    expect(s.followUpsSeen).toBe(1);
    expect(s.current?.turn?.isFollowUp).toBe(true);
    expect(nextSpokenQuestion(s.current!)).toEqual({ question: "Probe?", isFollowUp: true });
  });
});

describe("wasPrefetchHit — B1: next question ready before submit returns", () => {
  const prefetched: InterviewNextMain = { index: 1, question: "Q1", category: "technical" };

  it("HITs when no follow-up landed and the disclosed turn is the prefetched main question", () => {
    expect(wasPrefetchHit(prefetched, submitRes())).toBe(true);
  });
  it("MISSes when a follow-up was spliced in (that turn couldn't be prefetched)", () => {
    const withFollowUp = submitRes({
      followUpAdded: true,
      current: current({ currentIndex: 1, turn: turn(1, { isFollowUp: true }) }),
    });
    expect(wasPrefetchHit(prefetched, withFollowUp)).toBe(false);
  });
  it("MISSes when nothing was prefetched", () => {
    expect(wasPrefetchHit(null, submitRes())).toBe(false);
  });
});

describe("isInterviewDone", () => {
  it("is true for scored / expired / no-turn envelopes", () => {
    expect(isInterviewDone(current({ status: "scored" }))).toBe(true);
    expect(isInterviewDone(current({ expired: true }))).toBe(true);
    expect(isInterviewDone(current({ turn: null }))).toBe(true);
    expect(isInterviewDone(current())).toBe(false);
  });
});
