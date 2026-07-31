/**
 * Exam display-title resolution.
 *
 * Migrated (Django) exams have an EMPTY `title`, so `transformExam` fell back to
 * the literal "Exam" — meaning every migrated exam card shows "Exam". The
 * meaningful name lives on the exam's linked curriculum Topic (e.g. "TCS Test
 * 5"), which the in-course view already displays. These helpers resolve the
 * display title at READ time (no stored data is mutated): prefer a real
 * `exam.title`, otherwise the topic's name, otherwise the "Exam" placeholder.
 */
import type { Types } from "mongoose";

import { TopicModel } from "../models/curriculum.model.js";

/** The placeholder `transformExam` emits when the source title is blank. */
export const EXAM_TITLE_PLACEHOLDER = "Exam";

/**
 * Pure resolver: a non-blank, non-placeholder `examTitle` wins; otherwise the
 * topic name; otherwise the placeholder. Callers that already have the topic
 * name in hand (batched lists) use this directly.
 */
export function resolveExamTitle(
  examTitle: string | null | undefined,
  topicName: string | null | undefined,
): string {
  const title = (examTitle ?? "").trim();
  if (title && title !== EXAM_TITLE_PLACEHOLDER) return title;
  const name = (topicName ?? "").trim();
  if (name) return name;
  return EXAM_TITLE_PLACEHOLDER;
}

/** Batch-load topic names → Map<topicId string, name> (for exam lists). */
export async function topicNamesByIds(
  topicIds: Types.ObjectId[],
): Promise<Map<string, string>> {
  if (topicIds.length === 0) return new Map();
  const topics = await TopicModel.find({ _id: { $in: topicIds } })
    .select("name")
    .lean<{ _id: Types.ObjectId; name: string }[]>();
  return new Map(topics.map((t) => [t._id.toString(), t.name]));
}

/**
 * Resolve a single exam's display title, fetching the linked topic's name only
 * when the stored title is blank/placeholder (so real titles cost no query).
 */
export async function resolveExamDisplayTitle(exam: {
  title: string;
  topic?: Types.ObjectId | null;
}): Promise<string> {
  const title = (exam.title ?? "").trim();
  if (title && title !== EXAM_TITLE_PLACEHOLDER) return title;
  if (exam.topic) {
    const topic = await TopicModel.findById(exam.topic)
      .select("name")
      .lean<{ name: string } | null>();
    const resolved = resolveExamTitle(exam.title, topic?.name);
    return resolved;
  }
  return EXAM_TITLE_PLACEHOLDER;
}
