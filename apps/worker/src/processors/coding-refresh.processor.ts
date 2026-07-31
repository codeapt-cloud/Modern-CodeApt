/**
 * Coding-profile refresh processors:
 *   - SWEEP (on the `default` queue, name-dispatched): find every student with
 *     at least one linked handle and fan out a per-student refresh job onto the
 *     rate-limited `coding-refresh` queue. Never fetches anything itself.
 *   - STUDENT (on the `coding-refresh` queue): refresh ONE student via the
 *     store-injected pipeline (isolated per-platform fetch, keep last-known on
 *     failure). A single student's failure never affects the others (its own job).
 */
import {
  CODING_REFRESH_STUDENT_JOB_NAME,
  CODING_REFRESH_SWEEP_JOB_NAME,
  codingRefreshStudentJobSchema,
  type CodingRefreshStudentJob,
} from "@codeapt/shared";
import type { Job, Processor } from "bullmq";

import { buildRefreshDeps } from "../lib/coding-refresh/store.js";
import { enqueueStudentRefreshJobs } from "../lib/coding-refresh/queue.js";
import { refreshCodingProfile } from "../lib/coding-refresh/refresh.js";
import { logger } from "../lib/logger.js";
import { CodingProfileModel } from "../models/coding-profile.model.js";

export { CODING_REFRESH_STUDENT_JOB_NAME, CODING_REFRESH_SWEEP_JOB_NAME };

/** Find every profile with at least one non-empty handle and fan out. */
export const codingRefreshSweepProcessor: Processor = async (job: Job) => {
  const docs = await CodingProfileModel.find(
    {
      $or: [
        { "handles.codeforces": { $nin: ["", null] } },
        { "handles.leetcode": { $nin: ["", null] } },
        { "handles.codechef": { $nin: ["", null] } },
      ],
    },
    { college: 1, user: 1 },
  ).lean();

  const pairs: CodingRefreshStudentJob[] = docs.map((d) => ({
    collegeId: String(d.college),
    userId: String(d.user),
  }));
  const enqueued = await enqueueStudentRefreshJobs(pairs);
  logger.info(
    { jobId: job.id, linked: pairs.length, enqueued },
    `coding-refresh sweep: fanned out ${enqueued} student refresh job(s)`,
  );
  return { linked: pairs.length, enqueued };
};

/** Refresh ONE student's stored stats. */
export const codingRefreshStudentProcessor: Processor = async (job: Job) => {
  const parsed = codingRefreshStudentJobSchema.safeParse(job.data ?? {});
  if (!parsed.success) {
    logger.warn({ jobId: job.id }, "coding-refresh student job: bad payload, skipping");
    return { status: "bad_payload" as const };
  }
  const { collegeId, userId } = parsed.data;
  const outcome = await refreshCodingProfile(collegeId, userId, buildRefreshDeps());
  logger.info(
    { jobId: job.id, collegeId, userId, status: outcome.status, results: outcome.results },
    `coding-refresh student: ${outcome.status}`,
  );
  return outcome;
};
