/**
 * Pure transform functions: one per source (Django/Neon) table → one rebuild
 * MongoDB document. NO database access here — every function takes a raw source
 * row + a context (new ObjectId, id-maps, report) and returns the target doc.
 * That keeps the whole mapping layer unit-testable without a live Neon.
 *
 * Conventions carried from the settled plan:
 *  - Money → integer PAISE (round(rupees × 100)); coupon percentage is a PERCENT
 *    and kept as-is.
 *  - Every row gets a fresh ObjectId; FKs are remapped through the parent's map;
 *    a nullable/absent FK → null; a non-null FK that doesn't resolve → null +
 *    flagged (never a broken ref).
 *  - Any source column with no native target is preserved under `_migrated`
 *    (and listed in the report), so nothing is silently dropped.
 *  - Enum values are translated through explicit maps; an unmapped value is
 *    flagged and falls back to the schema default (never silently dropped).
 *
 * Source table/column names follow Django's `app_model` / snake_case
 * conventions (see 01_CodeApt_Deep_Analysis.md). They are centralized in the
 * TABLES registry + the reads below so they are easy to adjust if the real
 * Neon schema differs.
 */
import { randomUUID } from "node:crypto";

import type { Types } from "mongoose";

import type { MigrationReport } from "./report.js";

export type SourceRow = Record<string, unknown>;
export type IdMap = Map<string, Types.ObjectId>;
export type IdMaps = Record<string, IdMap>;

export interface Hints {
  /** core_profile.force_password_change keyed by user id (for the User doc). */
  forcePwByUserId?: Map<string, boolean>;
  /**
   * section PG id → exam PG id. Django's ExamQuestion links only to a section
   * (no exam_id column), but the rebuild's ExamQuestion denormalizes `exam`, so
   * we derive it from the question's section here.
   */
  examPgIdBySectionPgId?: Map<string, string>;
}

export interface Ctx {
  /** The pre-generated ObjectId for THIS row (also recorded in its id-map). */
  id: Types.ObjectId;
  maps: IdMaps;
  report: MigrationReport;
  hints?: Hints;
}

// ---------------------------------------------------------------------------
// Primitive coercion (pg returns numerics as strings, json as parsed values)
// ---------------------------------------------------------------------------

function str(v: unknown): string {
  return v === null || v === undefined ? "" : String(v);
}
function bool(v: unknown): boolean {
  return v === true || v === "t" || v === "true" || v === 1;
}
function int(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}
function floatOr(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function date(v: unknown): Date | null {
  if (v === null || v === undefined || v === "") return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Round rupees → integer paise (decimal-safe minor units). */
export function rupeesToPaise(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

// ---------------------------------------------------------------------------
// Id remapping
// ---------------------------------------------------------------------------

/**
 * Resolve a source FK through its parent id-map. Null/absent → null (fine).
 * A NON-null id that doesn't resolve is flagged and returned null (never a
 * dangling ref).
 */
export function remap(
  map: IdMap | undefined,
  sourceId: unknown,
  ctx: Ctx,
  table: string,
  field: string,
): Types.ObjectId | null {
  if (sourceId === null || sourceId === undefined || sourceId === "") {
    return null;
  }
  const hit = map?.get(String(sourceId));
  if (hit) return hit;
  ctx.report.flagUnresolvedFk(table, field);
  return null;
}

// ---------------------------------------------------------------------------
// Enum translation (explicit maps; unmapped → flagged + fallback)
// ---------------------------------------------------------------------------

function translateEnum(
  map: Record<string, string>,
  raw: unknown,
  ctx: Ctx,
  table: string,
  field: string,
  fallback: string,
): string {
  const key = str(raw).trim().toLowerCase();
  if (key === "") return fallback; // absent → schema default, not a flag
  const hit = map[key];
  if (hit !== undefined) return hit;
  ctx.report.flagEnum(table, field, str(raw), fallback);
  return fallback;
}

// The FULL enum-translation table (source value, lowercased → rebuild value).
export const ENUM_MAPS = {
  orderStatus: {
    pending: "pending",
    success: "success",
    failed: "failed",
    created: "created",
    expired: "expired",
  } as Record<string, string>,
  couponDiscountType: {
    percentage: "percentage",
    fixed: "fixed",
  } as Record<string, string>,
  topicType: {
    text: "text",
    video: "video",
    quiz: "quiz",
    exam: "exam",
    essay: "essay",
  } as Record<string, string>,
  dailyQuestionType: {
    mcq: "MCQ",
    code: "CODE",
  } as Record<string, string>,
  examAttemptStatus: {
    in_progress: "in_progress",
    submitted: "submitted",
    graded: "graded",
    completed: "graded",
    expired: "expired",
  } as Record<string, string>,
  essayStatus: {
    draft: "DRAFT",
    in_progress: "IN_PROGRESS",
    submitted: "SUBMITTED",
    under_review: "UNDER_REVIEW",
    graded: "GRADED",
    cancelled: "CANCELLED",
  } as Record<string, string>,
  essayScoreSource: {
    ai_hybrid: "ai_hybrid",
    deterministic_fallback: "deterministic_fallback",
  } as Record<string, string>,
  gradingStatus: {
    queued: "queued",
    pending: "queued",
    processing: "processing",
    completed: "completed",
    graded: "completed",
    failed: "failed",
  } as Record<string, string>,
  jobApplicationStatus: {
    submitted: "SUBMITTED",
    under_review: "UNDER_REVIEW",
    shortlisted: "SHORTLISTED",
    rejected: "REJECTED",
    hired: "HIRED",
  } as Record<string, string>,
  postingType: {
    full_time: "full_time",
    "full-time": "full_time",
    "full time": "full_time",
    fulltime: "full_time",
    internship: "internship",
    intern: "internship",
    part_time: "part_time",
    "part-time": "part_time",
    "part time": "part_time",
    contract: "contract",
  } as Record<string, string>,
} as const;

// ---------------------------------------------------------------------------
// Unmapped-field preservation + timestamp carry-over
// ---------------------------------------------------------------------------

/**
 * Finalize a target doc: carry source created_at/updated_at (raw inserts bypass
 * mongoose timestamps, so we preserve the original timeline) and stash every
 * source column NOT explicitly consumed under `_migrated`, recording them in
 * the report. Returns the completed doc.
 */
function finish(
  doc: Record<string, unknown>,
  row: SourceRow,
  consumed: string[],
  table: string,
  ctx: Ctx,
): Record<string, unknown> {
  const consumedSet = new Set(consumed);
  // Preserve original timestamps when present.
  const created = date(row.created_at ?? row.date_joined ?? row.created);
  const updated = date(row.updated_at ?? row.modified ?? row.updated);
  if (created) doc.createdAt ??= created;
  if (updated) doc.updatedAt ??= updated;
  for (const k of ["created_at", "date_joined", "created", "updated_at", "modified", "updated"]) {
    consumedSet.add(k);
  }

  const migrated: Record<string, unknown> = {};
  const leftovers: string[] = [];
  for (const [k, v] of Object.entries(row)) {
    if (consumedSet.has(k)) continue;
    migrated[k] = v;
    leftovers.push(k);
  }
  if (leftovers.length > 0) {
    ctx.report.recordPreserved(table, leftovers);
    doc._migrated = migrated;
  }
  return doc;
}

// ---------------------------------------------------------------------------
// Option collapsing (exam option_1..5, daily option_a..d)
// ---------------------------------------------------------------------------

/** Parse a source `correct_options` value (e.g. "1,3" | [1,3] | 2) → number[]. */
function parseCorrect(raw: unknown): number[] {
  if (Array.isArray(raw)) return raw.map((n) => int(n)).filter((n) => n > 0);
  const s = str(raw).trim();
  if (s === "") return [];
  return s
    .split(",")
    .map((p) => int(p.trim(), 0))
    .filter((n) => n > 0);
}

/**
 * Collapse exam option_1..5 (+ correct_options as 1-based option numbers) into
 * the rebuild's `options: string[]` + `correctOptions: number[]` (0-based
 * indices into the compacted array).
 */
export function collapseExamOptions(row: SourceRow): {
  options: string[];
  correctOptions: number[];
} {
  const kept: { n: number; text: string }[] = [];
  for (let i = 1; i <= 5; i += 1) {
    const t = str(row[`option_${i}`]).trim();
    if (t) kept.push({ n: i, text: t });
  }
  const options = kept.map((k) => k.text);
  const correctOptions = parseCorrect(row.correct_options)
    .map((n) => kept.findIndex((k) => k.n === n))
    .filter((idx) => idx >= 0);
  return { options, correctOptions };
}

/**
 * Collapse daily option_a..d (+ correct_option letter or 1-based number) into
 * `options: string[]` + a single 0-based `correctOption` index.
 */
export function collapseDailyOptions(row: SourceRow): {
  options: string[];
  correctOption: number;
} {
  const letters = ["a", "b", "c", "d"];
  const kept: { letter: string; text: string }[] = [];
  for (const L of letters) {
    const t = str(row[`option_${L}`]).trim();
    if (t) kept.push({ letter: L, text: t });
  }
  const options = kept.map((k) => k.text);

  const raw = row.correct_option;
  let correctOption = 0;
  if (typeof raw === "number") {
    // A 1-based option number → index into the compacted array.
    const idx = kept.findIndex((k) => letters.indexOf(k.letter) === raw - 1);
    correctOption = idx >= 0 ? idx : 0;
  } else {
    const letter = str(raw).trim().toLowerCase();
    const idx = kept.findIndex((k) => k.letter === letter);
    correctOption = idx >= 0 ? idx : 0;
  }
  return { options, correctOption };
}

// ---------------------------------------------------------------------------
// Transforms — one per table (in dependency-first insertion order)
// ---------------------------------------------------------------------------

export function transformProgram(row: SourceRow, ctx: Ctx): Record<string, unknown> {
  return finish(
    {
      _id: ctx.id,
      name: str(row.name),
      slug: str(row.slug),
      description: str(row.description),
      order: int(row.order),
      isVisible: row.is_visible === undefined ? true : bool(row.is_visible),
    },
    row,
    ["id", "name", "slug", "description", "order", "is_visible"],
    "program",
    ctx,
  );
}

export function transformUser(row: SourceRow, ctx: Ctx): Record<string, unknown> {
  const isAdmin = bool(row.is_superuser) || bool(row.is_staff);
  const username = str(row.username);
  const email = str(row.email).toLowerCase();
  if (isAdmin) ctx.report.recordAdmin(username, email);
  const force = ctx.hints?.forcePwByUserId?.get(String(row.id)) ?? false;
  return finish(
    {
      _id: ctx.id,
      username,
      email,
      // Django hash kept AS-IS — the app verifies + transparently upgrades it.
      passwordHash: str(row.password),
      role: isAdmin ? "admin" : "student",
      isActive: row.is_active === undefined ? true : bool(row.is_active),
      forcePasswordChange: force,
      tokenVersion: 0,
      lastLoginAt: date(row.last_login),
    },
    row,
    [
      "id",
      "username",
      "email",
      "password",
      "is_superuser",
      "is_staff",
      "is_active",
      "last_login",
      // first_name/last_name intentionally preserved under _migrated.
    ],
    "user",
    ctx,
  );
}

export function transformSubject(row: SourceRow, ctx: Ctx): Record<string, unknown> {
  ctx.report.spotMoney("subject", "price", str(row.price), rupeesToPaise(row.price));
  return finish(
    {
      _id: ctx.id,
      program: remap(ctx.maps.program, row.program_id, ctx, "subject", "program"),
      name: str(row.name),
      slug: str(row.slug),
      image: str(row.image),
      description: str(row.description),
      price: rupeesToPaise(row.price),
      discountPrice: rupeesToPaise(row.discount_price),
      isPopular: bool(row.is_popular),
      isVisible: row.is_visible === undefined ? true : bool(row.is_visible),
    },
    row,
    [
      "id",
      "program_id",
      "name",
      "slug",
      "image",
      "description",
      "price",
      "discount_price",
      "is_popular",
      "is_visible",
    ],
    "subject",
    ctx,
  );
}

export function transformModule(row: SourceRow, ctx: Ctx): Record<string, unknown> {
  return finish(
    {
      _id: ctx.id,
      subject: remap(ctx.maps.subject, row.subject_id, ctx, "module", "subject"),
      name: str(row.name),
      order: int(row.order),
    },
    row,
    ["id", "subject_id", "name", "order"],
    "module",
    ctx,
  );
}

export function transformEssayTopic(row: SourceRow, ctx: Ctx): Record<string, unknown> {
  const keywords = Array.isArray(row.semantic_keywords)
    ? (row.semantic_keywords as unknown[]).map((k) => str(k))
    : [];
  // The rebuild's EssayTopic has NO author/creator field, so we can't MAP the
  // Django `created_by_id`. Instead of stashing the raw Postgres integer (which
  // would dangle post-migration), remap it through the user id-map and preserve
  // the resolvable ObjectId under `_migrated.created_by` (null→null,
  // unresolved→null+flagged, exactly like a real FK).
  const hasCreator =
    row.created_by_id !== null &&
    row.created_by_id !== undefined &&
    row.created_by_id !== "";
  const createdBy = remap(
    ctx.maps.user,
    row.created_by_id,
    ctx,
    "essaytopic",
    "createdBy",
  );
  const doc = finish(
    {
      _id: ctx.id,
      title: str(row.title),
      description: str(row.description),
      instructions: str(row.instructions),
      difficultyLevel: int(row.difficulty_level, 1) || 1,
      minWords: int(row.min_words),
      maxWords: int(row.max_words),
      timeLimitMinutes: int(row.time_limit_minutes),
      isActive: row.is_active === undefined ? true : bool(row.is_active),
      semanticKeywords: keywords,
    },
    row,
    [
      "id",
      "title",
      "description",
      "instructions",
      "difficulty_level",
      "min_words",
      "max_words",
      "time_limit_minutes",
      "is_active",
      "semantic_keywords",
      // Consumed here so the raw int is NOT stashed; the remapped ObjectId is
      // attached under _migrated.created_by below.
      "created_by_id",
    ],
    "essaytopic",
    ctx,
  );
  if (hasCreator) {
    const migrated = (doc._migrated as Record<string, unknown> | undefined) ?? {};
    migrated.created_by = createdBy;
    doc._migrated = migrated;
    ctx.report.recordPreserved("essaytopic", ["created_by"]);
  }
  return doc;
}

export function transformTopic(row: SourceRow, ctx: Ctx): Record<string, unknown> {
  return finish(
    {
      _id: ctx.id,
      module: remap(ctx.maps.module, row.module_id, ctx, "topic", "module"),
      name: str(row.name),
      topicType: translateEnum(
        ENUM_MAPS.topicType,
        row.topic_type,
        ctx,
        "topic",
        "topicType",
        "text",
      ),
      order: floatOr(row.order),
      content: str(row.content),
      videoId: str(row.video_id),
      duration: str(row.duration),
      essayTopic: remap(
        ctx.maps.essaytopic,
        row.essay_topic_id,
        ctx,
        "topic",
        "essayTopic",
      ),
      isVisible: row.is_visible === undefined ? true : bool(row.is_visible),
    },
    row,
    [
      "id",
      "module_id",
      "name",
      "topic_type",
      "order",
      "content",
      "video_id",
      "duration",
      "essay_topic_id",
      "is_visible",
    ],
    "topic",
    ctx,
  );
}

export function transformProfile(row: SourceRow, ctx: Ctx): Record<string, unknown> {
  return finish(
    {
      _id: ctx.id,
      user: remap(ctx.maps.user, row.user_id, ctx, "profile", "user"),
      fullName: str(row.full_name),
      collegeName: str(row.college_name),
      rollNumber: str(row.roll_number),
      phoneNumber: str(row.phone_number),
      state: str(row.state),
      bio: str(row.bio),
      avatarUrl: str(row.avatar_url),
    },
    row,
    [
      "id",
      "user_id",
      "full_name",
      "college_name",
      "roll_number",
      "phone_number",
      "state",
      "bio",
      "avatar_url",
      // force_password_change is consumed onto the User doc (see hints).
      "force_password_change",
    ],
    "profile",
    ctx,
  );
}

export function transformQuestion(row: SourceRow, ctx: Ctx): Record<string, unknown> {
  return finish(
    {
      _id: ctx.id,
      subject: remap(ctx.maps.subject, row.subject_id, ctx, "question", "subject"),
      topic: remap(ctx.maps.topic, row.topic_id, ctx, "question", "topic"),
      text: str(row.text),
      marks: int(row.marks, 1) || 1,
    },
    row,
    ["id", "subject_id", "topic_id", "text", "marks"],
    "question",
    ctx,
  );
}

export function transformChoice(row: SourceRow, ctx: Ctx): Record<string, unknown> {
  return finish(
    {
      _id: ctx.id,
      question: remap(ctx.maps.question, row.question_id, ctx, "choice", "question"),
      text: str(row.text),
      isCorrect: bool(row.is_correct),
    },
    row,
    ["id", "question_id", "text", "is_correct"],
    "choice",
    ctx,
  );
}

export function transformCoupon(row: SourceRow, ctx: Ctx): Record<string, unknown> {
  const discountType = translateEnum(
    ENUM_MAPS.couponDiscountType,
    row.discount_type,
    ctx,
    "coupon",
    "discountType",
    "fixed",
  );
  // Percentage coupons store a PERCENT (kept as-is); fixed store money → paise.
  const discountValue =
    discountType === "percentage"
      ? int(row.discount_value)
      : rupeesToPaise(row.discount_value);
  return finish(
    {
      _id: ctx.id,
      code: str(row.code).toUpperCase(),
      discountType,
      discountValue,
      active: row.active === undefined ? true : bool(row.active),
      validFrom: date(row.valid_from),
      validTo: date(row.valid_to),
      usageLimit: row.usage_limit === null || row.usage_limit === undefined ? null : int(row.usage_limit),
      perUserLimit: int(row.per_user_limit, 1) || 1,
      usedCount: int(row.used_count),
      minOrderPaise: rupeesToPaise(row.min_order),
      subject: remap(ctx.maps.subject, row.subject_id, ctx, "coupon", "subject"),
    },
    row,
    [
      "id",
      "code",
      "discount_type",
      "discount_value",
      "active",
      "valid_from",
      "valid_to",
      "usage_limit",
      "per_user_limit",
      "used_count",
      "min_order",
      "subject_id",
    ],
    "coupon",
    ctx,
  );
}

export function transformEnrollment(row: SourceRow, ctx: Ctx): Record<string, unknown> {
  const source = str(row.source).toLowerCase() === "order" ? "order" : "manual";
  return finish(
    {
      _id: ctx.id,
      user: remap(ctx.maps.user, row.user_id, ctx, "enrollment", "user"),
      subject: remap(ctx.maps.subject, row.subject_id, ctx, "enrollment", "subject"),
      source,
      order: remap(ctx.maps.order, row.order_id, ctx, "enrollment", "order"),
      createdAt: date(row.enrolled_at) ?? undefined,
    },
    row,
    ["id", "user_id", "subject_id", "source", "order_id", "enrolled_at"],
    "enrollment",
    ctx,
  );
}

export function transformOrder(row: SourceRow, ctx: Ctx): Record<string, unknown> {
  ctx.report.spotMoney("order", "amount", str(row.amount), rupeesToPaise(row.amount));
  return finish(
    {
      _id: ctx.id,
      orderId: str(row.order_id),
      transactionId: str(row.transaction_id) || null,
      user: remap(ctx.maps.user, row.user_id, ctx, "order", "user"),
      subject: remap(ctx.maps.subject, row.subject_id, ctx, "order", "subject"),
      amount: rupeesToPaise(row.amount),
      coupon: remap(ctx.maps.coupon, row.coupon_id, ctx, "order", "coupon"),
      couponCode: str(row.coupon_code) || null,
      discountAmount: rupeesToPaise(row.discount_amount),
      status: translateEnum(
        ENUM_MAPS.orderStatus,
        row.status,
        ctx,
        "order",
        "status",
        "pending",
      ),
    },
    row,
    [
      "id",
      "order_id",
      "transaction_id",
      "user_id",
      "subject_id",
      "amount",
      "coupon_id",
      "coupon_code",
      "discount_amount",
      "status",
    ],
    "order",
    ctx,
  );
}

export function transformQuizSubmission(row: SourceRow, ctx: Ctx): Record<string, unknown> {
  return finish(
    {
      _id: ctx.id,
      user: remap(ctx.maps.user, row.user_id, ctx, "quizsubmission", "user"),
      subject: remap(ctx.maps.subject, row.subject_id, ctx, "quizsubmission", "subject"),
      topic: remap(ctx.maps.topic, row.topic_id, ctx, "quizsubmission", "topic"),
      score: int(row.score),
      totalQuestions: int(row.total_questions),
      createdAt: date(row.submitted_at) ?? undefined,
    },
    row,
    ["id", "user_id", "subject_id", "topic_id", "score", "total_questions", "submitted_at"],
    "quizsubmission",
    ctx,
  );
}

export function transformTopicProgress(row: SourceRow, ctx: Ctx): Record<string, unknown> {
  return finish(
    {
      _id: ctx.id,
      user: remap(ctx.maps.user, row.user_id, ctx, "topicprogress", "user"),
      topic: remap(ctx.maps.topic, row.topic_id, ctx, "topicprogress", "topic"),
      isCompleted: bool(row.is_completed),
      completedAt: date(row.completed_at),
    },
    row,
    ["id", "user_id", "topic_id", "is_completed", "completed_at"],
    "topicprogress",
    ctx,
  );
}

export function transformJob(row: SourceRow, ctx: Ctx): Record<string, unknown> {
  return finish(
    {
      _id: ctx.id,
      title: str(row.title),
      // Real Neon columns are company_name / apply_link (fall back defensively).
      company: str(row.company_name ?? row.company),
      companyLogo: str(row.company_logo),
      location: str(row.location),
      employmentType: translateEnum(
        ENUM_MAPS.postingType,
        row.employment_type,
        ctx,
        "job",
        "employmentType",
        "full_time",
      ),
      compensation: str(row.compensation),
      description: str(row.description),
      requirements: str(row.requirements),
      applyUrl: str(row.apply_link ?? row.apply_url),
      deadline: date(row.deadline),
      isActive: row.is_active === undefined ? true : bool(row.is_active),
      postedAt: date(row.posted_at) ?? date(row.created_at) ?? new Date(0),
    },
    row,
    [
      "id",
      "title",
      "company_name",
      "company",
      "company_logo",
      "location",
      "employment_type",
      "compensation",
      "description",
      "requirements",
      "apply_link",
      "apply_url",
      "deadline",
      "is_active",
      "posted_at",
    ],
    "job",
    ctx,
  );
}

export function transformJobApplication(row: SourceRow, ctx: Ctx): Record<string, unknown> {
  return finish(
    {
      _id: ctx.id,
      job: remap(ctx.maps.job, row.job_id, ctx, "jobapplication", "job"),
      user: remap(ctx.maps.user, row.user_id, ctx, "jobapplication", "user"),
      fullName: str(row.full_name),
      email: str(row.email).toLowerCase(),
      phone: str(row.phone),
      resumeUrl: str(row.resume_url),
      coverLetter: str(row.cover_letter),
      status: translateEnum(
        ENUM_MAPS.jobApplicationStatus,
        row.status,
        ctx,
        "jobapplication",
        "status",
        "SUBMITTED",
      ),
      createdAt: date(row.applied_at) ?? undefined,
    },
    row,
    [
      "id",
      "job_id",
      "user_id",
      "full_name",
      "email",
      "phone",
      "resume_url",
      "cover_letter",
      "status",
      "applied_at",
    ],
    "jobapplication",
    ctx,
  );
}

export function transformExam(row: SourceRow, ctx: Ctx): Record<string, unknown> {
  return finish(
    {
      _id: ctx.id,
      topic: remap(ctx.maps.topic, row.topic_id, ctx, "exam", "topic"),
      title: str(row.title) || "Exam",
      totalMarks: int(row.total_marks),
      passPercentage: int(row.pass_percentage, 40) || 40,
    },
    row,
    ["id", "topic_id", "title", "total_marks", "pass_percentage"],
    "exam",
    ctx,
  );
}

export function transformSection(row: SourceRow, ctx: Ctx): Record<string, unknown> {
  return finish(
    {
      _id: ctx.id,
      exam: remap(ctx.maps.exam, row.exam_id, ctx, "section", "exam"),
      name: str(row.name),
      order: int(row.order),
      durationMinutes: int(row.duration_minutes),
      description: str(row.description),
    },
    row,
    ["id", "exam_id", "name", "order", "duration_minutes", "description"],
    "section",
    ctx,
  );
}

export function transformExamQuestion(row: SourceRow, ctx: Ctx): Record<string, unknown> {
  // Real Neon column is `q_type` (values already match ExamQuestionType exactly:
  // MCQ_SINGLE / MCQ_MULTI / CODE). Fall back to `question_type` defensively.
  const rawType = str(row.q_type ?? row.question_type).trim().toUpperCase();
  const { options, correctOptions } = collapseExamOptions(row);
  let type: string;
  if (rawType === "CODE") {
    type = "CODE";
  } else if (rawType === "MCQ_MULTI") {
    type = "MCQ_MULTI";
  } else if (rawType === "MCQ_SINGLE") {
    type = "MCQ_SINGLE";
  } else if (rawType === "MCQ") {
    // Generic MCQ → single vs multi by how many correct options.
    type = correctOptions.length > 1 ? "MCQ_MULTI" : "MCQ_SINGLE";
  } else {
    ctx.report.flagEnum("examquestion", "questionType", str(row.q_type ?? row.question_type), "MCQ_SINGLE");
    type = "MCQ_SINGLE";
  }
  const isCode = type === "CODE";
  // Django's ExamQuestion has no exam_id (exam is reached via the section), so
  // derive `exam` from the section's exam when the direct FK is absent.
  let exam = remap(ctx.maps.exam, row.exam_id, ctx, "examquestion", "exam");
  if (!exam) {
    const examPgId = ctx.hints?.examPgIdBySectionPgId?.get(String(row.section_id));
    if (examPgId !== undefined) {
      exam = remap(ctx.maps.exam, examPgId, ctx, "examquestion", "exam");
    }
  }
  return finish(
    {
      _id: ctx.id,
      section: remap(ctx.maps.section, row.section_id, ctx, "examquestion", "section"),
      exam,
      questionType: type,
      text: str(row.text),
      order: int(row.order),
      options: isCode ? undefined : options,
      correctOptions: isCode ? undefined : correctOptions,
      starterCode: str(row.starter_code),
      language: str(row.language).trim().toLowerCase() || "python",
      image: str(row.image),
      marks: int(row.marks, 5) || 5,
    },
    row,
    [
      "id",
      "section_id",
      "exam_id",
      "q_type",
      "question_type",
      "text",
      "order",
      "option_1",
      "option_2",
      "option_3",
      "option_4",
      "option_5",
      "correct_options",
      "starter_code",
      "language",
      "image",
      "marks",
    ],
    "examquestion",
    ctx,
  );
}

export function transformExamTestCase(row: SourceRow, ctx: Ctx): Record<string, unknown> {
  return finish(
    {
      _id: ctx.id,
      question: remap(ctx.maps.examquestion, row.question_id, ctx, "examtestcase", "question"),
      inputData: str(row.input_data),
      expectedOutput: str(row.expected_output),
      isHidden: bool(row.is_hidden),
      order: int(row.order),
    },
    row,
    ["id", "question_id", "input_data", "expected_output", "is_hidden", "order"],
    "examtestcase",
    ctx,
  );
}

export function transformPublicLink(row: SourceRow, ctx: Ctx): Record<string, unknown> {
  return finish(
    {
      _id: ctx.id,
      exam: remap(ctx.maps.exam, row.exam_id, ctx, "publiclink", "exam"),
      accessToken: str(row.access_token),
      isActive: row.is_active === undefined ? true : bool(row.is_active),
      startTime: date(row.start_time),
      endTime: date(row.end_time),
    },
    row,
    ["id", "exam_id", "access_token", "is_active", "start_time", "end_time"],
    "publiclink",
    ctx,
  );
}

export function transformCounter(row: SourceRow, ctx: Ctx): Record<string, unknown> {
  return finish(
    {
      _id: ctx.id,
      user: remap(ctx.maps.user, row.user_id, ctx, "counter", "user"),
      exam: remap(ctx.maps.exam, row.exam_id, ctx, "counter", "exam"),
      attemptCount: int(row.attempt_count),
      maxAttempts: int(row.max_attempts, 1) || 1,
    },
    row,
    ["id", "user_id", "exam_id", "attempt_count", "max_attempts"],
    "counter",
    ctx,
  );
}

export function transformResetLog(row: SourceRow, ctx: Ctx): Record<string, unknown> {
  return finish(
    {
      _id: ctx.id,
      user: remap(ctx.maps.user, row.user_id, ctx, "resetlog", "user"),
      exam: remap(ctx.maps.exam, row.exam_id, ctx, "resetlog", "exam"),
      resetBy: remap(ctx.maps.user, row.reset_by_id, ctx, "resetlog", "resetBy"),
      // Real Neon columns are note / previous_attempt_count (fall back defensively).
      previousCount: int(row.previous_attempt_count ?? row.previous_count),
      reason: str(row.note ?? row.reason),
      resetAt: date(row.reset_at) ?? new Date(0),
      // new_attempt_count has no rebuild home → intentionally preserved in _migrated.
    },
    row,
    [
      "id",
      "user_id",
      "exam_id",
      "reset_by_id",
      "note",
      "reason",
      "previous_attempt_count",
      "previous_count",
      "reset_at",
    ],
    "resetlog",
    ctx,
  );
}

export function transformStudentAttempt(row: SourceRow, ctx: Ctx): Record<string, unknown> {
  const completedAt = date(row.completed_at);
  // Derive status when the source lacks an explicit one.
  const rawStatus = str(row.status);
  const status = rawStatus
    ? translateEnum(
      ENUM_MAPS.examAttemptStatus,
      rawStatus,
      ctx,
      "studentattempt",
      "status",
      completedAt ? "graded" : "in_progress",
    )
    : completedAt
      ? "graded"
      : "in_progress";
  return finish(
    {
      _id: ctx.id,
      exam: remap(ctx.maps.exam, row.exam_id, ctx, "studentattempt", "exam"),
      user: remap(ctx.maps.user, row.user_id, ctx, "studentattempt", "user"),
      // attemptToken is rebuild machinery (required) — synthesize one.
      attemptToken: str(row.attempt_token) || randomUUID(),
      publicLink: remap(ctx.maps.publiclink, row.public_link_id, ctx, "studentattempt", "publicLink"),
      rollNumber: str(row.roll_number),
      collegeName: str(row.college_name),
      status,
      currentSection: remap(ctx.maps.section, row.current_section_id, ctx, "studentattempt", "currentSection"),
      sectionStartTime: date(row.section_start_time),
      responseData:
        row.response_data && typeof row.response_data === "object"
          ? row.response_data
          : {},
      warningsTriggered: int(row.warnings_triggered),
      isAutoSubmitted: bool(row.is_auto_submitted),
      isMalpractice: bool(row.is_malpractice) || int(row.warnings_triggered) > 2,
      startedAt: date(row.started_at) ?? date(row.created_at) ?? new Date(0),
      completedAt,
      score: int(row.score),
      passed: bool(row.passed),
    },
    row,
    [
      "id",
      "exam_id",
      "user_id",
      "attempt_token",
      "public_link_id",
      "roll_number",
      "college_name",
      "status",
      "current_section_id",
      "section_start_time",
      "response_data",
      "warnings_triggered",
      "is_auto_submitted",
      "is_malpractice",
      "started_at",
      "completed_at",
      "score",
      "passed",
    ],
    "studentattempt",
    ctx,
  );
}

export function transformDailyQuestion(row: SourceRow, ctx: Ctx): Record<string, unknown> {
  const type = translateEnum(
    ENUM_MAPS.dailyQuestionType,
    row.question_type,
    ctx,
    "dailyquestion",
    "questionType",
    "MCQ",
  );
  const isCode = type === "CODE";
  const { options, correctOption } = collapseDailyOptions(row);
  return finish(
    {
      _id: ctx.id,
      questionType: type,
      releaseDate: date(row.release_date) ?? new Date(0),
      title: str(row.title),
      description: str(row.description),
      options: isCode ? undefined : options,
      correctOption: isCode ? undefined : correctOption,
      starterCode: str(row.starter_code),
      language: str(row.language).trim().toLowerCase() || "python",
      marks: int(row.marks, 5) || 5,
    },
    row,
    [
      "id",
      "question_type",
      "release_date",
      "title",
      "description",
      "option_a",
      "option_b",
      "option_c",
      "option_d",
      "correct_option",
      "starter_code",
      "language",
      "marks",
    ],
    "dailyquestion",
    ctx,
  );
}

export function transformDailyTestCase(row: SourceRow, ctx: Ctx): Record<string, unknown> {
  return finish(
    {
      _id: ctx.id,
      question: remap(ctx.maps.dailyquestion, row.question_id, ctx, "dailytestcase", "question"),
      inputData: str(row.input_data),
      expectedOutput: str(row.expected_output),
      isHidden: bool(row.is_hidden),
    },
    row,
    ["id", "question_id", "input_data", "expected_output", "is_hidden"],
    "dailytestcase",
    ctx,
  );
}

export function transformDailySubmission(row: SourceRow, ctx: Ctx): Record<string, unknown> {
  return finish(
    {
      _id: ctx.id,
      user: remap(ctx.maps.user, row.user_id, ctx, "dailysubmission", "user"),
      question: remap(ctx.maps.dailyquestion, row.question_id, ctx, "dailysubmission", "question"),
      isCorrect: bool(row.is_correct),
      score: int(row.score),
      submittedCode: str(row.submitted_code),
      language: str(row.language),
      createdAt: date(row.submitted_at) ?? undefined,
    },
    row,
    [
      "id",
      "user_id",
      "question_id",
      "is_correct",
      "score",
      "submitted_code",
      "language",
      "submitted_at",
    ],
    "dailysubmission",
    ctx,
  );
}

export function transformUserStreak(row: SourceRow, ctx: Ctx): Record<string, unknown> {
  return finish(
    {
      _id: ctx.id,
      user: remap(ctx.maps.user, row.user_id, ctx, "userstreak", "user"),
      currentStreak: int(row.current_streak),
      maxStreak: int(row.max_streak),
      totalScore: int(row.total_score),
      lastSolvedDate: date(row.last_solved_date),
    },
    row,
    ["id", "user_id", "current_streak", "max_streak", "total_score", "last_solved_date"],
    "userstreak",
    ctx,
  );
}

export function transformEssayAttempt(row: SourceRow, ctx: Ctx): Record<string, unknown> {
  return finish(
    {
      _id: ctx.id,
      user: remap(ctx.maps.user, row.user_id, ctx, "essayattempt", "user"),
      essayTopic: remap(ctx.maps.essaytopic, row.essay_topic_id, ctx, "essayattempt", "essayTopic"),
      attemptNumber: int(row.attempt_number, 1) || 1,
      status: translateEnum(
        ENUM_MAPS.essayStatus,
        row.status,
        ctx,
        "essayattempt",
        "status",
        "DRAFT",
      ),
      content: str(row.content),
      wordCount: int(row.word_count),
      characterCount: int(row.character_count),
      paragraphCount: int(row.paragraph_count),
      subScores: {
        grammar: floatOr(row.grammar_score),
        spelling: floatOr(row.spelling_score),
        punctuation: floatOr(row.punctuation_score),
        readability: floatOr(row.readability_score),
        vocabulary: floatOr(row.vocabulary_score),
        structure: floatOr(row.structure_score),
        relevance: floatOr(row.relevance_score),
      },
      finalScore: floatOr(row.final_score),
      aiReport: row.ai_report ?? null,
      scoreSource: row.score_source
        ? translateEnum(
          ENUM_MAPS.essayScoreSource,
          row.score_source,
          ctx,
          "essayattempt",
          "scoreSource",
          "deterministic_fallback",
        )
        : null,
      feedback: str(row.feedback),
      gradingJobId: str(row.grading_job_id) || null,
      gradingStatus: translateEnum(
        ENUM_MAPS.gradingStatus,
        row.grading_status,
        ctx,
        "essayattempt",
        "gradingStatus",
        "queued",
      ),
      timeLimitSeconds: int(row.time_limit_seconds),
      isTimed: bool(row.is_timed),
      timerExpired: bool(row.timer_expired),
      startedAt: date(row.started_at),
      submittedAt: date(row.submitted_at),
      gradedAt: date(row.graded_at),
      ipAddress: str(row.ip_address),
      userAgent: str(row.user_agent),
    },
    row,
    [
      "id",
      "user_id",
      "essay_topic_id",
      "attempt_number",
      "status",
      "content",
      "word_count",
      "character_count",
      "paragraph_count",
      "grammar_score",
      "spelling_score",
      "punctuation_score",
      "readability_score",
      "vocabulary_score",
      "structure_score",
      "relevance_score",
      "final_score",
      "ai_report",
      "score_source",
      "feedback",
      "grading_job_id",
      "grading_status",
      "time_limit_seconds",
      "is_timed",
      "timer_expired",
      "started_at",
      "submitted_at",
      "graded_at",
      "ip_address",
      "user_agent",
    ],
    "essayattempt",
    ctx,
  );
}

export function transformEssayAnalytics(row: SourceRow, ctx: Ctx): Record<string, unknown> {
  return finish(
    {
      _id: ctx.id,
      attempt: remap(ctx.maps.essayattempt, row.attempt_id, ctx, "essayanalytics", "attempt"),
      typingEvents: int(row.typing_events),
      pasteEvents: int(row.paste_events),
      copyEvents: int(row.copy_events),
      deleteEvents: int(row.delete_events),
      focusLossCount: int(row.focus_loss_count),
      inactivitySeconds: int(row.inactivity_seconds),
      longestPauseSeconds: int(row.longest_pause_seconds),
      suspiciousActivity: bool(row.suspicious_activity),
      riskScore: floatOr(row.risk_score),
      // Step-11 additive signals have no source column → default 0.
      pastedChars: int(row.pasted_chars),
      composeSeconds: int(row.compose_seconds),
      finalWordCount: int(row.final_word_count),
      finalCharacterCount: int(row.final_character_count),
    },
    row,
    [
      "id",
      "attempt_id",
      "typing_events",
      "paste_events",
      "copy_events",
      "delete_events",
      "focus_loss_count",
      "inactivity_seconds",
      "longest_pause_seconds",
      "suspicious_activity",
      "risk_score",
      "pasted_chars",
      "compose_seconds",
      "final_word_count",
      "final_character_count",
    ],
    "essayanalytics",
    ctx,
  );
}

export function transformEssayDraft(row: SourceRow, ctx: Ctx): Record<string, unknown> {
  return finish(
    {
      _id: ctx.id,
      attempt: remap(ctx.maps.essayattempt, row.attempt_id, ctx, "essaydraft", "attempt"),
      content: str(row.content),
      wordCount: int(row.word_count),
      savedAt: date(row.saved_at) ?? new Date(0),
    },
    row,
    ["id", "attempt_id", "content", "word_count", "saved_at"],
    "essaydraft",
    ctx,
  );
}

/**
 * Generic PRESERVE transform for tables with no native rebuild model
 * (essayscore, essayattemptanalytics, essayfeedback). Everything is kept: known
 * FKs are remapped; every other column is stashed under `_migrated` so nothing
 * is lost. `fkSpec` maps a source FK column → the id-map + target field name.
 */
export function makePreserveTransform(
  table: string,
  fkSpec: { column: string; mapKey: string; field: string }[],
) {
  return (row: SourceRow, ctx: Ctx): Record<string, unknown> => {
    const doc: Record<string, unknown> = { _id: ctx.id };
    const consumed = ["id"];
    for (const { column, mapKey, field } of fkSpec) {
      doc[field] = remap(ctx.maps[mapKey], row[column], ctx, table, field);
      consumed.push(column);
    }
    return finish(doc, row, consumed, table, ctx);
  };
}

// ---------------------------------------------------------------------------
// Table registry — insertion order (dependency-first)
// ---------------------------------------------------------------------------

export interface TableSpec {
  /** Logical name (also the id-map key + report label). */
  logical: string;
  /** Source Postgres table (Django app_model). Adjust if your schema differs. */
  pgTable: string;
  /** Target Mongo collection (Mongoose pluralization). */
  collection: string;
  transform: (row: SourceRow, ctx: Ctx) => Record<string, unknown>;
}

export const TABLES: TableSpec[] = [
  { logical: "program", pgTable: "curriculum_program", collection: "programs", transform: transformProgram },
  { logical: "user", pgTable: "auth_user", collection: "users", transform: transformUser },
  { logical: "subject", pgTable: "curriculum_subject", collection: "subjects", transform: transformSubject },
  { logical: "module", pgTable: "curriculum_module", collection: "modules", transform: transformModule },
  { logical: "essaytopic", pgTable: "essays_essaytopic", collection: "essaytopics", transform: transformEssayTopic },
  { logical: "topic", pgTable: "curriculum_topic", collection: "topics", transform: transformTopic },
  { logical: "profile", pgTable: "core_profile", collection: "profiles", transform: transformProfile },
  { logical: "question", pgTable: "curriculum_question", collection: "questions", transform: transformQuestion },
  { logical: "choice", pgTable: "curriculum_choice", collection: "choices", transform: transformChoice },
  { logical: "coupon", pgTable: "curriculum_coupon", collection: "coupons", transform: transformCoupon },
  { logical: "enrollment", pgTable: "curriculum_enrollment", collection: "enrollments", transform: transformEnrollment },
  { logical: "order", pgTable: "curriculum_order", collection: "orders", transform: transformOrder },
  { logical: "quizsubmission", pgTable: "curriculum_quizsubmission", collection: "quizsubmissions", transform: transformQuizSubmission },
  { logical: "topicprogress", pgTable: "curriculum_topicprogress", collection: "topicprogresses", transform: transformTopicProgress },
  { logical: "job", pgTable: "curriculum_job", collection: "jobs", transform: transformJob },
  { logical: "jobapplication", pgTable: "curriculum_jobapplication", collection: "jobapplications", transform: transformJobApplication },
  { logical: "exam", pgTable: "assessments_exam", collection: "exams", transform: transformExam },
  { logical: "section", pgTable: "assessments_examsection", collection: "examsections", transform: transformSection },
  { logical: "examquestion", pgTable: "assessments_examquestion", collection: "examquestions", transform: transformExamQuestion },
  { logical: "examtestcase", pgTable: "assessments_examtestcase", collection: "examtestcases", transform: transformExamTestCase },
  { logical: "publiclink", pgTable: "assessments_publicexamlink", collection: "publicexamlinks", transform: transformPublicLink },
  { logical: "counter", pgTable: "assessments_examattemptcounter", collection: "examattemptcounters", transform: transformCounter },
  { logical: "resetlog", pgTable: "assessments_examattemptresetlog", collection: "examattemptresetlogs", transform: transformResetLog },
  { logical: "studentattempt", pgTable: "assessments_studentexamattempt", collection: "studentexamattempts", transform: transformStudentAttempt },
  { logical: "dailyquestion", pgTable: "challenges_dailyquestion", collection: "dailyquestions", transform: transformDailyQuestion },
  { logical: "dailytestcase", pgTable: "challenges_testcase", collection: "dailytestcases", transform: transformDailyTestCase },
  { logical: "dailysubmission", pgTable: "challenges_dailysubmission", collection: "dailysubmissions", transform: transformDailySubmission },
  { logical: "userstreak", pgTable: "challenges_userstreak", collection: "userstreaks", transform: transformUserStreak },
  { logical: "essayattempt", pgTable: "essays_essayattempt", collection: "essayattempts", transform: transformEssayAttempt },
  { logical: "essayanalytics", pgTable: "essays_essayanalytics", collection: "essayanalytics", transform: transformEssayAnalytics },
  { logical: "essaydraft", pgTable: "essays_essaydraft", collection: "essaydrafts", transform: transformEssayDraft },
  // Preserved essays tables — no native model; kept wholesale under _migrated.
  {
    logical: "essayscore",
    pgTable: "essays_essayscore",
    collection: "migrated_essayscore",
    transform: makePreserveTransform("essayscore", [
      { column: "attempt_id", mapKey: "essayattempt", field: "attempt" },
    ]),
  },
  {
    logical: "essayattemptanalytics",
    pgTable: "essays_essayattemptanalytics",
    collection: "migrated_essayattemptanalytics",
    transform: makePreserveTransform("essayattemptanalytics", [
      { column: "attempt_id", mapKey: "essayattempt", field: "attempt" },
      { column: "user_id", mapKey: "user", field: "user" },
    ]),
  },
  {
    logical: "essayfeedback",
    pgTable: "essays_essayfeedback",
    collection: "migrated_essayfeedback",
    transform: makePreserveTransform("essayfeedback", [
      { column: "attempt_id", mapKey: "essayattempt", field: "attempt" },
    ]),
  },
];

/** Source tables that are intentionally NOT migrated (Django/app machinery). */
export const SKIP_TABLES = [
  "django_migrations",
  "django_content_type",
  "django_session",
  "django_admin_log",
  "auth_permission",
  "auth_group",
  "auth_group_permissions",
  "auth_user_groups",
  "auth_user_user_permissions",
  "core_executionjob",
];
