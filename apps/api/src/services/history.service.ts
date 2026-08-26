/**
 * Unified student attempt HISTORY (read-only). Walks a user's attempt stores
 * across every module — exams, speaking, essays, games — and derives the
 * COMMUNICATION composite roll-up from the same attempts, then returns one
 * date-sorted list. It REUSES each module's existing score math (exam marks,
 * essay finalScore, `speakingOverallPercent`, game compositeScore, and the
 * shared `computeComposite`) — no new scoring logic lives here.
 *
 * Surface scoping mirrors the rest of the app: the college (tenant) surface sees
 * attempts stamped with THIS college; the B2C/global surface sees attempts with
 * no college (platform / course-attached). The two never bleed into each other.
 *
 * Whisper visibility (Step 32): a speaking row carries the attempt's effective
 * engine and whether a browser attempt has been re-scored through Whisper, so a
 * student watching their history sees the score flip to the authoritative grade.
 */
import {
  HistoryModule,
  HistoryStatus,
  SpeechEngine,
  computeComposite,
  speakingOverallPercent,
  type HistoryEntry,
  type HistoryResponse,
} from "@codeapt/shared";
import { Types } from "mongoose";

import {
  ExamAttemptStatus,
  EssayStatus,
  GameSetAttemptStatus,
  JobStatus,
  SpeakingAttemptStatus,
} from "@codeapt/shared";
import { ExamModel, StudentExamAttemptModel } from "../models/assessment.model.js";
import { CommunicationAssessmentModel } from "../models/communication.model.js";
import { EssayAttemptModel, EssayTopicModel } from "../models/essay.model.js";
import { GameSetAttemptModel, GameSetModel } from "../models/game.model.js";
import {
  SpeakingAssessmentModel,
  SpeakingAttemptModel,
} from "../models/speaking.model.js";

const round1 = (n: number): number => Math.round(n * 10) / 10;
const iso = (d: Date | null | undefined): string | null =>
  d ? new Date(d).toISOString() : null;

/** The Mongo filter for the caller's attempts on the requested surface. A tenant
 *  read matches THIS college; a B2C read matches attempts with no college. */
function ownerFilter(
  userId: string,
  collegeId: string | null,
): Record<string, unknown> {
  return {
    user: new Types.ObjectId(userId),
    college: collegeId ? new Types.ObjectId(collegeId) : null,
  };
}

async function titleMap(
  model: { find: (q: unknown) => { select: (s: string) => { lean: () => Promise<Array<{ _id: Types.ObjectId; title?: string }>> } } },
  ids: Types.ObjectId[],
): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const docs = await model.find({ _id: { $in: ids } }).select("title").lean();
  return new Map(docs.map((d) => [d._id.toString(), d.title ?? "Untitled"]));
}

// --- Exams -----------------------------------------------------------------
async function examEntries(
  userId: string,
  collegeId: string | null,
  bestByRef: Map<string, number>,
): Promise<HistoryEntry[]> {
  const attempts = await StudentExamAttemptModel.find(ownerFilter(userId, collegeId))
    .select("exam status score passed isMalpractice startedAt completedAt")
    .lean();
  const examIds = [...new Set(attempts.map((a) => a.exam?.toString()).filter(Boolean))].map(
    (id) => new Types.ObjectId(id as string),
  );
  const exams = await ExamModel.find({ _id: { $in: examIds } })
    .select("title totalMarks resultsVisible")
    .lean();
  const meta = new Map(
    exams.map((e) => [
      e._id.toString(),
      { title: e.title ?? "Exam", totalMarks: e.totalMarks ?? 0, visible: e.resultsVisible !== false },
    ]),
  );

  return attempts.map((a): HistoryEntry => {
    const m = meta.get(a.exam?.toString() ?? "");
    const totalMarks = m?.totalMarks ?? 0;
    const done =
      a.status === ExamAttemptStatus.SUBMITTED ||
      a.status === ExamAttemptStatus.GRADED;
    const scored = done && totalMarks > 0;
    const rawPercent = scored ? round1(((a.score ?? 0) / totalMarks) * 100) : null;
    // Feed the composite roll-up (best scored attempt wins).
    if (rawPercent !== null) {
      const ref = a.exam!.toString();
      bestByRef.set(ref, Math.max(bestByRef.get(ref) ?? 0, rawPercent));
    }
    const visible = m?.visible ?? true;
    const status =
      a.status === ExamAttemptStatus.IN_PROGRESS
        ? HistoryStatus.IN_PROGRESS
        : a.status === ExamAttemptStatus.EXPIRED
          ? HistoryStatus.EXPIRED
          : HistoryStatus.GRADED;
    const scorePercent = visible ? rawPercent : null;
    return {
      module: HistoryModule.EXAM,
      attemptId: a._id.toString(),
      assessmentId: a.exam?.toString() ?? "",
      title: m?.title ?? "Exam",
      status,
      scorePercent,
      scoreLabel: !visible
        ? "Result hidden"
        : scorePercent === null
          ? statusLabel(status)
          : `${scorePercent}%`,
      passed: scored && visible ? !!a.passed : null,
      band: null,
      startedAt: iso(a.startedAt),
      completedAt: iso(a.completedAt),
      gradingPending: false,
      engine: null,
      rescored: false,
      flagged: !!a.isMalpractice,
    };
  });
}

// --- Speaking --------------------------------------------------------------
async function speakingEntries(
  userId: string,
  collegeId: string | null,
  bestByRef: Map<string, number>,
): Promise<HistoryEntry[]> {
  const attempts = await SpeakingAttemptModel.find(ownerFilter(userId, collegeId))
    .select("assessment status items startedAt submittedAt scoredAt rescoredAt terminated")
    .lean();
  const asmIds = [...new Set(attempts.map((a) => a.assessment?.toString()).filter(Boolean))].map(
    (id) => new Types.ObjectId(id as string),
  );
  const titles = await titleMap(SpeakingAssessmentModel as never, asmIds);

  return attempts.map((a): HistoryEntry => {
    const items = (a.items ?? []) as Array<{ subScores?: unknown; engine?: string }>;
    const percent = speakingOverallPercent(items.map((it) => it.subScores));
    if (percent !== null) {
      const ref = a.assessment!.toString();
      bestByRef.set(ref, Math.max(bestByRef.get(ref) ?? 0, percent));
    }
    const engines = items.map((it) => it.engine).filter(Boolean) as string[];
    const engine: SpeechEngine | null = engines.includes(SpeechEngine.BROWSER)
      ? SpeechEngine.BROWSER
      : engines.includes(SpeechEngine.WHISPER)
        ? SpeechEngine.WHISPER
        : null;

    let status: HistoryStatus;
    if (a.terminated) status = HistoryStatus.TERMINATED;
    else if (a.status === SpeakingAttemptStatus.IN_PROGRESS)
      status = HistoryStatus.IN_PROGRESS;
    else if (a.status === SpeakingAttemptStatus.SUBMITTED)
      status = HistoryStatus.GRADING; // whisper worker still running
    else if (a.status === SpeakingAttemptStatus.EXPIRED) status = HistoryStatus.EXPIRED;
    else status = HistoryStatus.GRADED;

    const grading = status === HistoryStatus.GRADING;
    const scorePercent = grading || status === HistoryStatus.IN_PROGRESS ? null : percent;
    return {
      module: HistoryModule.SPEAKING,
      attemptId: a._id.toString(),
      assessmentId: a.assessment?.toString() ?? "",
      title: titles.get(a.assessment?.toString() ?? "") ?? "Speaking",
      status,
      scorePercent,
      scoreLabel:
        scorePercent === null
          ? statusLabel(status)
          : `${scorePercent}%${engine === SpeechEngine.WHISPER || a.rescoredAt ? " · Whisper" : ""}`,
      passed: null,
      band: null,
      startedAt: iso(a.startedAt),
      completedAt: iso(a.scoredAt ?? a.submittedAt),
      gradingPending: grading,
      engine,
      rescored: !!a.rescoredAt,
      flagged: !!a.terminated,
    };
  });
}

// --- Essays ----------------------------------------------------------------
async function essayEntries(
  userId: string,
  collegeId: string | null,
  bestByRef: Map<string, number>,
): Promise<HistoryEntry[]> {
  const attempts = await EssayAttemptModel.find(ownerFilter(userId, collegeId))
    .select("essayTopic status finalScore gradingStatus submittedAt gradedAt startedAt isMalpractice")
    .lean();
  const topicIds = [...new Set(attempts.map((a) => a.essayTopic?.toString()).filter(Boolean))].map(
    (id) => new Types.ObjectId(id as string),
  );
  const titles = await titleMap(EssayTopicModel as never, topicIds);

  return attempts.map((a): HistoryEntry => {
    const done =
      a.status === EssayStatus.SUBMITTED ||
      a.status === EssayStatus.UNDER_REVIEW ||
      a.status === EssayStatus.GRADED;
    const scored =
      a.gradingStatus === JobStatus.COMPLETED || a.status === EssayStatus.GRADED;
    const percent = scored ? round1(a.finalScore ?? 0) : null;
    if (percent !== null) {
      const ref = a.essayTopic!.toString();
      bestByRef.set(ref, Math.max(bestByRef.get(ref) ?? 0, percent));
    }
    let status: HistoryStatus;
    if (a.status === EssayStatus.CANCELLED) status = HistoryStatus.ABANDONED;
    else if (a.status === EssayStatus.IN_PROGRESS || a.status === EssayStatus.DRAFT)
      status = HistoryStatus.IN_PROGRESS;
    else if (done && !scored) status = HistoryStatus.GRADING;
    else status = HistoryStatus.GRADED;

    return {
      module: HistoryModule.ESSAY,
      attemptId: a._id.toString(),
      assessmentId: a.essayTopic?.toString() ?? "",
      title: titles.get(a.essayTopic?.toString() ?? "") ?? "Essay",
      status,
      scorePercent: percent,
      scoreLabel: percent === null ? statusLabel(status) : `${percent}%`,
      passed: null,
      band: null,
      startedAt: iso(a.startedAt),
      completedAt: iso(a.gradedAt ?? a.submittedAt),
      gradingPending: status === HistoryStatus.GRADING,
      engine: null,
      rescored: false,
      flagged: !!a.isMalpractice,
    };
  });
}

// --- Games -----------------------------------------------------------------
async function gameEntries(
  userId: string,
  collegeId: string | null,
): Promise<HistoryEntry[]> {
  const attempts = await GameSetAttemptModel.find({
    ...ownerFilter(userId, collegeId),
    begunAt: { $ne: null }, // a resume-or-start that never began doesn't litter history
  })
    .select("gameSet status compositeScore isMalpractice startedAt completedAt")
    .lean();
  const setIds = [...new Set(attempts.map((a) => a.gameSet?.toString()).filter(Boolean))].map(
    (id) => new Types.ObjectId(id as string),
  );
  const titles = await titleMap(GameSetModel as never, setIds);

  return attempts.map((a): HistoryEntry => {
    const graded = a.status === GameSetAttemptStatus.GRADED;
    const status =
      a.status === GameSetAttemptStatus.IN_PROGRESS
        ? HistoryStatus.IN_PROGRESS
        : a.status === GameSetAttemptStatus.ABANDONED
          ? HistoryStatus.ABANDONED
          : HistoryStatus.GRADED;
    const scorePercent = graded ? round1(a.compositeScore ?? 0) : null;
    return {
      module: HistoryModule.GAME,
      attemptId: a._id.toString(),
      assessmentId: a.gameSet?.toString() ?? "",
      title: titles.get(a.gameSet?.toString() ?? "") ?? "Game set",
      status,
      scorePercent,
      scoreLabel: scorePercent === null ? statusLabel(status) : `${scorePercent}%`,
      passed: null,
      band: null,
      startedAt: iso(a.startedAt),
      completedAt: iso(a.completedAt),
      gradingPending: false,
      engine: null,
      rescored: false,
      flagged: !!a.isMalpractice,
    };
  });
}

// --- Communication composite (roll-up derived from the parts' best attempts) ---
async function communicationEntries(
  collegeId: string | null,
  bestByRef: Map<string, number>,
  latestByRef: Map<string, number>,
): Promise<HistoryEntry[]> {
  const touchedRefs = [...bestByRef.keys()];
  if (touchedRefs.length === 0) return [];
  const refObjs = touchedRefs.map((r) => new Types.ObjectId(r));
  const composites = await CommunicationAssessmentModel.find({
    college: collegeId ? new Types.ObjectId(collegeId) : null,
    "parts.ref": { $in: refObjs },
  })
    .select("title parts passPercentage distinctionPercentage")
    .lean();

  return composites.map((c): HistoryEntry => {
    const parts = (c.parts ?? []) as Array<{ ref: Types.ObjectId; weight?: number }>;
    const inputs = parts.map((p) => ({
      weight: p.weight ?? 1,
      percent: bestByRef.has(p.ref.toString()) ? bestByRef.get(p.ref.toString())! : null,
    }));
    const composite = computeComposite(
      inputs,
      c.passPercentage,
      c.distinctionPercentage,
    );
    const percent = composite.compositePercent;
    // Sort key: the most recent completion among this composite's parts.
    const lastMs = Math.max(
      0,
      ...parts.map((p) => latestByRef.get(p.ref.toString()) ?? 0),
    );
    return {
      module: HistoryModule.COMMUNICATION,
      attemptId: c._id.toString(),
      assessmentId: c._id.toString(),
      title: c.title ?? "Communication assessment",
      status: composite.partial ? HistoryStatus.IN_PROGRESS : HistoryStatus.GRADED,
      scorePercent: percent,
      scoreLabel:
        percent === null
          ? "Not started"
          : composite.partial
            ? `${percent}% so far`
            : `${percent}%`,
      passed: composite.band === null ? null : composite.band !== "fail",
      band: composite.band,
      startedAt: null,
      completedAt: lastMs > 0 ? new Date(lastMs).toISOString() : null,
      gradingPending: false,
      engine: null,
      rescored: false,
      flagged: false,
    };
  });
}

function statusLabel(status: HistoryStatus): string {
  switch (status) {
    case HistoryStatus.IN_PROGRESS:
      return "In progress";
    case HistoryStatus.GRADING:
      return "Grading…";
    case HistoryStatus.EXPIRED:
      return "Expired";
    case HistoryStatus.ABANDONED:
      return "Abandoned";
    case HistoryStatus.TERMINATED:
      return "Ended — flagged";
    default:
      return "Graded";
  }
}

/**
 * The unified history for one student on one surface. `collegeId` = the tenant
 * (college surface); `null` = the B2C/global surface.
 */
export async function getStudentHistory(
  userId: string,
  collegeId: string | null,
): Promise<HistoryResponse> {
  // bestByRef feeds the composite roll-up; latestByRef gives it a sort date.
  const bestByRef = new Map<string, number>();
  const latestByRef = new Map<string, number>();

  const [exams, speaking, essays, games] = await Promise.all([
    examEntries(userId, collegeId, bestByRef),
    speakingEntries(userId, collegeId, bestByRef),
    essayEntries(userId, collegeId, bestByRef),
    gameEntries(userId, collegeId),
  ]);

  // Record, per assessment ref, the latest completion time so the composite row
  // can sort alongside the individual attempts.
  for (const e of [...exams, ...speaking, ...essays]) {
    if (!e.assessmentId || !e.completedAt) continue;
    const ms = new Date(e.completedAt).getTime();
    latestByRef.set(e.assessmentId, Math.max(latestByRef.get(e.assessmentId) ?? 0, ms));
  }
  const communication = await communicationEntries(collegeId, bestByRef, latestByRef);

  const entries = [...exams, ...speaking, ...essays, ...games, ...communication];
  // Newest first; an attempt with no completion (in progress) sorts by start.
  entries.sort((a, b) => {
    const ta = new Date(a.completedAt ?? a.startedAt ?? 0).getTime();
    const tb = new Date(b.completedAt ?? b.startedAt ?? 0).getTime();
    return tb - ta;
  });
  return { entries };
}
