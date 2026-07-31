/**
 * Idempotent mock-exam seed.
 *
 *   pnpm --filter @codeapt/api seed:exams
 *
 * Creates a FREE "Mock Exams" subject with an `exam`-type Topic, an Exam with 2
 * sections (different durations) mixing MCQ_SINGLE / MCQ_MULTI / CODE, and one
 * active PublicExamLink. The CODE question uses the greeter pattern so a correct
 * submission passes under real OR mock Piston. Re-runnable: the curriculum tree
 * upserts by slug/name and the exam's sections/questions/test cases are rebuilt.
 */
import { CodeLanguage, ExamQuestionType, TopicType } from "@codeapt/shared";
import { randomUUID } from "node:crypto";

import { connectDatabase, disconnectDatabase } from "../lib/db.js";
import { logger } from "../lib/logger.js";
import {
  ExamModel,
  ExamQuestionModel,
  ExamSectionModel,
  ExamTestCaseModel,
  PublicExamLinkModel,
} from "../models/assessment.model.js";
import {
  ModuleModel,
  ProgramModel,
  SubjectModel,
  TopicModel,
} from "../models/curriculum.model.js";

const GREETER_STARTER = `import sys

name = sys.stdin.readline().strip() or "world"
print(f"Hello, {name}!")
`;
const greet = (name: string) => ({
  inputData: name,
  expectedOutput: `Hello, ${name}!`,
});

async function seedExams(): Promise<void> {
  await connectDatabase();
  try {
    const program = await ProgramModel.findOneAndUpdate(
      { slug: "assessments" },
      { $set: { name: "Assessments", isVisible: true, order: 9 } },
      { upsert: true, new: true },
    );
    const subject = await SubjectModel.findOneAndUpdate(
      { slug: "mock-exams" },
      {
        $set: {
          name: "Mock Exams",
          program: program._id,
          description: "Timed, sectioned mock placement exams.",
          price: 0,
          discountPrice: 0,
          isVisible: true,
        },
      },
      { upsert: true, new: true },
    );
    const mod = await ModuleModel.findOneAndUpdate(
      { subject: subject._id, name: "Practice Exams" },
      { $set: { order: 1 } },
      { upsert: true, new: true },
    );
    const topic = await TopicModel.findOneAndUpdate(
      { module: mod._id, name: "Sample Placement Mock" },
      { $set: { topicType: TopicType.EXAM, order: 1, isVisible: true } },
      { upsert: true, new: true },
    );

    // Exam (1:1 with the topic).
    const exam = await ExamModel.findOneAndUpdate(
      { topic: topic._id },
      { $set: { title: "Sample Placement Mock", passPercentage: 40 } },
      { upsert: true, new: true },
    );

    // Rebuild sections/questions/test cases fresh.
    const existingSections = await ExamSectionModel.find({ exam: exam._id });
    const sectionIds = existingSections.map((s) => s._id);
    const existingQuestions = await ExamQuestionModel.find({ exam: exam._id });
    await ExamTestCaseModel.deleteMany({
      question: { $in: existingQuestions.map((q) => q._id) },
    });
    await ExamQuestionModel.deleteMany({ exam: exam._id });
    await ExamSectionModel.deleteMany({ _id: { $in: sectionIds } });

    // Section 1 — Aptitude (30 min): MCQ_SINGLE + MCQ_MULTI.
    const aptitude = await ExamSectionModel.create({
      exam: exam._id,
      name: "Aptitude",
      order: 0,
      durationMinutes: 30,
      description: "Multiple-choice reasoning.",
    });
    await ExamQuestionModel.create({
      exam: exam._id,
      section: aptitude._id,
      questionType: ExamQuestionType.MCQ_SINGLE,
      text: "What is the time complexity of binary search?",
      order: 0,
      marks: 5,
      options: ["O(n)", "O(log n)", "O(1)", "O(n log n)"],
      correctOptions: [1],
    });
    await ExamQuestionModel.create({
      exam: exam._id,
      section: aptitude._id,
      questionType: ExamQuestionType.MCQ_MULTI,
      text: "Which of these are linear data structures? (select all)",
      order: 1,
      marks: 5,
      options: ["Array", "Binary tree", "Linked list", "Graph"],
      correctOptions: [0, 2],
    });

    // Section 2 — Coding (45 min): CODE with visible + hidden cases.
    const coding = await ExamSectionModel.create({
      exam: exam._id,
      name: "Coding",
      order: 1,
      durationMinutes: 45,
      description: "Write and submit code.",
    });
    const codeQ = await ExamQuestionModel.create({
      exam: exam._id,
      section: coding._id,
      questionType: ExamQuestionType.CODE,
      text: "Read a name from stdin and print `Hello, <name>!` (or `world` if empty).",
      order: 0,
      marks: 10,
      starterCode: GREETER_STARTER,
      language: CodeLanguage.PYTHON,
    });
    await ExamTestCaseModel.insertMany([
      { question: codeQ._id, ...greet("Ada"), isHidden: false, order: 0 },
      { question: codeQ._id, ...greet("Alan"), isHidden: false, order: 1 },
      { question: codeQ._id, ...greet("Grace"), isHidden: true, order: 2 },
      { question: codeQ._id, ...greet("Linus"), isHidden: true, order: 3 },
    ]);

    // totalMarks = sum of question marks.
    const total = 5 + 5 + 10;
    await ExamModel.updateOne(
      { _id: exam._id },
      { $set: { totalMarks: total } },
    );

    // One active public link (reuse if present).
    let link = await PublicExamLinkModel.findOne({
      exam: exam._id,
      isActive: true,
    });
    if (!link) {
      link = await PublicExamLinkModel.create({
        exam: exam._id,
        accessToken: randomUUID(),
        isActive: true,
      });
    }

    logger.info(
      `Exams seeded: "${exam.title}" (${total} marks, 2 sections, 3 questions), ` +
        `public token ${link.accessToken}`,
    );
  } finally {
    await disconnectDatabase();
  }
}

seedExams()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    logger.error({ err }, "seed:exams failed");
    process.exit(1);
  });
