/**
 * Injected interview runner engine (Step 34) — the interview twin of
 * SpeakingEngine. The runner shell/hook is surface-agnostic; these factories bind
 * the college (tenant) vs global (B2C / course-attached) API routes. The submit
 * is turn-based (`answers/:turnIndex` → SubmitInterviewAnswerResponse).
 */
import type {
  InterviewCurrentResponse,
  MockInterviewAttemptResult,
  SubmitInterviewAnswerRequest,
  SubmitInterviewAnswerResponse,
  UploadSignatureResponse,
} from "@codeapt/shared";

import { api } from "./api-client.js";

export interface InterviewEngine {
  current(attemptId: string): Promise<InterviewCurrentResponse>;
  submitAnswer(
    attemptId: string,
    turnIndex: number,
    payload: SubmitInterviewAnswerRequest,
  ): Promise<SubmitInterviewAnswerResponse>;
  uploadSignature(): Promise<UploadSignatureResponse>;
  result(attemptId: string): Promise<MockInterviewAttemptResult>;
  recordWarning(
    attemptId: string,
    reason?: string,
  ): Promise<{ warnings: number; terminated: boolean }>;
}

export function collegeInterviewEngine(slug: string): InterviewEngine {
  return {
    current: (attemptId) => api.collegeInterview.current(slug, attemptId),
    submitAnswer: (attemptId, turnIndex, payload) =>
      api.collegeInterview.submitAnswer(slug, attemptId, turnIndex, payload),
    uploadSignature: () => api.collegeInterview.uploadSignature(slug),
    result: (attemptId) => api.collegeInterview.result(slug, attemptId),
    recordWarning: (attemptId, reason) =>
      api.collegeInterview.recordWarning(slug, attemptId, reason),
  };
}

export function globalInterviewEngine(): InterviewEngine {
  return {
    current: (attemptId) => api.interview.current(attemptId),
    submitAnswer: (attemptId, turnIndex, payload) =>
      api.interview.submitAnswer(attemptId, turnIndex, payload),
    uploadSignature: () => api.interview.uploadSignature(),
    result: (attemptId) => api.interview.result(attemptId),
    recordWarning: (attemptId, reason) => api.interview.recordWarning(attemptId, reason),
  };
}
