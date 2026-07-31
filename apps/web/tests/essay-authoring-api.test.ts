/**
 * The college essay-authoring adapter — proves `collegeEssayAuthoringApi(slug)`
 * exposes the slug-free `EssayAuthoringApi` the reused editor dialog depends on,
 * threads the tenant slug through to the underlying group, and defaults the
 * optional `orgUnitIds` to [] (so the admin path — which omits targeting — always
 * sends a valid college body). This is what lets the SAME editor dialog drive the
 * college surface without a fork. Mirrors exam-authoring-api.test.ts.
 */
import { describe, expect, it, vi } from "vitest";

import {
  collegeEssayAuthoringApi,
  type CollegeEssayAuthoringGroup,
} from "../src/lib/essay-authoring-api.js";

function fakeGroup() {
  const group = {
    create: vi.fn(async () => ({ id: "t1" }) as never),
    update: vi.fn(async () => ({ id: "t1" }) as never),
    generateKeywords: vi.fn(
      async () => ({ keywords: ["a"], source: "deterministic" }) as never,
    ),
  } satisfies CollegeEssayAuthoringGroup;
  return group;
}

const BODY = {
  title: "T",
  description: "d",
  instructions: "i",
  difficultyLevel: 1 as const,
  minWords: 0,
  maxWords: 0,
  timeLimitMinutes: 0,
  maxAttempts: 3,
  isActive: true,
  semanticKeywords: [],
};

describe("collegeEssayAuthoringApi", () => {
  it("exposes the EssayAuthoringApi surface", () => {
    const api = collegeEssayAuthoringApi("ace", fakeGroup());
    expect(Object.keys(api).sort()).toEqual(
      ["create", "generateKeywords", "update"].sort(),
    );
  });

  it("threads the slug and defaults orgUnitIds to [] on create", async () => {
    const group = fakeGroup();
    const api = collegeEssayAuthoringApi("ace", group);
    await api.create(BODY);
    expect(group.create).toHaveBeenCalledWith("ace", {
      ...BODY,
      orgUnitIds: [],
    });
  });

  it("passes through provided orgUnitIds on create + update", async () => {
    const group = fakeGroup();
    const api = collegeEssayAuthoringApi("ace", group);
    await api.create({ ...BODY, orgUnitIds: ["u1"] });
    expect(group.create).toHaveBeenCalledWith("ace", {
      ...BODY,
      orgUnitIds: ["u1"],
    });
    await api.update("t1", { ...BODY, orgUnitIds: ["u2"] });
    expect(group.update).toHaveBeenCalledWith("ace", "t1", {
      ...BODY,
      orgUnitIds: ["u2"],
    });
  });

  it("threads the slug on generateKeywords", async () => {
    const group = fakeGroup();
    const api = collegeEssayAuthoringApi("ace", group);
    await api.generateKeywords({ title: "T", description: "", instructions: "" });
    expect(group.generateKeywords).toHaveBeenCalledWith("ace", {
      title: "T",
      description: "",
      instructions: "",
    });
  });
});
