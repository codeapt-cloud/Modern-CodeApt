/**
 * Speech processor guarantees — idempotent + never rethrows. The Mongoose models
 * and the ASR client are mocked (the worker suite has no Mongo), so these tests
 * assert the CONTROL-FLOW contract: a malformed payload is dropped; an
 * already-finalized job is skipped without doing work; and an ASR failure is
 * caught, finalized as FAILED, and returned normally (never thrown), so BullMQ
 * does not retry over student audio.
 */
import { vi, afterEach, beforeEach, describe, expect, it } from "vitest";

import type * as AsrModule from "../src/lib/asr.js";

// --- Mock the models + the ASR client BEFORE importing the processor. The mock
//     fns live in vi.hoisted so they exist when the hoisted vi.mock factories run.
const {
  execFindOne,
  execUpdateOne,
  attemptFindById,
  attemptUpdateOne,
  assessmentFindById,
  asrTranscribe,
} = vi.hoisted(() => ({
  execFindOne: vi.fn(),
  execUpdateOne: vi.fn(async () => ({})),
  attemptFindById: vi.fn(),
  attemptUpdateOne: vi.fn(async () => ({})),
  assessmentFindById: vi.fn(),
  asrTranscribe: vi.fn(),
}));

vi.mock("../src/models/execution.model.js", () => ({
  ExecutionJobModel: {
    findOne: (...a: unknown[]) => execFindOne(...a),
    updateOne: (...a: unknown[]) => execUpdateOne(...a),
  },
}));
vi.mock("../src/models/speaking.model.js", () => ({
  SpeakingAttemptModel: {
    findById: (...a: unknown[]) => attemptFindById(...a),
    updateOne: (...a: unknown[]) => attemptUpdateOne(...a),
  },
  SpeakingAssessmentModel: {
    findById: (...a: unknown[]) => assessmentFindById(...a),
  },
}));
vi.mock("../src/lib/asr.js", async (importOriginal) => {
  const actual = await importOriginal<typeof AsrModule>();
  return { AsrError: actual.AsrError, asrTranscribe };
});

import { AsrError } from "../src/lib/asr.js";
import { speechProcessor } from "../src/processors/speech.processor.js";

const REF = "the quick brown fox";
const validPayload = {
  jobId: "job-1",
  attemptId: "6650000000000000000000a1",
  itemIndex: 0,
  audioUrl: "https://cdn/audio.webm",
};
const job = (data: unknown) => ({ id: "b1", data }) as never;

beforeEach(() => {
  execFindOne.mockReset();
  execUpdateOne.mockClear();
  attemptFindById.mockReset();
  attemptUpdateOne.mockClear();
  assessmentFindById.mockReset();
  asrTranscribe.mockReset();
});
afterEach(() => vi.clearAllMocks());

describe("speechProcessor — control-flow contract", () => {
  it("drops a malformed payload (returns {ok:false}, no throw, no work)", async () => {
    const res = await speechProcessor(job({ nope: true }));
    expect(res).toEqual({ ok: false });
    expect(execFindOne).not.toHaveBeenCalled();
    expect(asrTranscribe).not.toHaveBeenCalled();
  });

  it("skips an already-finalized job (idempotent — no ASR call)", async () => {
    execFindOne.mockResolvedValue({ status: "completed" });
    const res = await speechProcessor(job(validPayload));
    expect(res).toEqual({ ok: true });
    expect(asrTranscribe).not.toHaveBeenCalled();
    expect(execUpdateOne).not.toHaveBeenCalled();
  });

  it("scores a successful transcription and writes COMPLETED", async () => {
    execFindOne.mockResolvedValue({ status: "queued" });
    assessmentFindById.mockResolvedValue({ items: [{ referenceText: REF }] });
    attemptFindById.mockResolvedValue({
      assessment: "a1",
      items: [{ itemIndex: 0, jobStatus: "completed", audioUrl: "x" }],
      status: "submitted",
    });
    asrTranscribe.mockResolvedValue({
      transcript: REF,
      words: REF.split(" ").map((word, i) => ({
        word,
        start: i * 0.5,
        end: i * 0.5 + 0.4,
      })),
    });
    const res = await speechProcessor(job(validPayload));
    expect(res).toEqual({ ok: true });
    // Job completed + the attempt item written with the score.
    const completedJob = execUpdateOne.mock.calls.some(
      (c) => (c[1] as { $set?: { status?: string } })?.$set?.status === "completed",
    );
    expect(completedJob).toBe(true);
    const wroteScore = attemptUpdateOne.mock.calls.some((c) => {
      const set = (c[1] as { $set?: Record<string, unknown> })?.$set ?? {};
      return "items.0.subScores" in set;
    });
    expect(wroteScore).toBe(true);
  });

  it("catches an ASR failure: finalizes FAILED and returns (never throws)", async () => {
    execFindOne.mockResolvedValue({ status: "queued" });
    assessmentFindById.mockResolvedValue({ items: [{ referenceText: REF }] });
    attemptFindById.mockResolvedValue({
      assessment: "a1",
      items: [{ itemIndex: 0, jobStatus: "failed", audioUrl: "x" }],
      status: "submitted",
    });
    asrTranscribe.mockRejectedValue(new AsrError("ASR down"));

    let threw = false;
    let res: { ok: boolean } | undefined;
    try {
      res = await speechProcessor(job(validPayload));
    } catch {
      threw = true;
    }
    expect(threw).toBe(false); // NEVER rethrows
    expect(res).toEqual({ ok: false });
    const failedJob = execUpdateOne.mock.calls.some(
      (c) => (c[1] as { $set?: { status?: string } })?.$set?.status === "failed",
    );
    expect(failedJob).toBe(true);
    const failedItem = attemptUpdateOne.mock.calls.some((c) => {
      const set = (c[1] as { $set?: Record<string, unknown> })?.$set ?? {};
      return set["items.0.jobStatus"] === "failed";
    });
    expect(failedItem).toBe(true);
  });
});
