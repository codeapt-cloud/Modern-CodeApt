/**
 * Exam-content cache — anti-stampede read cache.
 *
 * The exam-start path re-reads a published exam's STATIC content (sections,
 * questions, visible cases, org-unit tree) once per student; when hundreds start
 * at once that is the query flood that saturates the DB. This cache collapses
 * repeated reads of the same exam into one DB hit per TTL.
 *
 * We prove the behaviour via INSTANCE IDENTITY (independent of wall-clock /
 * env): two reads inside a TTL return the very same array — i.e. the second was
 * served from memory, not re-queried — and clearing the cache forces a reload,
 * so the content is never permanently stale.
 */
import { Types } from "mongoose";
import { beforeEach, describe, expect, it } from "vitest";

import {
  ExamModel,
  ExamSectionModel,
} from "../src/models/assessment.model.js";
import {
  getCachedSections,
  __clearExamContentCache,
} from "../src/lib/exam-content-cache.js";

async function seedExamWithSections(): Promise<Types.ObjectId> {
  const exam = await ExamModel.create({ title: "Cache Exam", isPublished: true });
  await ExamSectionModel.create([
    { exam: exam._id, name: "A", order: 0, durationMinutes: 30 },
    { exam: exam._id, name: "B", order: 1, durationMinutes: 30 },
  ]);
  return exam._id;
}

beforeEach(() => __clearExamContentCache());

describe("getCachedSections", () => {
  it("serves repeat reads from memory (same instance) within the TTL", async () => {
    const examId = await seedExamWithSections();

    const first = await getCachedSections(examId);
    const second = await getCachedSections(examId);

    expect(first).toHaveLength(2);
    expect(first.map((s) => s.name)).toEqual(["A", "B"]);
    // Served from cache → the identical array reference, not a fresh query.
    expect(second).toBe(first);
  });

  it("reloads after the cache is cleared (never permanently stale)", async () => {
    const examId = await seedExamWithSections();

    const before = await getCachedSections(examId);
    __clearExamContentCache();
    const after = await getCachedSections(examId);

    // A different array instance → the loader ran again and would pick up edits.
    expect(after).not.toBe(before);
    expect(after.map((s) => s.name)).toEqual(["A", "B"]);
  });

  it("keys per exam (one exam's cache never answers for another)", async () => {
    const a = await seedExamWithSections();
    const b = await seedExamWithSections();

    const sa = await getCachedSections(a);
    const sb = await getCachedSections(b);

    expect(sa).not.toBe(sb);
    expect(sa[0]!.exam.toString()).toBe(a.toString());
    expect(sb[0]!.exam.toString()).toBe(b.toString());
  });
});
