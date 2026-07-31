/**
 * mergeStudentPostings (Phase 5b) — proves the student careers surface merges
 * college + individual postings into one list: college FIRST (tagged
 * source="college" + the slug for the ?c seam), then individual (source
 * "individual", null slug), each preserving order. Mirrors the merge tests for
 * exams/essays. No React/DOM.
 */
import type { PostingSummary } from "@codeapt/shared";
import { describe, expect, it } from "vitest";

import { mergeStudentPostings } from "../src/lib/student-postings.js";

function posting(id: string): PostingSummary {
  return {
    id,
    title: `T-${id}`,
    company: "Acme",
    companyLogo: "",
    location: "",
    type: "internship",
    compensation: "",
    deadline: null,
    isOpen: true,
    postedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("mergeStudentPostings", () => {
  it("puts college postings first, then individual, tagging source + slug", () => {
    const merged = mergeStudentPostings(
      [posting("i1"), posting("i2")],
      [posting("c1")],
      "ace",
    );
    expect(merged.map((m) => `${m.source}:${m.id}`)).toEqual([
      "college:c1",
      "individual:i1",
      "individual:i2",
    ]);
    expect(merged[0].collegeSlug).toBe("ace");
    expect(merged[1].collegeSlug).toBeNull();
  });

  it("is just the individual list (null slug) when there are no college postings", () => {
    const merged = mergeStudentPostings([posting("i1")], [], null);
    expect(merged).toHaveLength(1);
    expect(merged[0].source).toBe("individual");
    expect(merged[0].collegeSlug).toBeNull();
  });
});
