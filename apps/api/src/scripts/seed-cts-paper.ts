/**
 * Seed the COMPLETE CTS paper as four assignable artifacts (Step 20 Part B).
 *
 *   pnpm --filter @codeapt/api seed:cts-paper
 *
 * The four CTS sections live in THREE different engines with NO container tying
 * them together (there is no cross-engine "paper" entity). This seed creates all
 * four in the `comm-demo` college so an operator can see the whole thing:
 *   1. Grammar exam (34 MCQ: verb form 8, tense 8, articles 6, prepositions 6,
 *      voice 6) — EXAM engine.
 *   2. Comprehension exam (12 MCQ + an audio-stimulus section) — EXAM engine.
 *   3. Speaking assessment (13 items) — seeded separately by `seed:speaking`.
 *   4. Round-2 email scenario — ESSAY engine (promptKind=email).
 *
 * HONESTY: I have NO verbatim source for the 46 grammar + comprehension questions
 * or the email prompt. Every one is REPRESENTATIVE FILLER, and each is prefixed
 * with a visible [PLACEHOLDER …] marker IN THE QUESTION TEXT ITSELF so a college
 * can never mistake it for harvested exam material — a real deployment MUST
 * replace them. Idempotent: exams/topic upsert by (college, title).
 */
import { EssayPromptKind, ExamQuestionType } from "@codeapt/shared";
import type { Types } from "mongoose";

import { connectDatabase, disconnectDatabase } from "../lib/db.js";
import { logger } from "../lib/logger.js";
import {
  ExamModel,
  ExamQuestionModel,
  ExamSectionModel,
} from "../models/assessment.model.js";
import { CollegeModel } from "../models/college.model.js";
import { EssayTopicModel } from "../models/essay.model.js";

const SLUG = "comm-demo";
const PH = "[PLACEHOLDER — representative filler, NOT harvested; replace before deployment]";

interface GrammarCategory {
  readonly name: string;
  readonly count: number;
  readonly ask: string;
}
const GRAMMAR: GrammarCategory[] = [
  { name: "Verb form", count: 8, ask: "choose the correct verb form to complete the sentence" },
  { name: "Tense", count: 8, ask: "choose the correct tense" },
  { name: "Articles", count: 6, ask: "choose the correct article (a / an / the / —)" },
  { name: "Prepositions", count: 6, ask: "choose the correct preposition" },
  { name: "Voice", count: 6, ask: "convert between active and passive voice" },
];

/** A placeholder MCQ — the marker is IN THE TEXT, visible to any operator. */
function placeholderMcq(exam: Types.ObjectId, section: Types.ObjectId, category: string, ask: string, i: number, order: number) {
  return {
    exam,
    section,
    questionType: ExamQuestionType.MCQ_SINGLE,
    text: `${PH} ${category} Q${i + 1}: ${ask}. (Sample sentence #${i + 1}.)`,
    order,
    options: ["Placeholder option A", "Placeholder option B", "Placeholder option C", "Placeholder option D"],
    correctOptions: [0],
    marks: 1,
  };
}

async function upsertExam(
  collegeId: Types.ObjectId,
  title: string,
  passPercentage: number,
): Promise<Types.ObjectId> {
  const exam = await ExamModel.findOneAndUpdate(
    { college: collegeId, title },
    {
      $set: { isPublished: true, orgUnits: [], passPercentage, resultsVisible: true },
      $setOnInsert: { college: collegeId },
    },
    { upsert: true, new: true },
  );
  // Rebuild sections + questions from scratch (idempotent content).
  const sections = await ExamSectionModel.find({ exam: exam._id }).select("_id");
  await ExamQuestionModel.deleteMany({ exam: exam._id });
  await ExamSectionModel.deleteMany({ _id: { $in: sections.map((s) => s._id) } });
  return exam._id;
}

async function seedGrammar(collegeId: Types.ObjectId): Promise<number> {
  const examId = await upsertExam(collegeId, "CTS — Grammar (Section C)", 50);
  let order = 0;
  let total = 0;
  for (let s = 0; s < GRAMMAR.length; s += 1) {
    const cat = GRAMMAR[s]!;
    const section = await ExamSectionModel.create({
      exam: examId,
      name: `Grammar — ${cat.name}`,
      order: s,
      durationMinutes: 5,
      description: `${PH} ${cat.count} ${cat.name.toLowerCase()} questions.`,
    });
    const qs = Array.from({ length: cat.count }, (_v, i) =>
      placeholderMcq(examId, section._id, cat.name, cat.ask, i, order++),
    );
    await ExamQuestionModel.insertMany(qs);
    total += qs.length;
  }
  await ExamModel.updateOne({ _id: examId }, { $set: { totalMarks: total } });
  return total;
}

async function seedComprehension(collegeId: Types.ObjectId): Promise<number> {
  const examId = await upsertExam(collegeId, "CTS — Comprehension (Section D)", 50);
  const section = await ExamSectionModel.create({
    exam: examId,
    name: "Comprehension — audio passage",
    order: 0,
    durationMinutes: 12,
    // No real stimulus clip — must be attached by an operator (or generated via
    // the speaking TTS pipeline once the ASR image ships Piper). Left empty, not faked.
    description: `${PH} Attach a real comprehension audio stimulus before use (stimulusAudioUrl is intentionally empty).`,
    stimulusAudioUrl: "",
    stimulusPlayLimit: 1,
  });
  const qs = Array.from({ length: 12 }, (_v, i) =>
    placeholderMcq(examId, section._id, "Comprehension", "answer based on the passage you heard", i, i),
  );
  await ExamQuestionModel.insertMany(qs);
  await ExamModel.updateOne({ _id: examId }, { $set: { totalMarks: qs.length } });
  return qs.length;
}

async function seedEmail(collegeId: Types.ObjectId): Promise<void> {
  await EssayTopicModel.findOneAndUpdate(
    { college: collegeId, title: "CTS Round 2 — Email" },
    {
      $set: {
        promptKind: EssayPromptKind.EMAIL,
        isPublished: true,
        isActive: true,
        orgUnits: [],
        description: `${PH} Round-2 email-writing scenario.`,
        instructions: `${PH} Write a professional email (120–150 words) responding to the scenario. This prompt is representative filler — replace it with a real CTS Round-2 email task.`,
        minWords: 120,
        maxWords: 200,
        timeLimitMinutes: 20,
        difficultyLevel: 2,
      },
      $setOnInsert: { college: collegeId },
    },
    { upsert: true, new: true },
  );
}

async function main(): Promise<void> {
  await connectDatabase();
  try {
    const college = await CollegeModel.findOne({ slug: SLUG });
    if (!college) {
      throw new Error(
        `College "${SLUG}" not found — run "pnpm --filter @codeapt/api seed:speaking" first ` +
          `(it creates the demo college + the speaking assessment).`,
      );
    }
    const collegeId = college._id;
    const grammar = await seedGrammar(collegeId);
    const comprehension = await seedComprehension(collegeId);
    await seedEmail(collegeId);
    logger.info(
      { grammar, comprehension },
      `CTS paper seeded into "${SLUG}" as FOUR SEPARATE artifacts (grammar exam, ` +
        `comprehension exam, speaking assessment [seed:speaking], email essay). ` +
        `Every grammar/comprehension question + the email prompt is PLACEHOLDER filler. ` +
        `There is no cross-engine paper container: assign the four separately.`,
    );
  } finally {
    await disconnectDatabase();
  }
}

const invokedDirectly = process.argv[1]?.includes("seed-cts-paper");
if (invokedDirectly) {
  main()
    .then(() => process.exit(0))
    .catch((err: unknown) => {
      logger.error({ err }, "seed:cts-paper failed");
      process.exit(1);
    });
}
