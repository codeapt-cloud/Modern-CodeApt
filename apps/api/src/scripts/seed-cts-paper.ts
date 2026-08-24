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
import {
  CommunicationPartType,
  EssayPromptKind,
  ExamQuestionType,
} from "@codeapt/shared";
import type { Types } from "mongoose";

import { connectDatabase, disconnectDatabase } from "../lib/db.js";
import { logger } from "../lib/logger.js";
import {
  ExamModel,
  ExamQuestionModel,
  ExamSectionModel,
} from "../models/assessment.model.js";
import { CollegeModel } from "../models/college.model.js";
import { CommunicationAssessmentModel } from "../models/communication.model.js";
import { EssayTopicModel } from "../models/essay.model.js";
import { SpeakingAssessmentModel } from "../models/speaking.model.js";

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

const GRAMMAR_TITLE = "CTS — Grammar (Section C)";
const COMPREHENSION_TITLE = "CTS — Comprehension (Section D)";
const EMAIL_TITLE = "CTS Round 2 — Email";
const SPEAKING_TITLE = "CTS / Cognizant — Communication (Sections A & B)";
const COMPOSITE_TITLE = "CTS — Full Communication Assessment";

async function seedGrammar(
  collegeId: Types.ObjectId,
): Promise<{ id: Types.ObjectId; count: number }> {
  const examId = await upsertExam(collegeId, GRAMMAR_TITLE, 50);
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
  return { id: examId, count: total };
}

async function seedComprehension(
  collegeId: Types.ObjectId,
): Promise<{ id: Types.ObjectId; count: number }> {
  const examId = await upsertExam(collegeId, COMPREHENSION_TITLE, 50);
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
  return { id: examId, count: qs.length };
}

async function seedEmail(collegeId: Types.ObjectId): Promise<Types.ObjectId> {
  const topic = await EssayTopicModel.findOneAndUpdate(
    { college: collegeId, title: EMAIL_TITLE },
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
  return topic._id;
}

/**
 * Step 21 — wire the four CTS artifacts into ONE CommunicationAssessment so the
 * demo is a single assignable unit, not four. The speaking part is looked up by
 * title (it is seeded separately by seed:speaking); if it isn't there yet, the
 * composite is still created with the three exam/essay parts and a warning. Parts
 * are weighted roughly by size (marks/items). Idempotent (upsert by title). The
 * composite is only PUBLISHED when every referenced part is itself published.
 */
async function seedComposite(
  collegeId: Types.ObjectId,
  grammar: { id: Types.ObjectId; count: number },
  comprehension: { id: Types.ObjectId; count: number },
  emailId: Types.ObjectId,
): Promise<{ published: boolean; hasSpeaking: boolean }> {
  const speaking = await SpeakingAssessmentModel.findOne({
    college: collegeId,
    title: SPEAKING_TITLE,
  }).select("_id isPublished");

  const parts: Array<{
    order: number;
    partType: CommunicationPartType;
    ref: Types.ObjectId;
    label: string;
    weight: number;
    requiresPrevious: boolean;
    availableFrom: Date | null;
  }> = [];
  parts.push({
    order: 0,
    partType: CommunicationPartType.EXAM,
    ref: grammar.id,
    label: "Section C — Grammar",
    weight: grammar.count,
    requiresPrevious: false,
    availableFrom: null,
  });
  parts.push({
    order: 1,
    partType: CommunicationPartType.EXAM,
    ref: comprehension.id,
    label: "Section D — Comprehension",
    weight: comprehension.count,
    requiresPrevious: false,
    availableFrom: null,
  });
  if (speaking) {
    parts.push({
      order: 2,
      partType: CommunicationPartType.SPEAKING,
      ref: speaking._id,
      label: "Sections A & B — Speaking",
      weight: 13,
      requiresPrevious: false,
      availableFrom: null,
    });
  }
  parts.push({
    order: parts.length,
    partType: CommunicationPartType.ESSAY,
    ref: emailId,
    // Round 2 is a different day in the real paper — gate it on finishing the
    // rest (requiresPrevious), leaving availableFrom for an operator to set a
    // real date. Demo keeps availableFrom null so it's explorable immediately.
    label: "Round 2 — Email",
    weight: 20,
    requiresPrevious: true,
    availableFrom: null,
  });

  // The composite guarantees a fully launchable paper, so publish only when every
  // INCLUDED part is published. The grammar/comprehension exams + email essay are
  // published by the seeds above; the speaking part (if present) is published by
  // seed:speaking. So this is true in the normal (seed:speaking-first) flow.
  const allPartsPublished = !speaking || !!speaking.isPublished;

  await CommunicationAssessmentModel.findOneAndUpdate(
    { college: collegeId, title: COMPOSITE_TITLE },
    {
      $set: {
        topic: null,
        orgUnits: [],
        description:
          "The complete CTS communication paper as ONE assignment — grammar, " +
          "comprehension, speaking, and the Round-2 email, in order. " +
          "(Grammar/comprehension/email content is PLACEHOLDER filler.)",
        parts,
        passPercentage: 50,
        distinctionPercentage: 60,
        isPublished: allPartsPublished,
      },
      $setOnInsert: { college: collegeId },
    },
    { upsert: true, new: true },
  );
  return { published: allPartsPublished, hasSpeaking: !!speaking };
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
    const emailId = await seedEmail(collegeId);
    const composite = await seedComposite(
      collegeId,
      grammar,
      comprehension,
      emailId,
    );
    logger.info(
      {
        grammar: grammar.count,
        comprehension: comprehension.count,
        compositePublished: composite.published,
        speakingWired: composite.hasSpeaking,
      },
      `CTS paper seeded into "${SLUG}": grammar + comprehension exams, the email ` +
        `essay, and (Step 21) ONE "${COMPOSITE_TITLE}" CommunicationAssessment that ` +
        `wraps all four in order — the demo is now a single assignment, not four. ` +
        `Every grammar/comprehension question + the email prompt is PLACEHOLDER filler. ` +
        (composite.hasSpeaking
          ? ""
          : `NOTE: the speaking part was NOT found — run seed:speaking to include it; ` +
            `the composite was created with the three exam/essay parts only.`),
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
