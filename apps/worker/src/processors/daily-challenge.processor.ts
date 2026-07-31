/**
 * Daily-challenge generation processor (runs on the `default` queue, dispatched
 * by job name). Fired by the IST cron scheduler (data `{}` → the current IST
 * day) and by the admin "Regenerate" button (data `{ dayKey, force }`). It
 * validates the payload, runs the generate→validate-by-execution→fallback
 * pipeline, and logs the outcome. Idempotent: a repeat/retry for an already-
 * published day is a no-op (the pipeline's date guard). Never throws for a
 * malformed payload — it defaults to "today, not forced".
 */
import { DAILY_CHALLENGE_JOB_NAME, dailyChallengeJobSchema } from "@codeapt/shared";
import type { Job, Processor } from "bullmq";

import { logger } from "../lib/logger.js";
import { runDailyChallengePipeline } from "../lib/daily-challenge/generator.js";

export { DAILY_CHALLENGE_JOB_NAME };

export const dailyChallengeProcessor: Processor = async (job: Job) => {
  const parsed = dailyChallengeJobSchema.safeParse(job.data ?? {});
  const data = parsed.success ? parsed.data : {};
  const outcome = await runDailyChallengePipeline({
    dayKey: data.dayKey,
    force: data.force,
  });
  logger.info(
    { jobId: job.id, ...outcome },
    `daily-challenge pipeline: ${outcome.status} (${outcome.dayKey})`,
  );
  return outcome;
};
