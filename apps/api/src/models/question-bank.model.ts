/**
 * Question bank (net-new). A BankQuestion is a self-contained library item whose
 * PAYLOAD mirrors ExamQuestion (see assessment.model.ts) field-for-field, so
 * pulling one INTO an exam is a clean copy — no conversion. Only the engine's
 * real question types are allowed (MCQ_SINGLE | MCQ_MULTI | CODE).
 *
 * Test cases for CODE are EMBEDDED (a library question is self-contained; there
 * is no attempt/grading lifecycle at the bank level — the copy into an exam
 * creates real ExamTestCase rows), unlike the referenced ExamTestCase model.
 *
 * SCOPE:
 *  - `scope: "global"`, `college: null` — the shared banks curated by super-admin
 *    (Standard = MCQ, Coding = CODE); browseable/pullable by a college only if
 *    granted the `question_banks` feature.
 *  - `scope: "college"`, `college: <id>` — a tenant's Self Bank, AUTO-POPULATED
 *    from that college's own imported / created questions. Always available to
 *    the owning college (it's their data); never visible to another tenant.
 *
 * `kind` is DERIVED from questionType (CODE → coding, MCQ_* → standard) and
 * stored for cheap filtering.
 */
import { Schema, model, type InferSchemaType } from "mongoose";
import {
  BANK_KIND_VALUES,
  BANK_SCOPE_VALUES,
  CODE_LANGUAGE_VALUES,
  CodeLanguage,
  EXAM_QUESTION_TYPE_VALUES,
  QUESTION_DIFFICULTY_VALUES,
  QuestionDifficulty,
} from "@codeapt/shared";

// Embedded test case — mirrors ExamTestCase's authored fields.
const bankTestCaseSchema = new Schema(
  {
    inputData: { type: String, default: "" },
    expectedOutput: { type: String, default: "" },
    isHidden: { type: Boolean, default: false },
    order: { type: Number, default: 0 },
  },
  { _id: false },
);

const bankQuestionSchema = new Schema(
  {
    // --- Scope / ownership ---
    scope: { type: String, enum: BANK_SCOPE_VALUES, required: true },
    // Null for global; the owning college for a Self Bank question.
    college: { type: Schema.Types.ObjectId, ref: "College", default: null },
    // --- Bank metadata (filter facets) ---
    kind: { type: String, enum: BANK_KIND_VALUES, required: true },
    category: { type: String, required: true, trim: true },
    subCategory: { type: String, default: "", trim: true },
    company: { type: String, default: "General", trim: true },
    difficulty: {
      type: String,
      enum: QUESTION_DIFFICULTY_VALUES,
      default: QuestionDifficulty.MEDIUM,
    },
    tags: { type: [String], default: [] },
    // --- Payload mirroring ExamQuestion ---
    questionType: {
      type: String,
      enum: EXAM_QUESTION_TYPE_VALUES,
      required: true,
    },
    text: { type: String, required: true },
    options: { type: [String], default: undefined }, // MCQ, up to 5
    correctOptions: { type: [Number], default: undefined }, // 0-based indices
    starterCode: { type: String, default: "" },
    language: {
      type: String,
      enum: CODE_LANGUAGE_VALUES,
      default: CodeLanguage.PYTHON,
    },
    allowedLanguages: { type: [String], enum: CODE_LANGUAGE_VALUES, default: [] },
    image: { type: String, default: "" },
    marks: { type: Number, default: 5, min: 0 },
    // --- Embedded test cases (CODE) ---
    testCases: { type: [bankTestCaseSchema], default: [] },
  },
  { timestamps: true },
);

// Tenant-scoped Self Bank reads (a college's own questions).
bankQuestionSchema.index({ college: 1 });
// Browse/filter facets (scope + kind + the categorical filters).
bankQuestionSchema.index({ scope: 1, kind: 1, category: 1, company: 1, difficulty: 1 });
// De-dup guard for auto-populate / import (same scope+college+type+text).
bankQuestionSchema.index({ scope: 1, college: 1, questionType: 1 });

export type BankQuestionDoc = InferSchemaType<typeof bankQuestionSchema>;
export const BankQuestionModel = model("BankQuestion", bankQuestionSchema);
