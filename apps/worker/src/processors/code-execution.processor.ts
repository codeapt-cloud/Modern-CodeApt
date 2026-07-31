/**
 * Real code-execution processor. Replaces the no-op for the playground /
 * practice / assessment queues.
 *
 * Lifecycle (idempotent + crash-safe):
 *   1. Parse the job payload; a malformed one is logged and dropped.
 *   2. Load the ExecutionJob doc; skip if it is already finalized (a retry or
 *      duplicate delivery must not re-run or overwrite a result).
 *   3. Atomically flip queued → processing.
 *   4. Run on Piston — a plain run, or one run per test case then grade.
 *   5. Write status=completed + result, or status=failed + a clear error.
 * Every path is wrapped so a thrown error becomes a failed job, never a crashed
 * worker.
 */
import {
  JobStatus,
  codeExecutionJobSchema,
  runTestCases,
  type CodeExecutionJob,
  type ExecutionResult,
  type QueueName,
  type RunOutput,
} from "@codeapt/shared";
import type { Job, Processor } from "bullmq";

import { logger } from "../lib/logger.js";
import { PistonError, pistonExecute } from "../lib/piston.js";
import { ExecutionJobModel } from "../models/execution.model.js";

const FINALIZED: readonly JobStatus[] = [JobStatus.COMPLETED, JobStatus.FAILED];

/** A plain (ungraded) run: execute once, no test cases. */
async function plainRun(payload: CodeExecutionJob): Promise<ExecutionResult> {
  const exec = await pistonExecute({
    language: payload.language,
    source: payload.source,
    stdin: payload.stdin,
  });
  return {
    language: payload.language,
    version: exec.version,
    compile: exec.compile,
    run: exec.run,
    timedOut: exec.timedOut,
    testResults: null,
    passedCount: null,
    totalCount: null,
  };
}

/** A graded run: execute once per test case (input → stdin), then grade. */
async function gradedRun(
  payload: CodeExecutionJob,
  testCases: CodeExecutionJob["testCases"] & object,
): Promise<ExecutionResult> {
  let version = "";
  let firstRun: RunOutput | null = null;
  let firstCompile: RunOutput | null = null;
  let timedOut = false;

  const executed = [];
  for (const tc of testCases) {
    const exec = await pistonExecute({
      language: payload.language,
      source: payload.source,
      stdin: tc.input,
    });
    version ||= exec.version;
    firstRun ??= exec.run;
    if (firstCompile === null) firstCompile = exec.compile;
    if (exec.timedOut) timedOut = true;
    executed.push({
      input: tc.input,
      expectedOutput: tc.expectedOutput,
      actualOutput: exec.run.stdout,
      stderr: exec.run.stderr,
    });
  }

  const graded = runTestCases(executed);
  return {
    language: payload.language,
    version,
    compile: firstCompile,
    run: firstRun ?? { stdout: "", stderr: "", exitCode: null, signal: null },
    timedOut,
    testResults: graded.results,
    passedCount: graded.passedCount,
    totalCount: graded.totalCount,
  };
}

/** Build the code-execution processor for a given queue (used by 3 queues). */
export function makeCodeExecutionProcessor(queue: QueueName): Processor {
  return async (job: Job): Promise<{ ok: boolean }> => {
    const parsed = codeExecutionJobSchema.safeParse(job.data);
    if (!parsed.success) {
      logger.error(
        { queue, jobId: job.id, issues: parsed.error.issues },
        "invalid code-execution payload — dropping",
      );
      return { ok: false };
    }
    const payload = parsed.data;
    const log = logger.child({ queue, jobId: payload.jobId });

    const doc = await ExecutionJobModel.findOne({ jobId: payload.jobId });
    if (!doc) {
      log.warn("ExecutionJob doc not found — nothing to update");
      return { ok: false };
    }
    if (FINALIZED.includes(doc.status as JobStatus)) {
      log.info({ status: doc.status }, "job already finalized — skipping");
      return { ok: true };
    }

    // Atomically claim the job (queued/processing → processing).
    await ExecutionJobModel.updateOne(
      { jobId: payload.jobId, status: { $nin: FINALIZED } },
      { $set: { status: JobStatus.PROCESSING, startedAt: new Date() } },
    );
    log.info({ language: payload.language }, "processing");

    try {
      const result =
        payload.testCases && payload.testCases.length > 0
          ? await gradedRun(payload, payload.testCases)
          : await plainRun(payload);

      await ExecutionJobModel.updateOne(
        { jobId: payload.jobId, status: { $nin: FINALIZED } },
        {
          $set: {
            status: JobStatus.COMPLETED,
            result,
            error: null,
            completedAt: new Date(),
          },
        },
      );
      log.info(
        { passed: result.passedCount, total: result.totalCount },
        "completed",
      );
      return { ok: true };
    } catch (err) {
      const message =
        err instanceof PistonError
          ? err.message
          : "Execution failed unexpectedly.";
      log.error({ err }, "execution failed");
      await ExecutionJobModel.updateOne(
        { jobId: payload.jobId, status: { $nin: FINALIZED } },
        {
          $set: {
            status: JobStatus.FAILED,
            error: message,
            completedAt: new Date(),
          },
        },
      );
      // Do NOT rethrow: a failed execution is a finalized job, not a worker
      // crash. Returning normally prevents BullMQ from retrying a bad payload.
      return { ok: false };
    }
  };
}
