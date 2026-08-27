// @vitest-environment jsdom
/**
 * Step 36 A/B — REAL component render tests. The Step-35 suite only exercised pure
 * functions, so greeting/ack and the observation results could be wired wrong and
 * still pass. These render the actual components and assert on what the USER sees:
 * the transcript shows the greeting + acknowledgement distinctly from questions,
 * and the report shows the observation sentences.
 */
import type { MockInterviewAttemptResult } from "@codeapt/shared";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { InterviewTranscript } from "../src/components/interview/InterviewTranscript.js";
import { InterviewResults } from "../src/components/interview/InterviewResults.js";
import type { InterviewMessage } from "../src/lib/interview-runner.js";
import type { SessionObservations } from "../src/lib/camera-observation.js";
import type { InterviewEngine } from "../src/lib/interview-engine.js";

afterEach(cleanup);

describe("InterviewTranscript renders interviewer glue distinctly (A)", () => {
  const messages: InterviewMessage[] = [
    { id: 0, role: "interviewer", kind: "greeting", text: "Hello Vinay, thanks for joining me today." },
    { id: 1, role: "interviewer", kind: "question", text: "Tell me about AAMS." },
    { id: 2, role: "candidate", kind: "answer", text: "It is a MERN attendance system." },
    { id: 3, role: "interviewer", kind: "acknowledgement", text: "Thanks for walking me through that." },
    { id: 4, role: "interviewer", kind: "closing", text: "That's everything — thank you." },
  ];

  it("shows the greeting, acknowledgement, question and closing", () => {
    render(<InterviewTranscript messages={messages} />);
    expect(screen.getByText(/Hello Vinay/)).toBeTruthy();
    expect(screen.getByText(/Thanks for walking me through that/)).toBeTruthy();
    expect(screen.getByText(/Tell me about AAMS/)).toBeTruthy();
    expect(screen.getByText(/That's everything/)).toBeTruthy();
  });

  it("marks greeting/ack as a different kind than the question (visually distinct)", () => {
    const { container } = render(<InterviewTranscript messages={messages} />);
    expect(container.querySelector('[data-kind="greeting"]')).not.toBeNull();
    expect(container.querySelector('[data-kind="acknowledgement"]')).not.toBeNull();
    expect(container.querySelector('[data-kind="question"]')).not.toBeNull();
    // greeting and question are rendered under distinct kinds (not conflated).
    const greeting = container.querySelector('[data-kind="greeting"]')!;
    const question = container.querySelector('[data-kind="question"]')!;
    expect(greeting).not.toBe(question);
  });
});

describe("InterviewResults renders observation sentences (B)", () => {
  const result: MockInterviewAttemptResult = {
    attemptId: "a1",
    status: "scored",
    complete: true,
    role: "Backend Engineer",
    seniority: "mid",
    dimensions: { speaking: 80, vocabulary: 75, concept: 70, analysis: 72, topicKnowledge: 68 },
    overall: 74,
    source: "ai_hybrid",
    approximate: true,
    summary: "Overall 74/100.",
    perQuestion: [],
    terminated: false,
    terminatedReason: null,
  };
  const engine = {
    result: () => Promise.resolve(result),
  } as unknown as InterviewEngine;

  const observations: SessionObservations = {
    available: true,
    pctLookingAway: 38,
    secondsOutOfFrame: 12,
    stillnessScore: 80,
    smiled: true,
    maxFaces: 1,
    answersWithData: 3,
    longPauses: [{ index: 2, seconds: 7 }],
    sentences: [
      "You looked away from the camera for about 38% of the time you were answering.",
      "You were out of frame for about 12s in total.",
      "You paused for about 7s before answering question 3.",
    ],
  };

  it("shows the plain-language presence observations in the report", async () => {
    render(<InterviewResults engine={engine} attemptId="a1" observations={observations} />);
    expect(await screen.findByText(/looked away from the camera for about 38%/)).toBeTruthy();
    expect(screen.getByText(/out of frame for about 12s/)).toBeTruthy();
    expect(screen.getByText(/paused for about 7s before answering question 3/)).toBeTruthy();
  });

  it("still shows nothing observation-y when there were no observations and no pauses", async () => {
    const empty: SessionObservations = {
      available: false,
      pctLookingAway: 0,
      secondsOutOfFrame: 0,
      stillnessScore: 0,
      smiled: false,
      maxFaces: 0,
      answersWithData: 0,
      longPauses: [],
      sentences: [],
    };
    render(<InterviewResults engine={engine} attemptId="a1" observations={empty} />);
    // The report itself renders (summary), but no presence card / sentences.
    expect(await screen.findByText(/Backend Engineer interview/)).toBeTruthy();
    expect(screen.queryByTestId("observation-sentences")).toBeNull();
  });
});
