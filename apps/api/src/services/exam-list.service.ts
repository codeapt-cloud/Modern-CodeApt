/**
 * Lists the exams a student can take: exams whose curriculum Topic (type
 * `exam`) sits in a subject the user is enrolled in. Each item carries attempt
 * usage/limits and the user's most recent attempt summary. (Public-link exams
 * are reached via their token, not this list.)
 */
import {
  TopicType,
  type ExamAttemptStatus,
  type ExamListItem,
  type ExamListResponse,
} from "@codeapt/shared";
import { Types } from "mongoose";

import {
  EnrollmentModel,
  ModuleModel,
  TopicModel,
} from "../models/curriculum.model.js";
import {
  ExamModel,
  ExamAttemptCounterModel,
  ExamQuestionModel,
  ExamSectionModel,
  StudentExamAttemptModel,
} from "../models/assessment.model.js";
import { resolveExamTitle, topicNamesByIds } from "../lib/exam-title.js";

export async function listExamsForUser(
  userId: string,
): Promise<ExamListResponse> {
  const enrollments = await EnrollmentModel.find({ user: userId }).select(
    "subject",
  );
  const subjectIds = enrollments.map((e) => e.subject);
  if (subjectIds.length === 0) return { items: [] };

  const modules = await ModuleModel.find({
    subject: { $in: subjectIds },
  }).select("_id");
  const examTopics = await TopicModel.find({
    module: { $in: modules.map((m) => m._id) },
    topicType: TopicType.EXAM,
  }).select("_id");
  const topicIds = examTopics.map((t) => t._id);
  if (topicIds.length === 0) return { items: [] };

  const exams = await ExamModel.find({ topic: { $in: topicIds } });
  // Migrated exams have a blank title → show their linked topic's real name.
  // (These are all topic-bearing individual exams — filter narrows the type now
  // that `topic` is optional for standalone college exams.)
  const topicNames = await topicNamesByIds(
    exams.map((e) => e.topic).filter((t): t is Types.ObjectId => t != null),
  );
  const items: ExamListItem[] = [];

  for (const exam of exams) {
    const [sectionCount, questionCount, sections] = await Promise.all([
      ExamSectionModel.countDocuments({ exam: exam._id }),
      ExamQuestionModel.countDocuments({ exam: exam._id }),
      ExamSectionModel.find({ exam: exam._id }).select("durationMinutes"),
    ]);
    const totalDurationMinutes = sections.reduce(
      (s, sec) => s + sec.durationMinutes,
      0,
    );
    const counter = await ExamAttemptCounterModel.findOne({
      user: userId,
      exam: exam._id,
    });
    const last = await StudentExamAttemptModel.findOne({
      user: new Types.ObjectId(userId),
      exam: exam._id,
    }).sort({ createdAt: -1 });

    items.push({
      id: exam._id.toString(),
      topicId: exam.topic ? exam.topic.toString() : "",
      title: resolveExamTitle(
        exam.title,
        exam.topic ? topicNames.get(exam.topic.toString()) : undefined,
      ),
      totalMarks: exam.totalMarks,
      passPercentage: exam.passPercentage,
      sectionCount,
      questionCount,
      totalDurationMinutes,
      attemptsUsed: counter?.attemptCount ?? 0,
      maxAttempts: counter?.maxAttempts ?? 1,
      lastAttempt: last
        ? {
            id: last._id.toString(),
            status: last.status as ExamAttemptStatus,
            score: last.score,
            passed: last.passed,
          }
        : null,
    });
  }

  return { items };
}
