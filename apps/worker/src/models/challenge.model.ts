/**
 * Worker mirror of the daily-challenge models (DailyQuestion + DailyTestCase),
 * kept field-for-field in sync with `apps/api/src/models/challenge.model.ts`.
 * The automatic daily-challenge generator (worker-side, since it needs Piston)
 * writes these directly, exactly as the api admin/seed paths do. Includes the
 * ADDITIVE provenance fields (source/generatedAt/validationNote/bankQuestion).
 */
import { Schema, model, type InferSchemaType } from "mongoose";
import {
  CODE_LANGUAGE_VALUES,
  CodeLanguage,
  DAILY_CHALLENGE_SOURCE_VALUES,
  DailyChallengeSource,
  DAILY_QUESTION_TYPE_VALUES,
} from "@codeapt/shared";

const dailyQuestionSchema = new Schema(
  {
    questionType: {
      type: String,
      enum: DAILY_QUESTION_TYPE_VALUES,
      required: true,
    },
    releaseDate: { type: Date, required: true, unique: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    options: { type: [String], default: undefined },
    correctOption: { type: Number },
    starterCode: { type: String, default: "" },
    language: {
      type: String,
      enum: CODE_LANGUAGE_VALUES,
      default: CodeLanguage.PYTHON,
    },
    marks: { type: Number, default: 5, min: 0 },
    source: {
      type: String,
      enum: DAILY_CHALLENGE_SOURCE_VALUES,
      default: DailyChallengeSource.MANUAL,
    },
    generatedAt: { type: Date, default: null },
    validationNote: { type: String, default: "" },
    bankQuestion: {
      type: Schema.Types.ObjectId,
      ref: "BankQuestion",
      default: null,
    },
  },
  { timestamps: true },
);
export type DailyQuestion = InferSchemaType<typeof dailyQuestionSchema>;
export const DailyQuestionModel = model("DailyQuestion", dailyQuestionSchema);

const dailyTestCaseSchema = new Schema(
  {
    question: {
      type: Schema.Types.ObjectId,
      ref: "DailyQuestion",
      required: true,
    },
    inputData: { type: String, default: "" },
    expectedOutput: { type: String, default: "" },
    isHidden: { type: Boolean, default: false },
  },
  { timestamps: true },
);
dailyTestCaseSchema.index({ question: 1 });
export type DailyTestCase = InferSchemaType<typeof dailyTestCaseSchema>;
export const DailyTestCaseModel = model("DailyTestCase", dailyTestCaseSchema);
