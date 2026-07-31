/**
 * Automatic daily-challenge generator — the worker pipeline that guarantees a
 * valid daily coding challenge every day with ZERO manual upload:
 *
 *   1. IDEMPOTENCY — if the target IST day already has a challenge, no-op
 *      (unless `force`, the admin "Regenerate" path, which replaces it).
 *   2. GENERATE — ask the LLM gateway for a coding challenge (title, statement,
 *      starter, language, a REFERENCE SOLUTION, and 3–6 test cases). Malformed
 *      JSON is dropped.
 *   3. VALIDATE BY EXECUTION — run the AI's reference solution through Piston
 *      against every generated test case. The challenge PASSES only if the
 *      reference solution produces every expected output. This rejects the LLM's
 *      classic "unsolvable / wrong test case" failure — an AI challenge is NEVER
 *      published unless its own solution passes its own tests.
 *   4. PUBLISH — valid → create the challenge, source `ai`.
 *   5. FALLBACK — generation OR validation failed → an UNUSED global coding-bank
 *      question (its cases are curated → trusted), source `bank_fallback`; if the
 *      bank is empty → a built-in CURATED problem, source `curated_fallback`. So
 *      a valid challenge is ALWAYS published, never empty, never broken.
 *
 * HONEST LIMITS: validate-by-execution catches AI challenges whose reference
 * solution fails — it does NOT prove the problem is "good", only self-consistent.
 * Bank/curated fallbacks are trusted as authored (not re-validated), so the day
 * is still covered when Piston is unavailable. Provenance is always recorded.
 *
 * Everything is injectable (store / llm / piston / clock) so the decision logic
 * is unit-tested with in-memory fakes — no Mongo, LLM, or Piston in tests.
 */
import {
  CodeLanguage,
  DailyChallengeSource,
  DailyQuestionType,
  aiDailyChallengeSchema,
  istDayKey,
  istDayRangeUtc,
  outputsMatch,
  type LlmChatConfig,
} from "@codeapt/shared";
import { Types } from "mongoose";
import { callLlmChatJson } from "@codeapt/shared";

import { env } from "../../config/env.js";
import { logger } from "../logger.js";
import { pistonExecute } from "../piston.js";
import {
  DailyQuestionModel,
  DailyTestCaseModel,
} from "../../models/challenge.model.js";
import { BankQuestionModel } from "../../models/question-bank.model.js";
import { CURATED_CHALLENGES } from "./curated.js";

// --- Shapes -----------------------------------------------------------------

export interface ChallengeTestCase {
  input: string;
  expectedOutput: string;
  isHidden: boolean;
}

/** The published challenge payload (source-agnostic; MCQ or CODE). */
export interface PublishSpec {
  questionType: DailyQuestionType;
  title: string;
  description: string;
  marks: number;
  // MCQ
  options?: string[];
  correctOption?: number;
  // CODE
  starterCode?: string;
  language?: CodeLanguage;
  testCases?: ChallengeTestCase[];
}

export interface Provenance {
  source: DailyChallengeSource;
  generatedAt: Date | null;
  validationNote: string;
  bankQuestionId: string | null;
}

/** A global coding-bank question adapted into a fallback candidate. */
export interface BankCandidate {
  id: string;
  spec: PublishSpec;
}

/** Persistence seam — the real impl is mongoose; tests inject a fake. */
export interface DailyChallengeStore {
  /** The existing challenge for the exact release instant, or null. */
  findByReleaseDate(releaseDate: Date): Promise<{ id: string } | null>;
  /** Delete an existing challenge (+ its test cases) — used by `force`. */
  remove(id: string): Promise<void>;
  /** Create the challenge + its test cases. Throws on a unique-date race. */
  create(
    releaseDate: Date,
    spec: PublishSpec,
    prov: Provenance,
  ): Promise<void>;
  /** Global CODE bank questions with ≥1 test case, adapted to candidates. */
  bankCandidates(): Promise<BankCandidate[]>;
  /** bankQuestionId → most recent releaseDate it was used on (LRU + used-set). */
  bankUsage(): Promise<Map<string, Date>>;
}

export interface GeneratorDeps {
  store: DailyChallengeStore;
  /** Returns raw parsed JSON from the LLM (or null when unavailable/failed). */
  llm: (dayKey: string) => Promise<unknown | null>;
  /** Runs `source` in `language` with `stdin`; returns stdout or throws. */
  piston: (
    language: CodeLanguage,
    source: string,
    stdin: string,
  ) => Promise<string>;
  now: () => Date;
}

export type PipelineStatus =
  | "skip"
  | "ai"
  | "bank_fallback"
  | "curated_fallback";

export interface PipelineOutcome {
  status: PipelineStatus;
  dayKey: string;
  message: string;
}

// --- Default (production) dependencies --------------------------------------

const SYSTEM_PROMPT =
  "You are a contest author creating ONE self-contained daily challenge — " +
  "either a CODE problem or a multiple-choice question (MCQ). Return STRICT " +
  "JSON ONLY (no prose, no code fences).\n" +
  'For CODE: {"questionType":"CODE","title":string,"statement":string,' +
  '"starterCode":string,"language":"python","referenceSolution":string,' +
  '"difficulty":"easy"|"medium"|"hard","testCases":[{"input":string,' +
  '"expectedOutput":string,"isHidden":boolean}]}. The program reads ALL input ' +
  "from stdin and writes ONLY the answer to stdout. `referenceSolution` MUST " +
  "be a COMPLETE Python 3 program that, for each test case's `input` on stdin, " +
  "prints EXACTLY that case's `expectedOutput`. Provide 3 to 5 cases, at least " +
  "one hidden.\n" +
  'For MCQ: {"questionType":"MCQ","title":string,"statement":string,' +
  '"difficulty":"easy"|"medium"|"hard","options":[string,...],' +
  '"correctOption":integer}. 3–5 options; `correctOption` is the 0-based index ' +
  "of the single correct option. Make it a substantive CS/programming concept " +
  "question with one unambiguous answer. Keep everything deterministic.";

function buildUserPrompt(dayKey: string): string {
  return (
    `Create the daily challenge for ${dayKey}. Prefer a CODE problem, but an ` +
    "MCQ is fine occasionally for variety. Make it beginner-to-intermediate " +
    "friendly and deterministic (no randomness, time, or network). For CODE, " +
    "ensure the reference solution truly produces each expected output. Vary " +
    "the topic from a plain 'sum two numbers'."
  );
}

async function defaultLlm(dayKey: string): Promise<unknown | null> {
  // With the gateway router installed, `config` is ignored; without a router
  // callLlmChatJson returns null (empty creds) → the pipeline falls back.
  const config: LlmChatConfig = {
    url: "",
    apiKey: "",
    model: "",
    timeoutMs: env.LLM_GATEWAY_TIMEOUT_MS,
  };
  return callLlmChatJson(config, SYSTEM_PROMPT, buildUserPrompt(dayKey), {
    kind: "generation",
    capability: "capable",
    maxTokens: 1500,
    feature: "daily_challenge",
  });
}

async function defaultPiston(
  language: CodeLanguage,
  source: string,
  stdin: string,
): Promise<string> {
  const result = await pistonExecute({ language, source, stdin });
  if (result.timedOut) throw new Error("reference solution timed out");
  return result.run.stdout;
}

/** The production mongoose-backed store. */
export function createDefaultStore(): DailyChallengeStore {
  return {
    async findByReleaseDate(releaseDate) {
      const q = await DailyQuestionModel.findOne({ releaseDate }).select("_id");
      return q ? { id: q._id.toString() } : null;
    },
    async remove(id) {
      await DailyTestCaseModel.deleteMany({ question: id });
      await DailyQuestionModel.deleteOne({ _id: id });
    },
    async create(releaseDate, spec, prov) {
      const isMcq = spec.questionType === DailyQuestionType.MCQ;
      const q = await DailyQuestionModel.create({
        questionType: spec.questionType,
        releaseDate,
        title: spec.title,
        description: spec.description,
        marks: spec.marks,
        // MCQ fields (undefined for CODE, matching the manual create path).
        options: isMcq ? (spec.options ?? []) : undefined,
        correctOption: isMcq ? (spec.correctOption ?? 0) : undefined,
        // CODE fields.
        starterCode: isMcq ? "" : (spec.starterCode ?? ""),
        language: spec.language ?? CodeLanguage.PYTHON,
        source: prov.source,
        generatedAt: prov.generatedAt,
        validationNote: prov.validationNote,
        bankQuestion: prov.bankQuestionId
          ? new Types.ObjectId(prov.bankQuestionId)
          : null,
      });
      const cases = isMcq ? [] : (spec.testCases ?? []);
      if (cases.length) {
        await DailyTestCaseModel.insertMany(
          cases.map((tc) => ({
            question: q._id,
            inputData: tc.input,
            expectedOutput: tc.expectedOutput,
            isHidden: tc.isHidden,
          })),
        );
      }
    },
    async bankCandidates() {
      const docs = await BankQuestionModel.find({
        scope: "global",
        kind: "coding",
        college: null,
        "testCases.0": { $exists: true },
      }).sort({ createdAt: 1, _id: 1 });
      return docs.map((d) => ({
        id: d._id.toString(),
        spec: {
          questionType: DailyQuestionType.CODE,
          title: d.category ? `${d.category}: ${d.company}` : "Coding challenge",
          description: d.text,
          starterCode: d.starterCode ?? "",
          language: (d.language as CodeLanguage) ?? CodeLanguage.PYTHON,
          marks: d.marks ?? 5,
          testCases: (d.testCases ?? []).map((tc) => ({
            input: tc.inputData ?? "",
            expectedOutput: tc.expectedOutput ?? "",
            isHidden: tc.isHidden ?? false,
          })),
        },
      }));
    },
    async bankUsage() {
      const used = await DailyQuestionModel.find({
        bankQuestion: { $ne: null },
      }).select("bankQuestion releaseDate");
      const map = new Map<string, Date>();
      for (const q of used) {
        if (!q.bankQuestion) continue;
        const key = q.bankQuestion.toString();
        const prev = map.get(key);
        if (!prev || q.releaseDate > prev) map.set(key, q.releaseDate);
      }
      return map;
    },
  };
}

function defaultDeps(): GeneratorDeps {
  return {
    store: createDefaultStore(),
    llm: defaultLlm,
    piston: defaultPiston,
    now: () => new Date(),
  };
}

// --- Pipeline steps ---------------------------------------------------------

/** Generate + validate-by-execution. Returns a publishable spec or null. */
async function tryAi(
  dayKey: string,
  deps: GeneratorDeps,
): Promise<{ spec: PublishSpec; note: string } | null> {
  const raw = await deps.llm(dayKey);
  if (raw == null) return null;
  const parsed = aiDailyChallengeSchema.safeParse(raw);
  if (!parsed.success) {
    logger.warn({ dayKey }, "daily-challenge: AI output failed schema");
    return null;
  }
  const c = parsed.data;

  // MCQ: nothing to execute — the schema already enforced ≥2 options and an
  // in-range correct index. Honest note: not execution-validated.
  if (c.questionType === DailyQuestionType.MCQ) {
    return {
      spec: {
        questionType: DailyQuestionType.MCQ,
        title: c.title,
        description: c.statement,
        marks: 5,
        options: c.options,
        correctOption: c.correctOption,
      },
      note: "AI-generated MCQ (not execution-validated — MCQs cannot be)",
    };
  }

  // CODE: validate by execution — the reference solution must produce every
  // expected output. Any mismatch / timeout / executor error → reject (→ fallback).
  for (const tc of c.testCases) {
    let stdout: string;
    try {
      stdout = await deps.piston(c.language, c.referenceSolution, tc.input);
    } catch (err) {
      logger.warn({ dayKey, err }, "daily-challenge: reference exec error");
      return null;
    }
    if (!outputsMatch(tc.expectedOutput, stdout)) {
      logger.warn(
        { dayKey },
        "daily-challenge: reference solution failed a test case — rejecting",
      );
      return null;
    }
  }

  return {
    spec: {
      questionType: DailyQuestionType.CODE,
      title: c.title,
      description: c.statement,
      starterCode: c.starterCode,
      language: c.language,
      marks: 5,
      testCases: c.testCases.map((tc) => ({
        input: tc.input,
        expectedOutput: tc.expectedOutput,
        isHidden: tc.isHidden,
      })),
    },
    note: `AI-generated; reference solution passed all ${c.testCases.length} test cases`,
  };
}

/** Pick an unused global coding-bank question (LRU when all are used). */
async function pickBank(
  store: DailyChallengeStore,
): Promise<BankCandidate | null> {
  const candidates = await store.bankCandidates();
  if (candidates.length === 0) return null;
  const usage = await store.bankUsage();

  const unused = candidates.filter((c) => !usage.has(c.id));
  if (unused.length > 0) return unused[0] ?? null;

  // All used → least-recently-used (oldest last-used date first).
  const sorted = [...candidates].sort((a, b) => {
    const ta = usage.get(a.id)?.getTime() ?? 0;
    const tb = usage.get(b.id)?.getTime() ?? 0;
    return ta - tb;
  });
  logger.warn(
    "daily-challenge: all bank questions used — reusing the least-recent one",
  );
  return sorted[0] ?? null;
}

/** Deterministic curated pick — rotates by day so it varies day to day. */
function pickCurated(releaseDate: Date): PublishSpec {
  const dayOrdinal = Math.floor(releaseDate.getTime() / 86_400_000);
  const chosen =
    CURATED_CHALLENGES[
      ((dayOrdinal % CURATED_CHALLENGES.length) + CURATED_CHALLENGES.length) %
        CURATED_CHALLENGES.length
    ]!;
  return {
    questionType: DailyQuestionType.CODE,
    title: chosen.title,
    description: chosen.description,
    starterCode: chosen.starterCode,
    language: chosen.language,
    marks: 5,
    testCases: chosen.testCases.map((tc) => ({ ...tc })),
  };
}

// --- Public entrypoint ------------------------------------------------------

export interface PipelineOptions {
  /** IST day key (YYYY-MM-DD). Absent ⇒ the IST day that has just begun. */
  dayKey?: string;
  /** Replace an existing challenge for the day (admin regenerate). */
  force?: boolean;
  /** Injected dependencies (tests supply fakes). */
  deps?: GeneratorDeps;
}

export async function runDailyChallengePipeline(
  options: PipelineOptions = {},
): Promise<PipelineOutcome> {
  const deps = options.deps ?? defaultDeps();
  const now = deps.now();
  const dayKey = options.dayKey ?? istDayKey(now);
  const releaseDate = istDayRangeUtc(dayKey).start;

  // 1) Idempotency.
  const existing = await deps.store.findByReleaseDate(releaseDate);
  if (existing && !options.force) {
    return { status: "skip", dayKey, message: "already published" };
  }

  const publish = async (
    spec: PublishSpec,
    prov: Provenance,
  ): Promise<void> => {
    if (existing) await deps.store.remove(existing.id);
    await deps.store.create(releaseDate, spec, prov);
  };

  // 2+3) AI generate → validate-by-execution.
  const ai = await tryAi(dayKey, deps);
  if (ai) {
    await publish(ai.spec, {
      source: DailyChallengeSource.AI,
      generatedAt: now,
      validationNote: ai.note,
      bankQuestionId: null,
    });
    logger.info({ dayKey, source: "ai" }, "daily-challenge published");
    return { status: "ai", dayKey, message: ai.note };
  }

  // 5a) Bank fallback.
  const bank = await pickBank(deps.store);
  if (bank) {
    await publish(bank.spec, {
      source: DailyChallengeSource.BANK_FALLBACK,
      generatedAt: now,
      validationNote:
        "AI unavailable or failed validation; used a curated coding-bank question",
      bankQuestionId: bank.id,
    });
    logger.info(
      { dayKey, source: "bank_fallback", bankQuestionId: bank.id },
      "daily-challenge published",
    );
    return {
      status: "bank_fallback",
      dayKey,
      message: "published a coding-bank question",
    };
  }

  // 5b) Curated built-in fallback (guaranteed floor).
  logger.warn(
    { dayKey },
    "daily-challenge: AI + bank unavailable — using the built-in curated pool",
  );
  await publish(pickCurated(releaseDate), {
    source: DailyChallengeSource.CURATED_FALLBACK,
    generatedAt: now,
    validationNote:
      "AI and coding bank both unavailable; used a built-in curated challenge",
    bankQuestionId: null,
  });
  logger.info({ dayKey, source: "curated_fallback" }, "daily-challenge published");
  return {
    status: "curated_fallback",
    dayKey,
    message: "published a built-in curated challenge",
  };
}
