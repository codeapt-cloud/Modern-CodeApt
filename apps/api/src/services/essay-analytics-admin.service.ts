/**
 * Essay-analytics ADMIN service (item 4-ii) — READ/reporting over essay attempts
 * and their anti-cheat analytics sidecar. Mirrors the user-admin read service
 * (thin, admin-guarded at the route; AppError envelope; no writes).
 *
 * THE HONESTY CRUX: `recordAnalytics` persists only genuine compose signals
 * (keystrokes/deletes/pastes/pastedChars/composeSeconds/word+char counts). It
 * NEVER computes `riskScore` / `suspiciousActivity` (no formula is wired), so
 * those stored values stay at their schema defaults. This service surfaces the
 * REAL signals and returns `riskScoring.wired: false` so the UI can render an
 * explicit "not yet computed" state instead of presenting a fabricated score.
 */
import {
  EssayErrorCode,
  computeEssayRisk,
  type AdminEssayAnalyticsListQuery,
  type AdminEssayAnalyticsListResponse,
  type AdminEssayAttemptAnalytics,
} from "@codeapt/shared";
import { Types } from "mongoose";

import { AppError } from "../errors/app-error.js";
import {
  EssayAnalyticsModel,
  EssayAttemptModel,
} from "../models/essay.model.js";
import { ProfileModel } from "../models/user.model.js";

function iso(d: Date | null | undefined): string | null {
  return d ? new Date(d).toISOString() : null;
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

export async function listEssayAnalyticsAdmin(
  query: AdminEssayAnalyticsListQuery,
): Promise<AdminEssayAnalyticsListResponse> {
  const { essayTopic, status, page, pageSize } = query;

  const match: Record<string, unknown> = {};
  if (status) match.status = status;
  if (essayTopic && Types.ObjectId.isValid(essayTopic)) {
    match.essayTopic = new Types.ObjectId(essayTopic);
  }

  const rows = await EssayAttemptModel.aggregate<{
    items: {
      _id: Types.ObjectId;
      finalScore: number;
      status: string;
      submittedAt?: Date;
      student?: string;
      topic?: string;
      keystrokes: number;
      deletes: number;
      pasteEvents: number;
      pastedChars: number;
      composeSeconds: number;
      finalWordCount: number;
      finalCharacterCount: number;
      hasAnalytics: boolean;
    }[];
    total: { n: number }[];
  }>([
    { $match: match },
    { $sort: { createdAt: -1, _id: -1 } },
    {
      $facet: {
        items: [
          { $skip: (page - 1) * pageSize },
          { $limit: pageSize },
          {
            $lookup: {
              from: "profiles",
              localField: "user",
              foreignField: "user",
              as: "profile",
            },
          },
          { $unwind: { path: "$profile", preserveNullAndEmptyArrays: true } },
          {
            $lookup: {
              from: "essaytopics",
              localField: "essayTopic",
              foreignField: "_id",
              as: "topicDoc",
            },
          },
          { $unwind: { path: "$topicDoc", preserveNullAndEmptyArrays: true } },
          {
            $lookup: {
              from: "essayanalytics",
              localField: "_id",
              foreignField: "attempt",
              as: "analytics",
            },
          },
          { $unwind: { path: "$analytics", preserveNullAndEmptyArrays: true } },
          {
            $project: {
              finalScore: 1,
              status: 1,
              submittedAt: 1,
              student: "$profile.fullName",
              topic: "$topicDoc.title",
              keystrokes: { $ifNull: ["$analytics.typingEvents", 0] },
              deletes: { $ifNull: ["$analytics.deleteEvents", 0] },
              pasteEvents: { $ifNull: ["$analytics.pasteEvents", 0] },
              pastedChars: { $ifNull: ["$analytics.pastedChars", 0] },
              composeSeconds: { $ifNull: ["$analytics.composeSeconds", 0] },
              finalWordCount: { $ifNull: ["$analytics.finalWordCount", 0] },
              finalCharacterCount: {
                $ifNull: ["$analytics.finalCharacterCount", 0],
              },
              hasAnalytics: { $cond: [{ $ifNull: ["$analytics", false] }, true, false] },
            },
          },
        ],
        total: [{ $count: "n" }],
      },
    },
  ]);

  const facet = rows[0] ?? { items: [], total: [] };
  return {
    items: facet.items.map((a) => {
      // Advisory risk recomputed from the stored signals (source of truth for
      // display — consistent for legacy rows written before scoring existed).
      const risk = a.hasAnalytics
        ? computeEssayRisk({
            keystrokes: a.keystrokes,
            deletes: a.deletes,
            pasteEvents: a.pasteEvents,
            pastedChars: a.pastedChars,
            composeSeconds: a.composeSeconds,
            wordCount: a.finalWordCount,
            characterCount: a.finalCharacterCount,
          })
        : { riskScore: 0, level: "low" as const, suspicious: false, reasons: [] };
      return {
        attemptId: a._id.toString(),
        student: a.student ?? "(unknown)",
        topic: a.topic ?? "(removed prompt)",
        finalScore: a.finalScore,
        status: a.status,
        submittedAt: iso(a.submittedAt),
        hasAnalytics: a.hasAnalytics,
        pasteEvents: a.pasteEvents,
        pastedChars: a.pastedChars,
        riskScore: risk.riskScore,
        riskLevel: risk.level,
        suspicious: risk.suspicious,
      };
    }),
    total: facet.total[0]?.n ?? 0,
    page,
    pageSize,
  };
}

// ---------------------------------------------------------------------------
// Per-attempt detail
// ---------------------------------------------------------------------------

export async function getEssayAttemptAnalyticsAdmin(
  attemptId: string,
): Promise<AdminEssayAttemptAnalytics> {
  if (!Types.ObjectId.isValid(attemptId)) {
    throw new AppError(
      "Essay attempt not found",
      404,
      EssayErrorCode.SUBMISSION_NOT_FOUND,
    );
  }
  const attempt = await EssayAttemptModel.findById(attemptId).populate<{
    essayTopic: { title: string } | null;
  }>("essayTopic", "title");
  if (!attempt) {
    throw new AppError(
      "Essay attempt not found",
      404,
      EssayErrorCode.SUBMISSION_NOT_FOUND,
    );
  }

  const [profile, analytics] = await Promise.all([
    ProfileModel.findOne({ user: attempt.user }).lean<{ fullName: string } | null>(),
    EssayAnalyticsModel.findOne({ attempt: attempt._id }).lean<{
      typingEvents: number;
      deleteEvents: number;
      pasteEvents: number;
      pastedChars: number;
      composeSeconds: number;
      finalWordCount: number;
      finalCharacterCount: number;
      riskScore: number;
      suspiciousActivity: boolean;
    } | null>(),
  ]);

  const assessment = analytics
    ? computeEssayRisk({
        keystrokes: analytics.typingEvents,
        deletes: analytics.deleteEvents,
        pasteEvents: analytics.pasteEvents,
        pastedChars: analytics.pastedChars,
        composeSeconds: analytics.composeSeconds,
        wordCount: analytics.finalWordCount,
        characterCount: analytics.finalCharacterCount,
      })
    : { riskScore: 0, level: "low" as const, suspicious: false, reasons: [] };
  const risk = {
    wired: true,
    riskScore: assessment.riskScore,
    level: assessment.level,
    suspiciousActivity: assessment.suspicious,
    reasons: assessment.reasons,
  };

  return {
    attemptId: attempt._id.toString(),
    student: profile?.fullName ?? "(unknown)",
    topic: attempt.essayTopic?.title ?? "(removed prompt)",
    finalScore: attempt.finalScore,
    status: attempt.status,
    submittedAt: iso(attempt.submittedAt),
    wordCount: attempt.wordCount,
    characterCount: attempt.characterCount,
    hasAnalytics: analytics !== null,
    signals: analytics
      ? {
          keystrokes: analytics.typingEvents,
          deletes: analytics.deleteEvents,
          pasteEvents: analytics.pasteEvents,
          pastedChars: analytics.pastedChars,
          composeSeconds: analytics.composeSeconds,
          finalWordCount: analytics.finalWordCount,
          finalCharacterCount: analytics.finalCharacterCount,
        }
      : null,
    // ADVISORY risk, recomputed server-side from the stored signals (never a
    // client value; consistent for legacy rows). A review aid only — it does
    // NOT penalize the student or affect the grade.
    riskScoring: risk,
  };
}
