/**
 * Exam-content read cache (anti-stampede).
 *
 * WHY: A published exam's STATIC content — its sections, each section's
 * questions, the visible sample test cases, and (for college exams) the
 * college org-unit tree used for access checks — is identical for every taker
 * and does not change while an exam is being sat. Yet the start path reads it
 * per student. When 600 students start at once that is ~600× the same queries
 * in a few seconds (a ~75:1 read:write amplification was observed on the live
 * tier), which is what saturates the database and lags the whole site.
 *
 * WHAT: A tiny in-process TTL cache. The first request for an exam's content
 * hits the DB; every request within EXAM_CONTENT_CACHE_TTL_MS is served from
 * memory. The TTL is short (default 30s) so there is NO explicit invalidation
 * to get wrong — an admin's edit to an exam becomes visible within one TTL, and
 * a live exam's content is frozen for its sitting so staleness is a non-issue.
 *
 * SAFETY: The cached Mongoose documents are treated as READ-ONLY and shared
 * across concurrent requests. Nothing in the read/view/grading path mutates a
 * cached exam/section/question/test-case document (only the per-student
 * ATTEMPT document is written), so sharing instances is safe. DO NOT mutate or
 * `.save()` a document returned from any function here — clone first if you
 * must. Per-process only (not shared across replicas); that is fine because the
 * content is static and each replica's cache converges within one TTL.
 */
import type { Types } from "mongoose";

import { env } from "../config/env.js";
import {
  ExamModel,
  ExamSectionModel,
  ExamQuestionModel,
  ExamTestCaseModel,
} from "../models/assessment.model.js";
import { OrgUnitModel } from "../models/org-unit.model.js";

interface Entry<T> {
  value: T;
  expires: number;
}

const store = new Map<string, Entry<unknown>>();

function ttl(): number {
  return env.EXAM_CONTENT_CACHE_TTL_MS;
}

/**
 * Read-through: return the cached value for `key`, or load it, cache it for one
 * TTL, and return it. When the TTL is 0 the cache is disabled and `loader` runs
 * every time (no entry is stored).
 */
async function cached<T>(key: string, loader: () => Promise<T>): Promise<T> {
  const lifespan = ttl();
  if (lifespan <= 0) return loader();

  const now = Date.now();
  const hit = store.get(key) as Entry<T> | undefined;
  if (hit && hit.expires > now) return hit.value;

  const value = await loader();
  store.set(key, { value, expires: now + lifespan });
  return value;
}

/** Sections of an exam, in display order. */
export function getCachedSections(examId: Types.ObjectId) {
  return cached(`sections:${examId.toString()}`, () =>
    ExamSectionModel.find({ exam: examId }).sort({ order: 1, _id: 1 })
      .exec(),
  );
}

/** All questions of a section, in display order. */
export function getCachedSectionQuestions(sectionId: Types.ObjectId) {
  return cached(`qbysection:${sectionId.toString()}`, () =>
    ExamQuestionModel.find({ section: sectionId }).sort({ order: 1, _id: 1 })
      .exec(),
  );
}

/** All questions of an exam (used by the grading/review paths). */
export function getCachedExamQuestions(examId: Types.ObjectId) {
  return cached(`qbyexam:${examId.toString()}`, () =>
    ExamQuestionModel.find({ exam: examId }).exec(),
  );
}

/** Visible (non-hidden) sample test cases for a section's CODE questions. */
export function getCachedVisibleCases(
  sectionId: Types.ObjectId,
  codeQuestionIds: Types.ObjectId[],
) {
  // Keyed by section (its code-question set is stable within a TTL).
  return cached(`visiblecases:${sectionId.toString()}`, () =>
    ExamTestCaseModel.find({
      question: { $in: codeQuestionIds },
      isHidden: false,
    }).sort({ order: 1, _id: 1 })
      .exec(),
  );
}

/** The college's org-unit tree (id + parent), used by access checks. */
export function getCachedCollegeOrgUnits(collegeId: Types.ObjectId) {
  return cached(`orgunits:${collegeId.toString()}`, () =>
    OrgUnitModel.find({ college: collegeId }).select("_id parent").exec(),
  );
}

/** A published exam document, for the student-facing read path only. */
export function getCachedExam(examId: string) {
  return cached(`exam:${examId}`, () => ExamModel.findById(examId).exec());
}

/** Test-only: drop everything so TTL behaviour is deterministic per test. */
export function __clearExamContentCache(): void {
  store.clear();
}
