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
  currentTurnIndex,
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

describe("turn-index tracking — the real loop (Step-34.2 stale-index regression)", () => {
  // This drives the loop the way the COMPONENT now must: the submit index is read
  // from currentTurnIndex(state) EVERY turn, and each server response advances the
  // state. If the runner ever reverts to a captured index, this sequence breaks.
  it("submits the LIVE index 0 → 1 (follow-up) → 2, never repeating", () => {
    let s = interviewReducer(INITIAL_INTERVIEW_STATE, {
      type: "started",
      current: current({
        currentIndex: 0,
        turn: turn(0),
        nextMainQuestion: { index: 1, question: "Q1", category: "technical" },
      }),
    });
    const serverResponses: SubmitInterviewAnswerResponse[] = [
      // answer 0 → a follow-up is spliced at index 1; the main shifts to 2.
      submitRes({
        index: 0,
        followUpAdded: true,
        current: current({
          currentIndex: 1,
          turn: turn(1, { isFollowUp: true, question: "Probe?" }),
          nextMainQuestion: { index: 2, question: "Q1", category: "technical" },
        }),
      }),
      // answer 1 (the follow-up) → the next main at index 2.
      submitRes({
        index: 1,
        followUpAdded: false,
        current: current({
          currentIndex: 2,
          turn: turn(2, { category: "technical" }),
          nextMainQuestion: null,
        }),
      }),
      // answer 2 → scored / done.
      submitRes({
        index: 2,
        followUpAdded: false,
        current: current({ status: "scored", turn: null, nextMainQuestion: null }),
      }),
    ];

    const submitted: number[] = [];
    let i = 0;
    while (currentTurnIndex(s) !== null) {
      const idx = currentTurnIndex(s)!; // the runner's ONLY index source
      submitted.push(idx);
      const res = serverResponses[i]!;
      // The client must submit exactly the index the server is waiting on.
      expect(res.index).toBe(idx);
      s = interviewReducer(s, { type: "answered", response: res });
      i += 1;
    }
    expect(submitted).toEqual([0, 1, 2]);
    expect(s.finished).toBe(true);
  });

  it("a stale-index 409 recovers via resync: realign to the server's turn, no counter bump", () => {
    let s = interviewReducer(INITIAL_INTERVIEW_STATE, {
      type: "started",
      current: current({ currentIndex: 0, turn: turn(0) }),
    });
    const answeredBefore = s.turnsAnswered;
    // The server has already advanced to a follow-up at index 1 (our submit of 0
    // 409'd). The runner fetches fresh `current` and resyncs.
    const fresh = current({
      currentIndex: 1,
      turn: turn(1, { isFollowUp: true }),
      nextMainQuestion: { index: 2, question: "Q1", category: "technical" },
    });
    s = interviewReducer(s, { type: "resynced", current: fresh });
    expect(currentTurnIndex(s)).toBe(1); // now submits 1, not the stale 0
    expect(s.turnsAnswered).toBe(answeredBefore); // resync is not an answer
    expect(s.phase).toBe("asking"); // re-asks the resynced turn, never spins
    expect(s.finished).toBe(false);
  });

  it("currentTurnIndex is null once finished/expired (loop terminates)", () => {
    const done = interviewReducer(INITIAL_INTERVIEW_STATE, {
      type: "started",
      current: current({ status: "scored", turn: null }),
    });
    expect(currentTurnIndex(done)).toBeNull();
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
