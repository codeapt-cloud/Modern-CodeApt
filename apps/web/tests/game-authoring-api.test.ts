/**
 * The college game-authoring adapter binds the tenant slug onto every method of
 * the injected group, so ONE editor serves both surfaces. Verified with a fake
 * group (mirrors exam-authoring-api.test).
 */
import { describe, expect, it, vi } from "vitest";

import {
  collegeGameAuthoringApi,
  type CollegeGameAuthoringGroup,
} from "../src/lib/game-authoring-api.js";

function fakeGroup() {
  return {
    list: vi.fn(async () => ({ items: [] })),
    get: vi.fn(async () => ({}) as never),
    create: vi.fn(async () => ({}) as never),
    update: vi.fn(async () => ({}) as never),
    setPublished: vi.fn(async () => ({}) as never),
    remove: vi.fn(async () => undefined),
    templates: vi.fn(async () => ({ items: [] })),
    clone: vi.fn(async () => ({}) as never),
    aiBuild: vi.fn(async () => ({ configured: true, draft: null })),
  } satisfies CollegeGameAuthoringGroup;
}

describe("collegeGameAuthoringApi — slug binding", () => {
  it("prepends the slug on every method", async () => {
    const g = fakeGroup();
    const a = collegeGameAuthoringApi("acme", g);
    await a.list();
    await a.get("s1");
    await a.create({ title: "t" } as never);
    await a.update("s1", { title: "u" } as never);
    await a.setPublished("s1", true);
    await a.remove("s1");
    await a.templates!();
    await a.clone!("src", "Copy");
    await a.aiBuild("brief");

    expect(g.list).toHaveBeenCalledWith("acme");
    expect(g.get).toHaveBeenCalledWith("acme", "s1");
    expect(g.create).toHaveBeenCalledWith("acme", { title: "t" });
    expect(g.update).toHaveBeenCalledWith("acme", "s1", { title: "u" });
    expect(g.setPublished).toHaveBeenCalledWith("acme", "s1", true);
    expect(g.remove).toHaveBeenCalledWith("acme", "s1");
    expect(g.templates).toHaveBeenCalledWith("acme");
    expect(g.clone).toHaveBeenCalledWith("acme", "src", "Copy");
    expect(g.aiBuild).toHaveBeenCalledWith("acme", { brief: "brief" });
  });
});
