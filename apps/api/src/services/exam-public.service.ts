/**
 * Public (anonymous) exam access. A PublicExamLink carries a UUID token, an
 * active flag, and an optional [startTime, endTime] window — all enforced
 * server-side. Anonymous attempts capture rollNumber/collegeName (user=null)
 * and then use the SAME engine (authorized by the returned attempt token).
 */
import {
  ExamErrorCode,
  type PublicExamAvailability,
  type StartAttemptResponse,
} from "@codeapt/shared";

import { AppError } from "../errors/app-error.js";
import { assertAccessCode } from "../lib/access-code.js";
import { resolveExamDisplayTitle } from "../lib/exam-title.js";
import { PublicExamLinkModel, type Exam } from "../models/assessment.model.js";
import {
  buildSectionView,
  createAttempt,
  loadSections,
  requireExam,
} from "./exam.service.js";
import type { HydratedDocument } from "mongoose";

async function resolveLink(token: string) {
  const link = await PublicExamLinkModel.findOne({ accessToken: token });
  return link;
}

function windowReason(
  link: { isActive: boolean; startTime?: Date | null; endTime?: Date | null },
  now: Date,
): string | null {
  if (!link.isActive) return ExamErrorCode.LINK_UNAVAILABLE;
  if (link.startTime && now < link.startTime)
    return ExamErrorCode.LINK_UNAVAILABLE;
  if (link.endTime && now > link.endTime) return ExamErrorCode.LINK_UNAVAILABLE;
  return null;
}

export async function getPublicAvailability(
  token: string,
): Promise<PublicExamAvailability> {
  const link = await resolveLink(token);
  if (!link) {
    return {
      available: false,
      reason: ExamErrorCode.LINK_UNAVAILABLE,
      accessCodeEnabled: false,
      exam: null,
    };
  }
  const reason = windowReason(link, new Date());
  // Whether a start code is required — a boolean only, never the code itself.
  const accessCodeEnabled = link.accessCodeEnabled && link.accessCode.length > 0;
  if (reason)
    return { available: false, reason, accessCodeEnabled, exam: null };

  const exam = (await requireExam(
    link.exam.toString(),
  )) as HydratedDocument<Exam>;
  const sections = await loadSections(exam._id);
  const totalDurationMinutes = sections.reduce(
    (s, sec) => s + sec.durationMinutes,
    0,
  );
  return {
    available: true,
    reason: null,
    accessCodeEnabled,
    exam: {
      title: await resolveExamDisplayTitle(exam),
      totalMarks: exam.totalMarks,
      passPercentage: exam.passPercentage,
      sectionCount: sections.length,
      totalDurationMinutes,
    },
  };
}

export async function startPublicAttempt(
  token: string,
  identity: {
    fullName: string;
    gender: string;
    rollNumber: string;
    collegeName: string;
    accessCode?: string;
  },
): Promise<StartAttemptResponse> {
  const link = await resolveLink(token);
  if (!link) {
    throw new AppError(
      "This exam link is not available",
      403,
      ExamErrorCode.LINK_UNAVAILABLE,
    );
  }
  const reason = windowReason(link, new Date());
  if (reason) {
    throw new AppError(
      "This exam link is not available",
      403,
      ExamErrorCode.LINK_UNAVAILABLE,
    );
  }
  // Optional per-link start-code gate (no attempt counter here, but validate
  // before creating the attempt so a forged/blank code never starts one).
  assertAccessCode(link.accessCodeEnabled, link.accessCode, identity.accessCode);

  const exam = (await requireExam(
    link.exam.toString(),
  )) as HydratedDocument<Exam>;
  const sections = await loadSections(exam._id);
  if (sections.length === 0) {
    throw new AppError(
      "Exam has no sections",
      400,
      ExamErrorCode.EXAM_NOT_FOUND,
    );
  }

  const attempt = await createAttempt(exam, sections[0]!, {
    user: null,
    publicLink: link._id,
    rollNumber: identity.rollNumber,
    collegeName: identity.collegeName,
    candidateName: identity.fullName,
    gender: identity.gender,
  });
  const view = await buildSectionView(attempt, exam, sections, 0, new Date());
  return { ...view, attemptToken: attempt.attemptToken };
}
