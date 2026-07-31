/**
 * Worker mirror of the question-bank model (READ-only here) — kept in sync with
 * `apps/api/src/models/question-bank.model.ts`. The daily-challenge generator
 * reads global CODE bank questions as its curated fallback pool when AI
 * generation is unavailable or fails validation. The worker never writes banks.
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
    scope: { type: String, enum: BANK_SCOPE_VALUES, required: true },
    college: { type: Schema.Types.ObjectId, ref: "College", default: null },
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
    questionType: {
      type: String,
      enum: EXAM_QUESTION_TYPE_VALUES,
      required: true,
    },
    text: { type: String, required: true },
    options: { type: [String], default: undefined },
    correctOptions: { type: [Number], default: undefined },
    starterCode: { type: String, default: "" },
    language: {
      type: String,
      enum: CODE_LANGUAGE_VALUES,
      default: CodeLanguage.PYTHON,
    },
    allowedLanguages: {
      type: [String],
      enum: CODE_LANGUAGE_VALUES,
      default: [],
    },
    image: { type: String, default: "" },
    marks: { type: Number, default: 5, min: 0 },
    testCases: { type: [bankTestCaseSchema], default: [] },
  },
  { timestamps: true },
);

export type BankQuestionDoc = InferSchemaType<typeof bankQuestionSchema>;
export const BankQuestionModel = model("BankQuestion", bankQuestionSchema);
