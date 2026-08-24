/**
 * ONE-COLLEGE DEMO of BOTH modules — gaming + communication — so a single
 * student can click through everything and a single operator sees the reports.
 *
 *   pnpm --filter @codeapt/api seed:demo
 *
 * Upserts a "CodeApt Demo" college (slug `demo`) with gaming + communication
 * enabled and seeds, all published and idempotent (upsert by college+title):
 *   - a game set "CodeApt Demo — All Games" with ALL 7 real games;
 *   - the CTS speaking assessment (Sections A & B, from the shared preset);
 *   - a 34-question grammar exam + a 12-question comprehension exam + a Round-2
 *     email essay — EVERY fabricated question/prompt marked PLACEHOLDER in its
 *     own text (no invented content can be mistaken for a real paper);
 *   - ONE "CTS — Full Communication Assessment" composite wrapping the four
 *     communication parts in order, so it's a single assignment.
 * Plus a demo STUDENT (plays + takes both) and a demo COLLEGE ADMIN (authors +
 * reads the cohort report/export).
 *
 * This is a NET-NEW seed: the older seed:games seeds a DIFFERENT college
 * (game-demo) with only 3 games, and seed:speaking/seed:cts-paper seed comm-demo
 * — neither puts both modules + all 7 games in one place. Run THIS for the demo.
 */
import {
  CommunicationPartType,
  EssayPromptKind,
  ExamQuestionType,
  GameDifficulty,
  GameKey,
  Role,
  UserType,
  buildItemsFromPreset,
} from "@codeapt/shared";
import { Types } from "mongoose";

import { connectDatabase, disconnectDatabase } from "../lib/db.js";
import { logger } from "../lib/logger.js";
import { hashPassword } from "../lib/password.js";
import {
  ExamModel,
  ExamQuestionModel,
  ExamSectionModel,
} from "../models/assessment.model.js";
import { CollegeModel } from "../models/college.model.js";
import { CommunicationAssessmentModel } from "../models/communication.model.js";
import { EssayTopicModel } from "../models/essay.model.js";
import { GameSetModel } from "../models/game.model.js";
import { SpeakingAssessmentModel } from "../models/speaking.model.js";
import { ProfileModel, UserModel } from "../models/user.model.js";
import { setEntitlements } from "../services/college.service.js";

const SLUG = "demo";
const PH = "[PLACEHOLDER — representative filler, NOT harvested; replace before deployment]";

const GAME_SET_TITLE = "CodeApt Demo — All Games";
const SPEAKING_TITLE = "CTS Speaking (Sections A & B)";
const GRAMMAR_TITLE = "CTS — Grammar (Section C)";
const COMPREHENSION_TITLE = "CTS — Comprehension (Section D)";
const EMAIL_TITLE = "CTS Round 2 — Email";
const COMPOSITE_TITLE = "CTS — Full Communication Assessment";

const STUDENT_EMAIL = "demo.student@demo.test";
const STUDENT_PASSWORD = "DemoStudent@123";
const ADMIN_EMAIL = "demo.admin@demo.test";
const ADMIN_PASSWORD = "DemoAdmin@123";

// All seven real games (PROBE is a dev-only throwaway and is excluded).
const ALL_GAMES = [
  GameKey.GRID_CHALLENGE,
  GameKey.BUBBLE_MATH,
  GameKey.GEO_SUDO,
  GameKey.SWITCH_CHALLENGE,
  GameKey.MOTION_CHALLENGE,
  GameKey.INDUCTIVE_REASONING,
  GameKey.DOOR_KEY,
];

const GRAMMAR = [
  { name: "Verb form", count: 8, ask: "choose the correct verb form to complete the sentence" },
  { name: "Tense", count: 8, ask: "choose the correct tense" },
  { name: "Articles", count: 6, ask: "choose the correct article (a / an / the / —)" },
  { name: "Prepositions", count: 6, ask: "choose the correct preposition" },
  { name: "Voice", count: 6, ask: "convert between active and passive voice" },
];

function placeholderMcq(
  exam: Types.ObjectId,
  section: Types.ObjectId,
  category: string,
  ask: string,
  i: number,
  order: number,
) {
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

async function upsertExamShell(
  collegeId: Types.ObjectId,
  title: string,
): Promise<Types.ObjectId> {
  const exam = await ExamModel.findOneAndUpdate(
    { college: collegeId, title },
    {
      $set: { isPublished: true, orgUnits: [], passPercentage: 50, resultsVisible: true },
      $setOnInsert: { college: collegeId },
    },
    { upsert: true, new: true },
  );
  const sections = await ExamSectionModel.find({ exam: exam._id }).select("_id");
  await ExamQuestionModel.deleteMany({ exam: exam._id });
  await ExamSectionModel.deleteMany({ _id: { $in: sections.map((s) => s._id) } });
  return exam._id;
}

async function seedGameSet(collegeId: Types.ObjectId): Promise<void> {
  const games = ALL_GAMES.map((gameKey, order) => ({
    gameKey,
    order,
    durationSeconds: gameKey === GameKey.GRID_CHALLENGE ? 240 : 150,
    allowSkip: gameKey !== GameKey.GRID_CHALLENGE,
    startingDifficulty: GameDifficulty.EASY,
    maxQuestions: gameKey === GameKey.GRID_CHALLENGE ? 3 : 5,
  }));
  await GameSetModel.findOneAndUpdate(
    { college: collegeId, title: GAME_SET_TITLE },
    {
      $set: {
        topic: null,
        orgUnits: [],
        isPublished: true,
        selectionMode: "fixed",
        instantFeedback: true,
        maxAttempts: 0,
        games,
      },
      $setOnInsert: { college: collegeId },
    },
    { upsert: true, new: true },
  );
}

async function seedSpeaking(collegeId: Types.ObjectId): Promise<Types.ObjectId> {
  const items = buildItemsFromPreset("cts").map((spec, order) => ({
    itemType: spec.itemType,
    referenceText: spec.referenceText ?? "",
    promptText: spec.promptText ?? "",
    promptAudioUrl: spec.promptAudioUrl ?? "",
    stimulusAudioUrl: spec.stimulusAudioUrl ?? "",
    stimulusPlayLimit: spec.stimulusPlayLimit ?? 0,
    answerSet: spec.answerSet ? [...spec.answerSet] : [],
    missingWord: spec.missingWord ?? "",
    keyFacts: spec.keyFacts ? [...spec.keyFacts] : [],
    section: spec.section,
    prepSeconds: spec.prepSeconds ?? 0,
    responseWindowSeconds: spec.responseWindowSeconds ?? 60,
    order,
  }));
  const doc = await SpeakingAssessmentModel.findOneAndUpdate(
    { college: collegeId, title: SPEAKING_TITLE },
    {
      $set: {
        topic: null,
        orgUnits: [],
        isPublished: true,
        description: "CTS speaking — Sections A & B (representative content).",
        items,
        maxAttempts: 0,
      },
      $setOnInsert: { college: collegeId },
    },
    { upsert: true, new: true },
  );
  return doc._id;
}

async function seedGrammar(collegeId: Types.ObjectId): Promise<Types.ObjectId> {
  const examId = await upsertExamShell(collegeId, GRAMMAR_TITLE);
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
  return examId;
}

async function seedComprehension(collegeId: Types.ObjectId): Promise<Types.ObjectId> {
  const examId = await upsertExamShell(collegeId, COMPREHENSION_TITLE);
  const section = await ExamSectionModel.create({
    exam: examId,
    name: "Comprehension — audio passage",
    order: 0,
    durationMinutes: 12,
    description: `${PH} Attach a real comprehension audio stimulus before use (stimulusAudioUrl is intentionally empty).`,
    stimulusAudioUrl: "",
    stimulusPlayLimit: 1,
  });
  const qs = Array.from({ length: 12 }, (_v, i) =>
    placeholderMcq(examId, section._id, "Comprehension", "answer based on the passage you heard", i, i),
  );
  await ExamQuestionModel.insertMany(qs);
  await ExamModel.updateOne({ _id: examId }, { $set: { totalMarks: qs.length } });
  return examId;
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

async function seedComposite(
  collegeId: Types.ObjectId,
  refs: {
    grammar: Types.ObjectId;
    comprehension: Types.ObjectId;
    speaking: Types.ObjectId;
    email: Types.ObjectId;
  },
): Promise<void> {
  const parts = [
    { order: 0, partType: CommunicationPartType.EXAM, ref: refs.grammar, label: "Section C — Grammar", weight: 34, requiresPrevious: false, availableFrom: null },
    { order: 1, partType: CommunicationPartType.EXAM, ref: refs.comprehension, label: "Section D — Comprehension", weight: 12, requiresPrevious: false, availableFrom: null },
    { order: 2, partType: CommunicationPartType.SPEAKING, ref: refs.speaking, label: "Sections A & B — Speaking", weight: 13, requiresPrevious: false, availableFrom: null },
    { order: 3, partType: CommunicationPartType.ESSAY, ref: refs.email, label: "Round 2 — Email", weight: 20, requiresPrevious: true, availableFrom: null },
  ];
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
        isPublished: true,
      },
      $setOnInsert: { college: collegeId },
    },
    { upsert: true, new: true },
  );
}

async function upsertUser(
  collegeId: Types.ObjectId,
  opts: {
    email: string;
    password: string;
    username: string;
    role: Role;
    fullName: string;
    rollNumber: string;
  },
): Promise<void> {
  let user = await UserModel.findOne({ email: opts.email });
  const passwordHash = await hashPassword(opts.password);
  if (!user) {
    user = await UserModel.create({
      username: opts.username,
      email: opts.email,
      passwordHash,
      role: opts.role,
      userType: UserType.COLLEGE,
      college: collegeId,
      forcePasswordChange: false,
    });
    await ProfileModel.create({
      user: user._id,
      fullName: opts.fullName,
      rollNumber: opts.rollNumber,
      avatarUrl: `https://ui-avatars.com/api/?name=${encodeURIComponent(opts.fullName)}&background=random`,
    });
  } else {
    user.college = collegeId;
    user.role = opts.role;
    user.userType = UserType.COLLEGE;
    user.forcePasswordChange = false;
    user.passwordHash = passwordHash;
    await user.save();
  }
}

async function main(): Promise<void> {
  await connectDatabase();
  try {
    const college = await CollegeModel.findOneAndUpdate(
      { slug: SLUG },
      {
        $setOnInsert: {
          name: "CodeApt Demo",
          slug: SLUG,
          createdBy: new Types.ObjectId(), // seed-only placeholder creator
        },
      },
      { upsert: true, new: true },
    );
    const collegeId = college._id;

    await setEntitlements(collegeId.toString(), {
      features: { gaming: true, communication: true },
    });
    await setEntitlements(collegeId.toString(), {
      subCapabilities: {
        "gaming.authoring": true,
        "communication.authoring": true,
        "communication.speaking": true,
      },
    });

    await seedGameSet(collegeId);
    const speaking = await seedSpeaking(collegeId);
    const grammar = await seedGrammar(collegeId);
    const comprehension = await seedComprehension(collegeId);
    const email = await seedEmail(collegeId);
    await seedComposite(collegeId, { grammar, comprehension, speaking, email });

    await upsertUser(collegeId, {
      email: STUDENT_EMAIL,
      password: STUDENT_PASSWORD,
      username: "demo-student",
      role: Role.STUDENT,
      fullName: "Demo Student",
      rollNumber: "DEMO-0001",
    });
    await upsertUser(collegeId, {
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
      username: "demo-admin",
      role: Role.COLLEGE_ADMIN,
      fullName: "Demo Admin",
      rollNumber: "DEMO-ADMIN",
    });

    logger.info(
      {
        college: SLUG,
        games: ALL_GAMES.length,
        student: `${STUDENT_EMAIL} / ${STUDENT_PASSWORD}`,
        admin: `${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`,
      },
      `Demo seeded into "${SLUG}": a ${ALL_GAMES.length}-game set + the full CTS ` +
        `communication composite (one assignment). Grammar/comprehension/email are ` +
        `PLACEHOLDER filler. Sign in as the student to play + take; as the admin to ` +
        `read the cohort report/export.`,
    );
  } finally {
    await disconnectDatabase();
  }
}

const invokedDirectly = process.argv[1]?.includes("seed-demo");
if (invokedDirectly) {
  main()
    .then(() => process.exit(0))
    .catch((err: unknown) => {
      logger.error({ err }, "seed:demo failed");
      process.exit(1);
    });
}
