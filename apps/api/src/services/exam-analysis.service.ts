/**
 * Exam result analysis (Phase 5) — tenant + scope, READ-ONLY aggregation over a
 * college exam's graded attempts. Changes no exam/grading/write path. Mirrors the
 * attendance/5a analytics discipline (real numbers only; null = "no data", never
 * a fake 0%) and reuses:
 *  - loadManageableExam (college-exam.service) — the exact exam authority
 *    (creator/admin unrestricted; faculty within org-unit scope).
 *  - collectDescendantUnitIds — org-unit (student dept/section) rollups.
 *  - the pure exam-analysis helpers (ratePercent/median/buildScoreBands).
 *
 * QUESTION-LEVEL analysis is derived from `attempt.responseData.breakdown` (the
 * per-question SectionResult[] the grader persists on GRADED attempts). When no
 * graded attempt carries a breakdown, question-level is OMITTED honestly
 * (`hasQuestionData=false`, `questions:[]`) rather than fabricated.
 */
import {
  ExamAttemptStatus,
  buildScoreBands,
  collectDescendantUnitIds,
  median,
  ratePercent,
  type ExamAnalysisResponse,
  type ExamQuestionStat,
  type ExamSectionStat,
  type ExamStudentResult,
  type ExamUnitStat,
} from "@codeapt/shared";
import type { Types } from "mongoose";

import { resolveExamTitle } from "../lib/exam-title.js";
import {
  ExamSectionModel,
  StudentExamAttemptModel,
} from "../models/assessment.model.js";
import { OrgUnitModel } from "../models/org-unit.model.js";
import { ProfileModel, UserModel } from "../models/user.model.js";
import {
  loadManageableExam,
  type ExamActor,
} from "./college-exam.service.js";

// The persisted breakdown shape (read defensively from the Mixed field).
interface BreakdownQuestion {
  questionId?: string;
  text?: string;
  maxMarks?: number;
  awardedMarks?: number;
}
interface BreakdownSection {
  sectionId?: string;
  name?: string;
  score?: number;
  maxScore?: number;
  questions?: BreakdownQuestion[];
}
type AttemptDoc = InstanceType<typeof StudentExamAttemptModel>;

function readBreakdown(attempt: AttemptDoc): BreakdownSection[] {
  const raw = (attempt.responseData ?? {}) as { breakdown?: unknown };
  return Array.isArray(raw.breakdown) ? (raw.breakdown as BreakdownSection[]) : [];
}

interface Gathered {
  examId: string;
  examTitle: string;
  totalMarks: number;
  passPercentage: number;
  attemptsTotal: number;
  graded: {
    attemptId: string;
    userId: string | null;
    name: string;
    rollNumber: string;
    orgUnitId: string | null;
    score: number;
    percent: number | null;
    passed: boolean;
    status: string;
    breakdown: BreakdownSection[];
  }[];
  sectionOrder: { id: string; name: string }[];
  unitRefs: { id: string; parentId: string | null }[];
  unitDocs: { id: string; name: string; type: string; parentId: string | null }[];
}

/** One tenant + scope-enforced read of everything the analysis needs. */
async function gather(
  collegeId: string,
  actor: ExamActor,
  examId: string,
): Promise<Gathered> {
  const { scope, exam } = await loadManageableExam(collegeId, actor, examId);
  const totalMarks = exam.totalMarks ?? 0;

  const [attempts, sections, unitDocs] = await Promise.all([
    StudentExamAttemptModel.find(scope.filter({ exam: exam._id })).sort({
      score: -1,
    }),
    ExamSectionModel.find({ exam: exam._id }).select("_id name order").sort({
      order: 1,
      _id: 1,
    }),
    OrgUnitModel.find(scope.filter()).select("_id name type parent"),
  ]);

  const graded = attempts.filter(
    (a) => a.status === ExamAttemptStatus.GRADED,
  );
  const userIds = graded
    .map((a) => a.user)
    .filter((u): u is Types.ObjectId => u != null);
  const [profiles, users] = await Promise.all([
    ProfileModel.find({ user: { $in: userIds } }).select("user fullName"),
    UserModel.find({ _id: { $in: userIds } }).select("rollNumber orgUnit"),
  ]);
  const nameByUser = new Map(profiles.map((p) => [p.user.toString(), p.fullName]));
  const userById = new Map(users.map((u) => [u._id.toString(), u]));

  return {
    examId: exam._id.toString(),
    examTitle: resolveExamTitle(exam.title, undefined),
    totalMarks,
    passPercentage: exam.passPercentage ?? 40,
    attemptsTotal: attempts.length,
    graded: graded.map((a) => {
      const uid = a.user ? a.user.toString() : null;
      const u = uid ? userById.get(uid) : undefined;
      return {
        attemptId: a._id.toString(),
        userId: uid,
        name: uid ? (nameByUser.get(uid) ?? "Student") : "Anonymous",
        rollNumber: uid ? (u?.rollNumber ?? "") : a.rollNumber,
        orgUnitId: u?.orgUnit ? u.orgUnit.toString() : null,
        score: a.score,
        percent: ratePercent(a.score, totalMarks),
        passed: a.passed,
        status: a.status,
        breakdown: readBreakdown(a),
      };
    }),
    sectionOrder: sections.map((s) => ({
      id: s._id.toString(),
      name: s.name,
    })),
    unitRefs: unitDocs.map((u) => ({
      id: u._id.toString(),
      parentId: u.parent ? u.parent.toString() : null,
    })),
    unitDocs: unitDocs.map((u) => ({
      id: u._id.toString(),
      name: u.name,
      type: u.type,
      parentId: u.parent ? u.parent.toString() : null,
    })),
  };
}

export async function getExamAnalysis(
  collegeId: string,
  actor: ExamActor,
  examId: string,
): Promise<ExamAnalysisResponse> {
  const g = await gather(collegeId, actor, examId);
  const graded = g.graded;
  const n = graded.length;

  const scores = graded.map((a) => a.score);
  const percents = graded.map((a) => a.percent ?? 0);
  const passedCount = graded.filter((a) => a.passed).length;

  const overview = {
    attempts: g.attemptsTotal,
    completed: n,
    avgScore: n === 0 ? null : Math.round((scores.reduce((s, v) => s + v, 0) / n) * 10) / 10,
    avgPercent: n === 0 ? null : Math.round((percents.reduce((s, v) => s + v, 0) / n) * 10) / 10,
    passRate: ratePercent(passedCount, n),
    highest: n === 0 ? null : Math.max(...scores),
    lowest: n === 0 ? null : Math.min(...scores),
    median: median(scores),
    totalMarks: g.totalMarks,
    passPercentage: g.passPercentage,
  };

  const distribution = buildScoreBands(percents);
  const passFail = { passed: passedCount, failed: n - passedCount };

  // BY exam SECTION (aggregate the breakdown section scores across attempts).
  const secAgg = new Map<string, { name: string; score: number; max: number }>();
  for (const a of graded) {
    for (const s of a.breakdown) {
      if (!s.sectionId) continue;
      const cur = secAgg.get(s.sectionId) ?? { name: s.name ?? "", score: 0, max: 0 };
      cur.score += s.score ?? 0;
      cur.max += s.maxScore ?? 0;
      if (!cur.name && s.name) cur.name = s.name;
      secAgg.set(s.sectionId, cur);
    }
  }
  const sections: ExamSectionStat[] = g.sectionOrder.map((s) => {
    const agg = secAgg.get(s.id);
    const count = n;
    return {
      sectionId: s.id,
      name: s.name,
      avgScore: agg && count > 0 ? Math.round((agg.score / count) * 10) / 10 : null,
      maxScore: agg && count > 0 ? Math.round(agg.max / count) : 0,
      avgPercent: agg ? ratePercent(agg.score, agg.max) : null,
    };
  });

  // QUESTION-LEVEL (only when breakdown data exists).
  const hasQuestionData = graded.some((a) => a.breakdown.length > 0);
  const qAgg = new Map<
    string,
    { text: string; section: string; maxMarks: number; correct: number; total: number }
  >();
  if (hasQuestionData) {
    for (const a of graded) {
      for (const s of a.breakdown) {
        for (const q of s.questions ?? []) {
          if (!q.questionId) continue;
          const cur =
            qAgg.get(q.questionId) ??
            { text: q.text ?? "", section: s.name ?? "", maxMarks: q.maxMarks ?? 0, correct: 0, total: 0 };
          cur.total += 1;
          const max = q.maxMarks ?? 0;
          if (max > 0 && (q.awardedMarks ?? 0) >= max) cur.correct += 1;
          if (!cur.text && q.text) cur.text = q.text;
          qAgg.set(q.questionId, cur);
        }
      }
    }
  }
  const questions: ExamQuestionStat[] = [...qAgg.entries()]
    .map(([questionId, v]) => ({
      questionId,
      section: v.section,
      text: v.text,
      maxMarks: v.maxMarks,
      correct: v.correct,
      total: v.total,
      correctRate: ratePercent(v.correct, v.total),
    }))
    // Most-missed first (lowest correct-rate); nulls (no data) sort last.
    .sort((a, b) => (a.correctRate ?? 101) - (b.correctRate ?? 101));

  // BY ORG-UNIT (student dept/section rollup).
  const units: ExamUnitStat[] = g.unitDocs.map((unit) => {
    const subtree = new Set(collectDescendantUnitIds(g.unitRefs, [unit.id]));
    const inUnit = graded.filter(
      (a) => a.orgUnitId !== null && subtree.has(a.orgUnitId),
    );
    const p = inUnit.map((a) => a.percent ?? 0);
    return {
      id: unit.id,
      name: unit.name,
      type: unit.type,
      parentId: unit.parentId,
      students: inUnit.length,
      avgPercent:
        inUnit.length === 0
          ? null
          : Math.round((p.reduce((s, v) => s + v, 0) / inUnit.length) * 10) / 10,
      passRate: ratePercent(inUnit.filter((a) => a.passed).length, inUnit.length),
    };
  });

  const students: ExamStudentResult[] = graded.map((a) => ({
    attemptId: a.attemptId,
    userId: a.userId,
    name: a.name,
    rollNumber: a.rollNumber,
    orgUnitId: a.orgUnitId,
    score: a.score,
    percent: a.percent,
    passed: a.passed,
    status: a.status,
  }));

  return {
    examId: g.examId,
    examTitle: g.examTitle,
    totalMarks: g.totalMarks,
    passPercentage: g.passPercentage,
    hasQuestionData,
    overview,
    distribution,
    passFail,
    sections,
    questions,
    units,
    students,
  };
}

// --- Report data (adds per-student section scores for the Results sheet) -----

export interface ExamReportData {
  analysis: ExamAnalysisResponse;
  sectionNames: string[];
  rows: {
    name: string;
    rollNumber: string;
    score: number;
    percent: number | null;
    passed: boolean;
    sectionScores: number[];
  }[];
}

export async function examReportData(
  collegeId: string,
  actor: ExamActor,
  examId: string,
): Promise<ExamReportData> {
  const g = await gather(collegeId, actor, examId);
  const analysis = await getExamAnalysis(collegeId, actor, examId);
  const sectionNames = g.sectionOrder.map((s) => s.name);

  const rows = g.graded
    .slice()
    .sort((a, b) => b.score - a.score)
    .map((a) => {
      const scoreBySection = new Map(
        a.breakdown.filter((s) => s.sectionId).map((s) => [s.sectionId!, s.score ?? 0]),
      );
      return {
        name: a.name,
        rollNumber: a.rollNumber,
        score: a.score,
        percent: a.percent,
        passed: a.passed,
        sectionScores: g.sectionOrder.map((s) => scoreBySection.get(s.id) ?? 0),
      };
    });

  return { analysis, sectionNames, rows };
}
