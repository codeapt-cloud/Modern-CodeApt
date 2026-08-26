/**
 * S30 authoring adapters — ONE editor per content type, two surfaces, injected
 * adapter. Proves the college adapter binds the slug and omits the platform-only
 * course-attach picker (listTopics), while the platform adapter exposes it. This
 * is what lets the SAME SpeakingAssessmentEditor / CommunicationAssessmentEditor
 * serve both surfaces without a second component.
 */
import { describe, expect, it, vi } from "vitest";

import {
  collegeSpeakingAuthoringApi,
  platformSpeakingAuthoringApi,
} from "../src/lib/speaking-authoring-api.js";
import {
  collegeCommunicationAuthoringApi,
  platformCommunicationAuthoringApi,
} from "../src/lib/communication-authoring-api.js";

function fakeCollegeSpeakingGroup() {
  return {
    list: vi.fn(async () => ({ items: [] }) as never),
    get: vi.fn(async () => ({}) as never),
    create: vi.fn(async () => ({}) as never),
    update: vi.fn(async () => ({}) as never),
    setPublished: vi.fn(async () => ({}) as never),
    remove: vi.fn(async () => undefined),
    uploadSignature: vi.fn(async () => ({}) as never),
    generateTts: vi.fn(async () => ({}) as never),
  };
}

function fakePlatformSpeakingGroup() {
  return {
    list: vi.fn(async () => ({ items: [] }) as never),
    get: vi.fn(async () => ({}) as never),
    create: vi.fn(async () => ({}) as never),
    update: vi.fn(async () => ({}) as never),
    setPublished: vi.fn(async () => ({}) as never),
    remove: vi.fn(async () => undefined),
    topics: vi.fn(async () => ({ items: [] })),
    generateTts: vi.fn(async () => ({}) as never),
  };
}

describe("speaking authoring adapters", () => {
  it("college binds the slug on every call and has NO topic picker", async () => {
    const g = fakeCollegeSpeakingGroup();
    const a = collegeSpeakingAuthoringApi("acme", g as never);
    await a.list();
    await a.get("s1");
    await a.setPublished("s1", true);
    await a.generatePromptAudio("hi");
    expect(g.list).toHaveBeenCalledWith("acme");
    expect(g.get).toHaveBeenCalledWith("acme", "s1");
    expect(g.setPublished).toHaveBeenCalledWith("acme", "s1", true);
    expect(g.generateTts).toHaveBeenCalledWith("acme", "hi");
    expect(a.listTopics).toBeUndefined(); // college targets org units, not topics
  });

  it("platform is slug-free and EXPOSES the course-attach topic picker", async () => {
    const g = fakePlatformSpeakingGroup();
    const a = platformSpeakingAuthoringApi(g as never);
    await a.list();
    await a.setPublished("s1", true);
    expect(g.list).toHaveBeenCalledWith();
    expect(g.setPublished).toHaveBeenCalledWith("s1", true);
    expect(typeof a.listTopics).toBe("function");
    await a.listTopics!();
    expect(g.topics).toHaveBeenCalled();
  });
});

describe("communication composite authoring adapters", () => {
  it("both surfaces expose the composite CRUD + three part-list fetchers", () => {
    const c = collegeCommunicationAuthoringApi("acme");
    const p = platformCommunicationAuthoringApi();
    for (const a of [c, p]) {
      expect(typeof a.list).toBe("function");
      expect(typeof a.create).toBe("function");
      expect(typeof a.listExams).toBe("function");
      expect(typeof a.listEssays).toBe("function");
      expect(typeof a.listSpeaking).toBe("function");
    }
  });

  it("only the platform adapter carries the course-attach topic picker", () => {
    expect(collegeCommunicationAuthoringApi("acme").listTopics).toBeUndefined();
    expect(typeof platformCommunicationAuthoringApi().listTopics).toBe("function");
  });
});
