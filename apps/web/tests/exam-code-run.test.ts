/**
 * In-exam code test-run request shaping + language policy. "Run" tests the
 * visible sample cases and "Run custom input" pipes a custom stdin — both via
 * the existing POST /execute pipeline, in the student's CHOSEN language. Also
 * covers the language policy: [] = open (pick any), [lang] = locked. Web tests
 * run in node, so we assert the ExecuteRequest + pure policy logic (not DOM).
 */
import {
  CODE_LANGUAGE_VALUES,
  ExecutionPurpose,
  type CodeLanguage,
  type SanitizedQuestion,
} from "@codeapt/shared";
import { describe, expect, it } from "vitest";

import {
  EXAM_RUN_PURPOSE,
  buildCustomRunRequest,
  buildSampleRunRequest,
  canRunCode,
  defaultRunLanguage,
  hasSampleCases,
  isLanguageLocked,
  languageChoices,
  stubForLanguage,
} from "../src/lib/exam-code-run.js";
import { STARTER_SNIPPETS } from "../src/lib/snippets.js";

function codeQuestion(over: Partial<SanitizedQuestion> = {}): SanitizedQuestion {
  return {
    id: "q1",
    type: "CODE",
    text: "Echo the input",
    order: 0,
    marks: 10,
    image: "",
    options: null,
    starterCode: "print(input())",
    language: "python",
    allowedLanguages: [],
    sampleCases: [
      { input: "2\n", expectedOutput: "4\n" },
      { input: "3\n", expectedOutput: "6\n" },
    ],
    savedAnswer: null,
    ...over,
  } as SanitizedQuestion;
}

describe("buildSampleRunRequest (Run → visible sample cases, chosen language)", () => {
  it("sends the visible sample cases as testCases in the chosen language", () => {
    const q = codeQuestion();
    const req = buildSampleRunRequest("javascript", q.sampleCases, "console.log(1)");
    expect(req.language).toBe("javascript"); // the student's chosen language
    expect(req.source).toBe("console.log(1)");
    expect(req.purpose).toBe(EXAM_RUN_PURPOSE);
    expect(EXAM_RUN_PURPOSE).toBe(ExecutionPurpose.PLAYGROUND); // NOT grading
    expect(req.testCases).toEqual([
      { input: "2\n", expectedOutput: "4\n" },
      { input: "3\n", expectedOutput: "6\n" },
    ]);
    expect(req.stdin).toBeUndefined();
  });

  it("degrades to an empty testCases array when there are no samples", () => {
    const req = buildSampleRunRequest("python", null, "c");
    expect(req.testCases).toEqual([]);
  });
});

describe("buildCustomRunRequest (Run custom input → stdin, chosen language)", () => {
  it("sends the custom stdin and NO test cases in the chosen language", () => {
    const req = buildCustomRunRequest("java", "class Main{}", "42\n");
    expect(req.language).toBe("java");
    expect(req.stdin).toBe("42\n");
    expect(req.testCases).toBeUndefined();
    expect(req.purpose).toBe(EXAM_RUN_PURPOSE);
  });

  it("omits stdin entirely when it is empty (plain run)", () => {
    const req = buildCustomRunRequest("python", "print(1)", "");
    expect(req.stdin).toBeUndefined();
    expect(req.testCases).toBeUndefined();
  });
});

describe("language policy (dropdown only when open; drives the run language)", () => {
  it("is locked when exactly one language is allowed, open otherwise", () => {
    expect(isLanguageLocked([])).toBe(false); // open (migrated default)
    expect(isLanguageLocked(["python"] as CodeLanguage[])).toBe(true);
  });

  it("open → all supported languages are offered; locked → only the one", () => {
    expect(languageChoices([])).toEqual([...CODE_LANGUAGE_VALUES]);
    expect(languageChoices(["java"] as CodeLanguage[])).toEqual(["java"]);
  });

  it("defaults to the locked language when locked, else the authored language", () => {
    expect(defaultRunLanguage(codeQuestion({ allowedLanguages: [] }))).toBe(
      "python",
    );
    expect(
      defaultRunLanguage(
        codeQuestion({ language: "python", allowedLanguages: ["cpp"] as CodeLanguage[] }),
      ),
    ).toBe("cpp");
  });

  it("keeps the authored starter for the original language, stubs the others", () => {
    const q = codeQuestion({ language: "python", starterCode: "print(input())" });
    // Chosen === authored → authored starter code.
    expect(stubForLanguage("python", q)).toBe("print(input())");
    // Chosen !== authored → the per-language stub (never an empty editor).
    expect(stubForLanguage("java", q)).toBe(STARTER_SNIPPETS.java);
  });
});

describe("canRunCode / hasSampleCases (button gating)", () => {
  it("requires non-empty source and an unlocked editor", () => {
    expect(canRunCode("print(1)", false)).toBe(true);
    expect(canRunCode("print(1)", true)).toBe(false); // disabled (submitted/expired)
    expect(canRunCode("   ", false)).toBe(false); // blank
    expect(canRunCode("", undefined)).toBe(false);
  });

  it("detects whether a question offers a sample-case run", () => {
    expect(hasSampleCases(codeQuestion())).toBe(true);
    expect(hasSampleCases(codeQuestion({ sampleCases: [] }))).toBe(false);
    expect(hasSampleCases(codeQuestion({ sampleCases: null }))).toBe(false);
  });
});
