/**
 * The injected engine adapter for the Speaking RUNNER — one runner shell + hook +
 * results component, two surfaces (S30). It carries only the three engine calls
 * the runner makes: submit an item, fetch an upload signature, poll the result.
 * The college surface binds the tenant slug; the global (B2C / any enrolled
 * learner) surface is slug-free. Authorization is server-side (access matrix at
 * start, attempt ownership thereafter) — identical for both.
 */
import type {
  SpeakingAttemptResult,
  SubmitSpeakingItemResponse,
  UploadSignatureResponse,
} from "@codeapt/shared";

import { api } from "./api-client.js";

export interface SpeakingEngine {
  submitItem(
    attemptId: string,
    itemIndex: number,
    payload: { audioUrl?: string; text?: string; silent?: boolean },
  ): Promise<SubmitSpeakingItemResponse>;
  uploadSignature(): Promise<UploadSignatureResponse>;
  result(attemptId: string): Promise<SpeakingAttemptResult>;
}

/** College surface: bind the tenant slug onto every engine call. */
export function collegeSpeakingEngine(slug: string): SpeakingEngine {
  return {
    submitItem: (attemptId, itemIndex, payload) =>
      api.collegeSpeaking.submitItem(slug, attemptId, itemIndex, payload),
    uploadSignature: () => api.collegeSpeaking.uploadSignature(slug),
    result: (attemptId) => api.collegeSpeaking.result(slug, attemptId),
  };
}

/** Global surface (B2C / any enrolled learner): slug-free. */
export function globalSpeakingEngine(): SpeakingEngine {
  return {
    submitItem: (attemptId, itemIndex, payload) =>
      api.speaking.submitItem(attemptId, itemIndex, payload),
    uploadSignature: () => api.speaking.uploadSignature(),
    result: (attemptId) => api.speaking.result(attemptId),
  };
}
