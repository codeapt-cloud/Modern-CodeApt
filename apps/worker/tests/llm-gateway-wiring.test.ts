/**
 * Worker gateway WIRING — proves essay grading routes through the gateway once
 * installed. The DB-backed gateway internals (provider-source / persist /
 * adapters) are identical to the API's and covered there with a real DB + mocked
 * fetch; here we test the worker-specific seam wiring with a registered fake
 * router standing in for the gateway (the "mocked provider"), so no Mongo is
 * needed:
 *   - no gateway installed → the configured (mock) grader, as before;
 *   - gateway installed → selectGrader picks the LLM grader and gradeEssay routes
 *     through callLlmChatJson into the gateway (source ai_hybrid);
 *   - installLlmGateway only arms when ENCRYPTION_KEY is set (graceful otherwise).
 */
import {
  EssayScoreSource,
  hasLlmRouter,
  registerLlmRouter,
} from "@codeapt/shared";
import { afterEach, describe, expect, it } from "vitest";

import { env } from "../src/config/env.js";
import { gradeEssay, selectGrader } from "../src/lib/essay-grader.js";
import { installLlmGateway } from "../src/lib/llm-gateway/index.js";

const INPUT = {
  essayText:
    "Technology reshapes education. Students gain access to resources and must adapt.",
  prompt: "Discuss technology in education.",
  rubric: "vocabulary + structure",
  referenceKeywords: ["technology", "education", "students"],
};

afterEach(() => {
  registerLlmRouter(null);
  env.ENCRYPTION_KEY = undefined;
});

describe("worker gateway wiring", () => {
  it("uses the mock grader when no gateway is installed", () => {
    expect(hasLlmRouter()).toBe(false);
    // Default provider = mock → deterministic, offline.
    return gradeEssay(INPUT).then((r) => {
      expect(r.source).toBe(EssayScoreSource.AI_HYBRID); // mock adapter blends
    });
  });

  it("routes grading through the gateway when a router is installed", async () => {
    // Stand in for the DB-backed gateway: a router returning canned JSON.
    const calls: { policy: unknown }[] = [];
    registerLlmRouter(async (_system, _user, policy) => {
      calls.push({ policy });
      return { vocabulary: 88, structure: 82, relevance: 90, feedback: "via gateway" };
    });

    // selectGrader now prefers the gateway-backed LLM grader…
    expect(hasLlmRouter()).toBe(true);
    const result = await gradeEssay(INPUT, selectGrader());
    expect(result.source).toBe(EssayScoreSource.AI_HYBRID);
    expect(result.feedback).toBe("via gateway");
    // …and grading passes the sensitive grading policy — now with token-
    // optimization hints (capable model, tight output cap, feature label) —
    // through the seam. Stability + sensitivity (trainsOnData exclusion) intact.
    expect(calls[0]!.policy).toEqual({
      kind: "grading",
      sensitive: true,
      capability: "capable",
      maxTokens: 512,
      feature: "grading",
    });
  });

  it("installLlmGateway arms only when ENCRYPTION_KEY is set", () => {
    env.ENCRYPTION_KEY = undefined;
    installLlmGateway();
    expect(hasLlmRouter()).toBe(false);

    env.ENCRYPTION_KEY = "worker-encryption-key-0123456789";
    installLlmGateway();
    expect(hasLlmRouter()).toBe(true);
  });
});
