/**
 * Producer for the rate-limited `coding-refresh` queue. Used by the daily SWEEP
 * to fan out one refresh job per linked student. Opens a short-lived queue +
 * Redis connection, enqueues, and closes — the sweep runs once a day, so there
 * is no long-lived producer to manage. jobIds are de-duped per (college, user)
 * so a sweep overlapping an in-flight manual refresh collapses to one job.
 */
import {
  CODING_REFRESH_STUDENT_JOB_NAME,
  QueueName,
  type CodingRefreshStudentJob,
} from "@codeapt/shared";
import { Queue } from "bullmq";

import { createRedisConnection } from "../redis.js";

/** BullMQ forbids ':' in a custom job id (its Redis key separator) → use '-'. */
export function codingRefreshJobId(collegeId: string, userId: string): string {
  return `coding-refresh-${collegeId}-${userId}`;
}

export async function enqueueStudentRefreshJobs(
  pairs: CodingRefreshStudentJob[],
): Promise<number> {
  if (pairs.length === 0) return 0;
  const connection = createRedisConnection();
  const queue = new Queue(QueueName.CODING_REFRESH, { connection });
  try {
    let enqueued = 0;
    for (const p of pairs) {
      await queue.add(CODING_REFRESH_STUDENT_JOB_NAME, p, {
        jobId: codingRefreshJobId(p.collegeId, p.userId),
        attempts: 1,
        removeOnComplete: 500,
        removeOnFail: 500,
      });
      enqueued += 1;
    }
    return enqueued;
  } finally {
    await queue.close().catch(() => {});
    await connection.quit().catch(() => {});
  }
}
