/**
 * Question-bank UI helpers — the filter-state → browse-query mapping (wired to
 * the REAL bankBrowseQuerySchema params, incl. subCategory + tag), the
 * empty-facets fallback, multi-select tracking, pagination, and the draft →
 * bank-upsert encoding. Facets themselves are computed server-side (tested in
 * the API suite), so there is no client-side facet derivation to test here.
 */
import { BankKind, BankScope, ExamQuestionType } from "@codeapt/shared";
import { describe, expect, it } from "vitest";

import { emptyQuestionDraft } from "../src/lib/exam-authoring.js";
import {
  bankSourceQuery,
  bankUpsertFromDraft,
  buildAiGenerateRequest,
  buildAiGenerateExamRequest,
  buildBankBrowseQuery,
  clampCount,
  emptyAiBuilderState,
  emptyBankFacets,
  emptyBankFilters,
  pageCount,
  parseTagsInput,
  toggleId,
  validateAiBuilderState,
} from "../src/lib/question-bank-ui.js";

describe("bankSourceQuery", () => {
  it("maps each picker source to its scope + kind", () => {
    expect(bankSourceQuery("standard")).toEqual({
      scope: BankScope.GLOBAL,
      kind: BankKind.STANDARD,
    });
    expect(bankSourceQuery("coding")).toEqual({
      scope: BankScope.GLOBAL,
      kind: BankKind.CODING,
    });
    expect(bankSourceQuery("self")).toEqual({ scope: BankScope.COLLEGE });
  });
});

describe("buildBankBrowseQuery", () => {
  it("applies the source scope/kind + every non-empty filter (incl. subCategory + tag)", () => {
    const query = buildBankBrowseQuery(
      "coding",
      {
        ...emptyBankFilters(),
        q: "  arrays ",
        category: "DS",
        subCategory: "Trees",
        company: "",
        difficulty: "hard",
        tag: "recursion",
      },
      2,
      25,
    );
    expect(query).toEqual({
      scope: "global",
      kind: "coding",
      page: 2,
      pageSize: 25,
      q: "arrays",
      category: "DS",
      subCategory: "Trees",
      difficulty: "hard",
      tag: "recursion",
    });
    // company omitted (empty), q trimmed.
    expect("company" in query).toBe(false);
  });

  it("self source has no kind and empty filters drop out", () => {
    const query = buildBankBrowseQuery("self", emptyBankFilters(), 1);
    expect(query).toEqual({ scope: "college", page: 1, pageSize: 20 });
    expect("kind" in query).toBe(false);
    expect("subCategory" in query).toBe(false);
    expect("tag" in query).toBe(false);
  });
});

describe("emptyBankFacets", () => {
  it("is the empty fallback for every facet group", () => {
    expect(emptyBankFacets()).toEqual({
      kinds: [],
      categories: [],
      subCategories: [],
      companies: [],
      difficulties: [],
      tags: [],
    });
  });
});

describe("toggleId + pageCount", () => {
  it("toggles membership immutably", () => {
    expect(toggleId([], "a")).toEqual(["a"]);
    expect(toggleId(["a", "b"], "a")).toEqual(["b"]);
    const start = ["a"];
    toggleId(start, "b");
    expect(start).toEqual(["a"]); // not mutated
  });
  it("computes page count (min 1)", () => {
    expect(pageCount(0, 20)).toBe(1);
    expect(pageCount(20, 20)).toBe(1);
    expect(pageCount(21, 20)).toBe(2);
    expect(pageCount(45, 20)).toBe(3);
  });
});

describe("parseTagsInput", () => {
  it("splits on comma/newline, trims, drops blanks", () => {
    expect(parseTagsInput("arrays,  sorting ,,\nbig-o")).toEqual([
      "arrays",
      "sorting",
      "big-o",
    ]);
  });
});

describe("bankUpsertFromDraft", () => {
  it("encodes an MCQ draft + metadata (no test cases)", () => {
    const draft = {
      ...emptyQuestionDraft(ExamQuestionType.MCQ_MULTI),
      text: "Pick primes",
      marks: 5,
      options: ["2", "4", "7", ""],
      correctOptions: [0, 2],
    };
    const upsert = bankUpsertFromDraft(
      draft,
      { category: " DS ", subCategory: "", company: "  ", difficulty: "hard", tags: [" x ", ""] },
      [{ input: "a", expectedOutput: "b", isHidden: false, order: 0 }],
    );
    expect(upsert.questionType).toBe("MCQ_MULTI");
    expect(upsert.category).toBe("DS"); // trimmed
    expect(upsert.company).toBe("General"); // blank → default
    expect(upsert.tags).toEqual(["x"]); // trimmed + blanks dropped
    expect(upsert.options).toEqual(["2", "4", "7"]); // blank option compacted
    expect(upsert.correctOptions).toEqual([0, 2]);
    expect(upsert.testCases).toEqual([]); // dropped for MCQ
  });

  it("keeps test cases for a CODE draft", () => {
    const draft = {
      ...emptyQuestionDraft(ExamQuestionType.CODE),
      text: "Sum",
      marks: 10,
      language: "python" as const,
    };
    const upsert = bankUpsertFromDraft(
      draft,
      { category: "Coding", subCategory: "", company: "Acme", difficulty: "medium", tags: [] },
      [{ input: "2 3", expectedOutput: "5", isHidden: false, order: 0 }],
    );
    expect(upsert.questionType).toBe("CODE");
    expect(upsert.testCases).toHaveLength(1);
    expect(upsert.testCases[0]).toMatchObject({ input: "2 3", expectedOutput: "5" });
  });
});

describe("AI Test Builder helpers", () => {
  it("clampCount bounds into [1, 20] and floors", () => {
    expect(clampCount(0)).toBe(1);
    expect(clampCount(3.9)).toBe(3);
    expect(clampCount(50)).toBe(20);
    expect(clampCount(Number.NaN)).toBe(1);
  });

  it("validateAiBuilderState flags empty description / no types / bad per-section", () => {
    const base = emptyAiBuilderState();
    expect(validateAiBuilderState({ ...base, description: "" })).toMatch(/describe/i);
    expect(
      validateAiBuilderState({ ...base, description: "ok", types: [] }),
    ).toMatch(/type/i);
    expect(
      validateAiBuilderState({ ...base, description: "ok", perSection: 999 }),
    ).toMatch(/at most/i);
    expect(
      validateAiBuilderState({ ...base, description: "A real test brief" }),
    ).toBeNull();
  });

  it("buildAiGenerateRequest sends per-section count for one section, trimmed + clamped", () => {
    const req = buildAiGenerateRequest(
      {
        ...emptyAiBuilderState(),
        description: "  arrays & strings  ",
        types: [ExamQuestionType.MCQ_SINGLE, ExamQuestionType.CODE],
        perSection: 99,
        difficulty: "hard",
      },
      "exam-1",
      "sec-1",
    );
    expect(req).toEqual({
      examId: "exam-1",
      sectionId: "sec-1",
      description: "arrays & strings",
      questionTypes: ["MCQ_SINGLE", "CODE"],
      count: 20, // per-section, clamped to the cap
      difficulty: "hard",
    });
  });

  it("buildAiGenerateExamRequest sends section + per-section counts, both clamped", () => {
    const req = buildAiGenerateExamRequest(
      {
        ...emptyAiBuilderState(),
        description: "  full placement test  ",
        types: [ExamQuestionType.MCQ_SINGLE],
        sectionCount: 99, // clamped to MAX_AI_EXAM_SECTIONS
        perSection: 99, // clamped to MAX_AI_GENERATED_QUESTIONS
        difficulty: "medium",
      },
      "exam-1",
    );
    expect(req).toEqual({
      examId: "exam-1",
      description: "full placement test",
      questionTypes: ["MCQ_SINGLE"],
      sectionCount: 8,
      questionsPerSection: 20,
      difficulty: "medium",
    });
  });
});
