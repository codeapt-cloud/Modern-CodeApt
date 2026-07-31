/**
 * Essay-topic (prompt) ADMIN service — CRUD over the EssayTopic model that the
 * essay flow grades against and that curriculum essay-type Topics link to.
 * Mirrors the coupon/curriculum admin pattern (thin, zod-validated writes behind
 * requireAdmin; AppError envelope).
 *
 * Keywords (`semanticKeywords`) are authored MANUALLY here — they feed the
 * grader's relevance dimension. The original Django admin had a "Generate AI
 * Keywords" action, but the rebuild's essay-AI is grading-only (and `mock` by
 * default); there is no keyword-generation path, so AI generation is flagged in
 * the UI as awaiting that integration rather than faked.
 *
 * Delete semantics: BLOCK hard-delete when EssayAttempts reference the prompt
 * (409 DELETE_BLOCKED, details.blockers = { attempts }) — never orphan student
 * attempts. Otherwise SET_NULL any curriculum Topic.essayTopic links (the
 * original's on_delete=SET_NULL) and delete. The honest "retire" is deactivation
 * (isActive=false), offered as an editor field and a one-click list toggle.
 */
import {
  EssayTopicErrorCode,
  callLlmChatJson,
  hasLlmRouter,
  extractKeywordsDeterministic,
  normalizeKeywords,
  type AdminEssayTopic,
  type AdminEssayTopicListResponse,
  type AdminEssayTopicUpsert,
  type EssayDifficulty,
  type GenerateKeywordsRequest,
  type GenerateKeywordsResponse,
} from "@codeapt/shared";
import { Types, type HydratedDocument, type Model } from "mongoose";

import { env } from "../config/env.js";
import { AppError } from "../errors/app-error.js";
import { logger } from "../lib/logger.js";
import { TopicModel } from "../models/curriculum.model.js";
import {
  EssayAttemptModel,
  EssayTopicModel,
  type EssayTopic,
} from "../models/essay.model.js";

type EssayTopicDoc = HydratedDocument<EssayTopic>;

function objectId(id: string): Types.ObjectId {
  if (!Types.ObjectId.isValid(id)) {
    throw new AppError(
      "Essay prompt not found",
      404,
      EssayTopicErrorCode.ESSAY_TOPIC_NOT_FOUND,
    );
  }
  return new Types.ObjectId(id);
}

async function loadTopic(id: string): Promise<EssayTopicDoc> {
  const topic = await EssayTopicModel.findById(objectId(id));
  if (!topic) {
    throw new AppError(
      "Essay prompt not found",
      404,
      EssayTopicErrorCode.ESSAY_TOPIC_NOT_FOUND,
    );
  }
  return topic;
}

/** Group-count a collection by its `essayTopic` field → Map<id, count>. */
async function countByEssayTopic(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- heterogeneous models; only aggregate() is used
  model: Model<any>,
): Promise<Map<string, number>> {
  const rows = await model.aggregate<{ _id: Types.ObjectId | null; c: number }>([
    { $match: { essayTopic: { $ne: null } } },
    { $group: { _id: "$essayTopic", c: { $sum: 1 } } },
  ]);
  return new Map(rows.filter((r) => r._id).map((r) => [r._id!.toString(), r.c]));
}

function dedupeKeywords(keywords: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of keywords) {
    const k = raw.trim();
    if (!k) continue;
    const key = k.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(k);
  }
  return out;
}

function toAdminEssayTopic(
  t: EssayTopicDoc,
  attemptCount: number,
  linkedTopicCount: number,
): AdminEssayTopic {
  return {
    id: t._id.toString(),
    title: t.title,
    description: t.description,
    instructions: t.instructions,
    difficultyLevel: t.difficultyLevel as EssayDifficulty,
    minWords: t.minWords,
    maxWords: t.maxWords,
    timeLimitMinutes: t.timeLimitMinutes,
    maxAttempts: t.maxAttempts ?? 3,
    isActive: t.isActive,
    semanticKeywords: t.semanticKeywords,
    attemptCount,
    linkedTopicCount,
  };
}

function assignableFields(input: AdminEssayTopicUpsert): {
  title: string;
  description: string;
  instructions: string;
  difficultyLevel: EssayDifficulty;
  minWords: number;
  maxWords: number;
  timeLimitMinutes: number;
  maxAttempts: number;
  isActive: boolean;
  semanticKeywords: string[];
} {
  return {
    title: input.title.trim(),
    description: input.description,
    instructions: input.instructions,
    difficultyLevel: input.difficultyLevel,
    minWords: input.minWords,
    maxWords: input.maxWords,
    timeLimitMinutes: input.timeLimitMinutes,
    maxAttempts: input.maxAttempts,
    isActive: input.isActive,
    semanticKeywords: dedupeKeywords(input.semanticKeywords),
  };
}

// ---------------------------------------------------------------------------

export async function listEssayTopicsAdmin(): Promise<AdminEssayTopicListResponse> {
  const topics = await EssayTopicModel.find().sort({ createdAt: -1, _id: -1 });
  const [attemptCounts, linkedCounts] = await Promise.all([
    countByEssayTopic(EssayAttemptModel),
    countByEssayTopic(TopicModel),
  ]);
  return {
    items: topics.map((t) =>
      toAdminEssayTopic(
        t,
        attemptCounts.get(t._id.toString()) ?? 0,
        linkedCounts.get(t._id.toString()) ?? 0,
      ),
    ),
  };
}

async function counts(id: Types.ObjectId): Promise<[number, number]> {
  return Promise.all([
    EssayAttemptModel.countDocuments({ essayTopic: id }),
    TopicModel.countDocuments({ essayTopic: id }),
  ]);
}

export async function getEssayTopicAdmin(id: string): Promise<AdminEssayTopic> {
  const topic = await loadTopic(id);
  const [attemptCount, linkedTopicCount] = await counts(topic._id);
  return toAdminEssayTopic(topic, attemptCount, linkedTopicCount);
}

// ---------------------------------------------------------------------------
// Keyword generation (LLM-assisted, ADVISORY) — proposes keywords the admin
// reviews + edits + saves. Reuses the shared LLM client (5b); deterministic
// fallback guarantees a usable result. NEVER throws / never auto-saves.
// ---------------------------------------------------------------------------

const KEYWORD_SYSTEM_PROMPT =
  "You generate semantic keywords used to grade essay RELEVANCE. Given an essay " +
  "topic, return 8 to 15 concise keywords or short phrases (lowercase) naming " +
  "the key concepts, themes, and terms a strong response should address. No " +
  "trivial stopwords, no duplicates, no full sentences. Respond with STRICT " +
  'JSON ONLY — no prose, no code fences — exactly: {"keywords": ["...", "..."]}';

function buildKeywordUserPrompt(input: GenerateKeywordsRequest): string {
  return (
    `Title: ${input.title}\n\n` +
    `Description: ${input.description || "(none)"}\n\n` +
    `Instructions: ${input.instructions || "(none)"}`
  );
}

export async function generateKeywords(
  input: GenerateKeywordsRequest,
  collegeId?: string,
): Promise<GenerateKeywordsResponse> {
  const text = [input.title, input.description, input.instructions]
    .filter(Boolean)
    .join(" ");

  // Gateway installed → provider creds are in the DB; legacy env is unset and
  // ignored. Only require the env vars in the no-gateway fallback path.
  const llmConfigured =
    hasLlmRouter() ||
    (env.ESSAY_AI_PROVIDER === "llm" &&
      Boolean(env.ESSAY_LLM_URL) &&
      Boolean(env.ESSAY_LLM_API_KEY));

  if (llmConfigured) {
    try {
      const parsed = await callLlmChatJson(
        {
          url: env.ESSAY_LLM_URL,
          apiKey: env.ESSAY_LLM_API_KEY,
          model: env.ESSAY_LLM_MODEL,
          timeoutMs: env.ESSAY_AI_TIMEOUT_MS,
        },
        KEYWORD_SYSTEM_PROMPT,
        buildKeywordUserPrompt(input),
        // High-volume, simple task → prefer a FAST cheap model; a keyword list is
        // tiny, so cap output small. Cacheable (same topic text → same keywords).
        {
          kind: "generation",
          capability: "fast",
          maxTokens: 256,
          feature: "keywords",
          // Present only on the college route → charged to that college's credits;
          // the platform super-admin route passes none (uncharged).
          collegeId,
        },
      );
      const raw =
        parsed && typeof parsed === "object"
          ? (parsed as { keywords?: unknown }).keywords
          : undefined;
      const keywords = normalizeKeywords(raw);
      if (keywords.length > 0) return { keywords, source: "llm" };
      logger.warn("keyword LLM returned nothing usable — deterministic fallback");
    } catch (err) {
      // callLlmChatJson never throws, but stay defensive: never fail the request.
      logger.warn({ err }, "keyword generation LLM error — deterministic fallback");
    }
  }

  return { keywords: extractKeywordsDeterministic(text), source: "deterministic" };
}

export async function createEssayTopic(
  input: AdminEssayTopicUpsert,
): Promise<AdminEssayTopic> {
  const topic = await EssayTopicModel.create(assignableFields(input));
  return toAdminEssayTopic(topic, 0, 0);
}

export async function updateEssayTopic(
  id: string,
  input: AdminEssayTopicUpsert,
): Promise<AdminEssayTopic> {
  const topic = await loadTopic(id);
  topic.set(assignableFields(input));
  await topic.save();
  const [attemptCount, linkedTopicCount] = await counts(topic._id);
  return toAdminEssayTopic(topic, attemptCount, linkedTopicCount);
}

export async function setEssayTopicActive(
  id: string,
  isActive: boolean,
): Promise<AdminEssayTopic> {
  const topic = await loadTopic(id);
  topic.isActive = isActive;
  await topic.save();
  const [attemptCount, linkedTopicCount] = await counts(topic._id);
  return toAdminEssayTopic(topic, attemptCount, linkedTopicCount);
}

export async function deleteEssayTopic(id: string): Promise<{ deleted: true }> {
  const topic = await loadTopic(id);
  const attempts = await EssayAttemptModel.countDocuments({
    essayTopic: topic._id,
  });
  if (attempts > 0) {
    throw new AppError(
      `Cannot delete "${topic.title}" — students have attempts against it. Deactivate it instead to retire it.`,
      409,
      EssayTopicErrorCode.DELETE_BLOCKED,
      { blockers: { attempts } },
    );
  }
  // SET_NULL any curriculum essay-topic links (the original's on_delete=SET_NULL),
  // so an essay-type Topic is never left pointing at a deleted prompt.
  await TopicModel.updateMany(
    { essayTopic: topic._id },
    { $unset: { essayTopic: "" } },
  );
  await EssayTopicModel.deleteOne({ _id: topic._id });
  return { deleted: true };
}
