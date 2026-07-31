/**
 * The college exam-authoring adapter — proves `collegeExamAuthoringApi(slug)`
 * exposes the full slug-free `ExamAuthoringApi` the reused editor components
 * depend on, and that every call threads the tenant slug through to the
 * underlying college group in the right argument position. This is what lets the
 * SAME admin editor components drive the college surface without a fork.
 */
import { describe, expect, it, vi } from "vitest";

import {
  collegeExamAuthoringApi,
  type CollegeExamAuthoringGroup,
} from "../src/lib/exam-authoring-api.js";

/** A fake group recording (method, args) for every call. */
function fakeGroup() {
  const calls: { method: string; args: unknown[] }[] = [];
  const rec =
    (method: string) =>
    (...args: unknown[]) => {
      calls.push({ method, args });
      return Promise.resolve({ id: "x" } as never);
    };
  const group = {
    createSection: vi.fn(rec("createSection")),
    updateSection: vi.fn(rec("updateSection")),
    deleteSection: vi.fn(rec("deleteSection")),
    createQuestion: vi.fn(rec("createQuestion")),
    updateQuestion: vi.fn(rec("updateQuestion")),
    deleteQuestion: vi.fn(rec("deleteQuestion")),
    addTestCase: vi.fn(rec("addTestCase")),
    updateTestCase: vi.fn(rec("updateTestCase")),
    deleteTestCase: vi.fn(rec("deleteTestCase")),
    bulkUpload: vi.fn(rec("bulkUpload")),
    bulkUploadTemplate: vi.fn(rec("bulkUploadTemplate")),
    createPublicLink: vi.fn(rec("createPublicLink")),
    updatePublicLink: vi.fn(rec("updatePublicLink")),
    deletePublicLink: vi.fn(rec("deletePublicLink")),
  } satisfies CollegeExamAuthoringGroup;
  return { group, calls };
}

describe("collegeExamAuthoringApi", () => {
  it("exposes the full ExamAuthoringApi surface", () => {
    const { group } = fakeGroup();
    const api = collegeExamAuthoringApi("ace", group);
    const keys = Object.keys(api).sort();
    expect(keys).toEqual(
      [
        "addTestCase",
        "bulkUpload",
        "bulkUploadTemplate",
        "createPublicLink",
        "createQuestion",
        "createSection",
        "deletePublicLink",
        "deleteQuestion",
        "deleteSection",
        "deleteTestCase",
        "updatePublicLink",
        "updateQuestion",
        "updateSection",
        "updateTestCase",
      ].sort(),
    );
  });

  it("threads the slug as the first arg for exam-scoped calls", async () => {
    const { group } = fakeGroup();
    const api = collegeExamAuthoringApi("ace", group);

    await api.createSection("exam1", {
      name: "S",
      order: 0,
      durationMinutes: 30,
      description: "",
    });
    expect(group.createSection).toHaveBeenCalledWith("ace", "exam1", {
      name: "S",
      order: 0,
      durationMinutes: 30,
      description: "",
    });

    await api.bulkUpload("exam1", "BASE64", "mcq");
    expect(group.bulkUpload).toHaveBeenCalledWith("ace", "exam1", "BASE64", "mcq");

    await api.bulkUploadTemplate("coding");
    expect(group.bulkUploadTemplate).toHaveBeenCalledWith("ace", "coding");

    await api.createPublicLink("exam1", { isActive: true });
    expect(group.createPublicLink).toHaveBeenCalledWith("ace", "exam1", {
      isActive: true,
    });
  });

  it("threads the slug before the resource id for id-scoped calls", async () => {
    const { group } = fakeGroup();
    const api = collegeExamAuthoringApi("ace", group);

    await api.updateSection("sec1", {
      name: "S",
      order: 1,
      durationMinutes: 20,
      description: "",
    });
    expect(group.updateSection).toHaveBeenCalledWith("ace", "sec1", {
      name: "S",
      order: 1,
      durationMinutes: 20,
      description: "",
    });

    await api.deleteSection("sec1");
    expect(group.deleteSection).toHaveBeenCalledWith("ace", "sec1");

    await api.deleteQuestion("q1");
    expect(group.deleteQuestion).toHaveBeenCalledWith("ace", "q1");

    await api.deleteTestCase("tc1");
    expect(group.deleteTestCase).toHaveBeenCalledWith("ace", "tc1");

    await api.deletePublicLink("l1");
    expect(group.deletePublicLink).toHaveBeenCalledWith("ace", "l1");
  });

  it("createQuestion takes only the body (slug + body)", async () => {
    const { group } = fakeGroup();
    const api = collegeExamAuthoringApi("ace", group);
    const body = { sectionId: "sec1", type: "mcq_single", text: "Q", marks: 1 };
    await api.createQuestion(body as never);
    expect(group.createQuestion).toHaveBeenCalledWith("ace", body);
  });
});
