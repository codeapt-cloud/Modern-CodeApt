/**
 * Queue → processor map.
 *
 * - playground / practice / assessment: the real code-execution processor
 *   (Piston + optional test-case grading). The processor is generic; exam and
 *   daily-challenge grading extend it via the `assessment`/`practice` queues
 *   without changing this wiring.
 * - default: dispatches essay-grading jobs (name `grade-essay`) to the essay
 *   processor; anything else stays a logging no-op. Essay grading uses this
 *   reserved queue rather than a new one because it does NOT touch Piston and
 *   the code-execution queues stay dedicated to sandboxed runs.
 */
import { QueueName } from "@codeapt/shared";
import type { Job, Processor } from "bullmq";

import { logger } from "../lib/logger.js";
import { makeCodeExecutionProcessor } from "./code-execution.processor.js";
import {
  CODING_REFRESH_SWEEP_JOB_NAME,
  codingRefreshStudentProcessor,
  codingRefreshSweepProcessor,
} from "./coding-refresh.processor.js";
import {
  DAILY_CHALLENGE_JOB_NAME,
  dailyChallengeProcessor,
} from "./daily-challenge.processor.js";
import {
  ESSAY_GRADING_JOB_NAME,
  essayGradingProcessor,
} from "./essay-grading.processor.js";
import { pacedAiProcessor } from "./paced-ai.processor.js";

/** Logging no-op fallback for unrecognized `default`-queue jobs. */
async function noop(job: Job): Promise<{ ok: true }> {
  logger.info(
    { queue: QueueName.DEFAULT, jobId: job.id, name: job.name },
    `[${QueueName.DEFAULT}] received job (no-op)`,
  );
  return { ok: true };
}

/** The `default` queue carries essay grading, daily-challenge generation, and
 * miscellaneous no-op jobs — dispatched by job name. */
const defaultProcessor: Processor = async (job: Job) => {
  if (job.name === ESSAY_GRADING_JOB_NAME) {
    return essayGradingProcessor(job);
  }
  if (job.name === DAILY_CHALLENGE_JOB_NAME) {
    return dailyChallengeProcessor(job);
  }
  if (job.name === CODING_REFRESH_SWEEP_JOB_NAME) {
    return codingRefreshSweepProcessor(job);
  }
  return noop(job);
};

export const processors: Record<QueueName, Processor> = {
  [QueueName.DEFAULT]: defaultProcessor,
  [QueueName.PRACTICE]: makeCodeExecutionProcessor(QueueName.PRACTICE),
  [QueueName.ASSESSMENT]: makeCodeExecutionProcessor(QueueName.ASSESSMENT),
  [QueueName.PLAYGROUND]: makeCodeExecutionProcessor(QueueName.PLAYGROUND),
  // Rate-limited drain of governor-deferred non-urgent AI (see worker index).
  [QueueName.AI_PACED]: pacedAiProcessor,
  // Rate-limited per-student coding-profile refresh (see worker index).
  [QueueName.CODING_REFRESH]: codingRefreshStudentProcessor,
};
