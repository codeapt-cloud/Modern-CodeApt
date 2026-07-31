/**
 * Piston client — the only place that talks to the code-execution sandbox.
 * Config-driven (base URL + optional extra header from env), with a hard
 * per-request timeout and defensive parsing of Piston's response shape.
 *
 * Piston's `POST /execute` returns:
 *   { language, version, run: { stdout, stderr, code, signal, output },
 *     compile?: { stdout, stderr, code, signal, output } }
 * We normalize that into `RunOutput`s the grader/result schema understand.
 */
import {
  PISTON_RUNTIMES,
  PISTON_SOURCE_FILENAME,
  type CodeLanguage,
  type RunOutput,
} from "@codeapt/shared";

import { env } from "../config/env.js";
import { logger } from "./logger.js";

/** Raised for any Piston failure (network, timeout, non-2xx, bad body). */
export class PistonError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "PistonError";
  }
}

export interface PistonExecuteInput {
  language: CodeLanguage;
  source: string;
  stdin?: string;
}

export interface PistonExecuteResult {
  language: string;
  version: string;
  run: RunOutput;
  /** Present for compiled languages; null when Piston reports no compile step. */
  compile: RunOutput | null;
  /** True when the process was killed by a signal (timeout / OOM / etc.). */
  timedOut: boolean;
}

interface PistonRawStage {
  stdout?: unknown;
  stderr?: unknown;
  code?: unknown;
  signal?: unknown;
}
interface PistonRawResponse {
  language?: unknown;
  version?: unknown;
  run?: PistonRawStage;
  compile?: PistonRawStage;
  message?: unknown;
}

const asString = (v: unknown): string => (typeof v === "string" ? v : "");
const asCode = (v: unknown): number | null =>
  typeof v === "number" ? v : null;
const asSignal = (v: unknown): string | null =>
  typeof v === "string" && v.length > 0 ? v : null;

function toRunOutput(stage: PistonRawStage | undefined): RunOutput | null {
  if (!stage) return null;
  return {
    stdout: asString(stage.stdout),
    stderr: asString(stage.stderr),
    exitCode: asCode(stage.code),
    signal: asSignal(stage.signal),
  };
}

const COMPILED = new Set(["java", "cpp", "c"]);

/**
 * Offline/demo simulation of Piston (env PISTON_MOCK=true). Mirrors the
 * playground's seeded snippets — greet the first stdin line, or "world" — so a
 * demo without a reachable Piston still produces coherent, gradeable output.
 * A short delay makes the `processing` state observable. NOT used in prod.
 */
async function mockExecute(
  input: PistonExecuteInput,
): Promise<PistonExecuteResult> {
  await new Promise((resolve) => setTimeout(resolve, 450));
  const runtime = PISTON_RUNTIMES[input.language];
  const name = (input.stdin ?? "").split("\n")[0]?.trim() || "world";
  return {
    language: runtime.language,
    version: runtime.version,
    run: {
      stdout: `Hello, ${name}!\n`,
      stderr: "",
      exitCode: 0,
      signal: null,
    },
    compile: COMPILED.has(input.language)
      ? { stdout: "", stderr: "", exitCode: 0, signal: null }
      : null,
    timedOut: false,
  };
}

interface Runtime {
  language: string;
  version: string;
}

/**
 * One POST /execute against a SINGLE endpoint. Throws PistonError on any
 * failure (network, timeout, non-2xx, bad body). Timeout/parsing/normalization
 * are identical for the primary and the fallback — only the URL + headers vary.
 */
async function executeAgainst(
  url: string,
  headers: Record<string, string>,
  body: string,
  runtime: Runtime,
): Promise<PistonExecuteResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.PISTON_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${url.replace(/\/$/, "")}/execute`, {
      method: "POST",
      headers,
      body,
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new PistonError(
        `Execution timed out after ${env.PISTON_TIMEOUT_MS}ms.`,
        err,
      );
    }
    throw new PistonError("Could not reach the execution service.", err);
  } finally {
    clearTimeout(timer);
  }

  let parsed: PistonRawResponse;
  try {
    parsed = (await res.json()) as PistonRawResponse;
  } catch (err) {
    throw new PistonError(
      "Execution service returned an invalid response.",
      err,
    );
  }

  if (!res.ok) {
    const detail = asString(parsed.message) || `HTTP ${res.status}`;
    throw new PistonError(`Execution service error: ${detail}`);
  }

  const run = toRunOutput(parsed.run);
  if (!run) {
    throw new PistonError("Execution service returned no run output.");
  }
  const compile = toRunOutput(parsed.compile);

  return {
    language: asString(parsed.language) || runtime.language,
    version: asString(parsed.version) || runtime.version,
    run,
    compile,
    timedOut: run.signal !== null,
  };
}

/**
 * Execute a program run against Piston with resilience: try the primary
 * PISTON_URL first, then retry ONCE against PISTON_FALLBACK_URL (public emkc by
 * default) if it differs. A PistonError propagates only when BOTH endpoints
 * fail. The optional auth header is sent to the primary only; the public
 * fallback needs none. Throws PistonError on failure.
 */
export async function pistonExecute(
  input: PistonExecuteInput,
): Promise<PistonExecuteResult> {
  if (env.PISTON_MOCK) return mockExecute(input);

  if (!env.PISTON_URL) {
    throw new PistonError(
      "Code execution is not configured (PISTON_URL is unset).",
    );
  }

  const runtime = PISTON_RUNTIMES[input.language];
  const filename = PISTON_SOURCE_FILENAME[input.language];

  const primaryHeaders: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (env.PISTON_HEADER_NAME && env.PISTON_HEADER_VALUE) {
    primaryHeaders[env.PISTON_HEADER_NAME] = env.PISTON_HEADER_VALUE;
  }

  // Send "*" (any installed version) unless exact pinning is requested — see
  // PISTON_PIN_RUNTIME_VERSIONS. Piston treats the version as a semver selector.
  const version = env.PISTON_PIN_RUNTIME_VERSIONS ? runtime.version : "*";
  const body = JSON.stringify({
    language: runtime.language,
    version,
    files: [{ name: filename, content: input.source }],
    stdin: input.stdin ?? "",
  });

  const primary = env.PISTON_URL.replace(/\/$/, "");
  const fallback = env.PISTON_FALLBACK_URL.replace(/\/$/, "");
  const canFallback = fallback.length > 0 && fallback !== primary;

  try {
    const result = await executeAgainst(primary, primaryHeaders, body, runtime);
    logger.debug({ endpoint: primary }, "piston: primary endpoint served the run");
    return result;
  } catch (primaryErr) {
    if (!canFallback) throw primaryErr;
    logger.warn(
      { endpoint: primary, err: (primaryErr as Error).message },
      "piston: primary endpoint failed — retrying against fallback",
    );
    try {
      // Public fallback (emkc): no custom auth header.
      const result = await executeAgainst(
        fallback,
        { "Content-Type": "application/json" },
        body,
        runtime,
      );
      logger.info(
        { endpoint: fallback },
        "piston: fallback endpoint served the run",
      );
      return result;
    } catch (fallbackErr) {
      logger.error(
        { primary, fallback },
        "piston: primary AND fallback endpoints both failed",
      );
      throw fallbackErr;
    }
  }
}
