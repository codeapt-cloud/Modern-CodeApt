/**
 * The college posting-authoring adapter (Phase 5b) — proves
 * `collegeCareersAuthoringApi(slug)` exposes the slug-free `PostingAuthoringApi`
 * the reused PostingEditorDialog depends on, threads the tenant slug through to
 * the college group in the right position, and always includes `orgUnitIds`
 * (defaulting to []) so the tenant endpoint gets valid targeting. This is what
 * lets the SAME admin editor drive the college surface without a fork.
 */
import type { AdminPosting } from "@codeapt/shared";
import { describe, expect, it, vi } from "vitest";

import {
  collegeCareersAuthoringApi,
  type CollegeCareersAuthoringGroup,
} from "../src/lib/careers-authoring-api.js";

function fakeGroup() {
  const group = {
    create: vi.fn(() => Promise.resolve({ id: "p1" } as AdminPosting)),
    update: vi.fn(() => Promise.resolve({ id: "p1" } as AdminPosting)),
  } satisfies CollegeCareersAuthoringGroup;
  return group;
}

const body = {
  title: "Backend Intern",
  company: "Acme",
  type: "internship",
} as never;

describe("collegeCareersAuthoringApi", () => {
  it("exposes the full PostingAuthoringApi surface", () => {
    const api = collegeCareersAuthoringApi("ace", fakeGroup());
    expect(Object.keys(api).sort()).toEqual(["create", "update"].sort());
  });

  it("threads the slug + defaults orgUnitIds to [] on create", async () => {
    const group = fakeGroup();
    const api = collegeCareersAuthoringApi("ace", group);
    await api.create(body);
    expect(group.create).toHaveBeenCalledWith("ace", {
      ...body,
      orgUnitIds: [],
    });
  });

  it("preserves supplied orgUnitIds + threads the slug before the id on update", async () => {
    const group = fakeGroup();
    const api = collegeCareersAuthoringApi("ace", group);
    await api.update("p1", { ...body, orgUnitIds: ["u1", "u2"] });
    expect(group.update).toHaveBeenCalledWith("ace", "p1", {
      ...body,
      orgUnitIds: ["u1", "u2"],
    });
  });
});
