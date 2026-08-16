/**
 * Curriculum ADMIN service — authoring CRUD + reorder for the STRUCTURAL tree
 * (Program → Subject → Module). Mirrors the exam-admin / careers-admin pattern:
 * thin, zod-validated writes behind requireAdmin, integer-paise money, AppError
 * envelope.
 *
 * Delete semantics (4a-i, structural tree): DELETE ONLY WHEN EMPTY / no
 * dependents; otherwise block with a 409 (DELETE_BLOCKED) whose
 * `details.blockers` names the counts. This never orphans a Topic/Exam or
 * silently removes student/commerce data.
 *   - Program: blocked while any Subject references it.
 *   - Subject: blocked while it has Modules, Enrollments, Orders, QuizSubmissions,
 *     or scoping Coupons (Modules present ⇒ any Topics/Exams/progress are also
 *     transitively protected).
 *   - Module: blocked while it has any Topic.
 *
 * Leaf tree (4a-ii, Topic + quiz Question/Choice): CASCADE pure CONTENT, BLOCK
 * on STUDENT DATA. So the structural-tree blocks above are the outer net, and
 * the Topic is where content actually cascades:
 *   - text/video: block on TopicProgress; else delete.
 *   - quiz: cascade its Questions+Choices; block on TopicProgress/QuizSubmission.
 *   - exam: cascade the linked Exam tree (sections/questions/test-cases/links/
 *     counters/reset-logs); block on TopicProgress/StudentExamAttempt.
 *   - essay: drop the (shared, never-deleted) EssayTopic ref; block on TopicProgress.
 * An exam-type topic auto-creates its 1:1 Exam shell on create so it is
 * immediately findable by the exam editor; topicType is immutable on update.
 *
 * Slug: optional on write; derived from the name when omitted. Collisions raise
 * a clean SLUG_TAKEN (409), never a 500. On rename the slug is kept STABLE
 * (only an explicit new slug changes it) so existing links don't break.
 */
import {
  CurriculumErrorCode,
  EssayErrorCode,
  TopicType,
  adminTopicUpsertSchema,
  type AdminExamTopic,
  type AdminExamTopicListResponse,
  type AdminModule,
  type AdminModuleListResponse,
  type AdminModuleUpsert,
  type AdminProgram,
  type AdminProgramListResponse,
  type AdminProgramUpsert,
  type AdminQuizQuestion,
  type AdminQuizQuestionListResponse,
  type AdminQuizQuestionUpsert,
  type AdminReorder,
  type AdminSubject,
  type AdminSubjectListResponse,
  type AdminSubjectUpsert,
  type AdminTopic,
  type AdminTopicListResponse,
  type AdminTopicUpsert,
  type RecomputeExpiryResponse,
  type TopicExcelUploadResponse,
} from "@codeapt/shared";
import { Types, type HydratedDocument, type Model } from "mongoose";

import { AppError } from "../errors/app-error.js";
import { notExpiredFilter } from "../lib/enrollment-access.js";
import { slugify } from "../lib/slug.js";
import { parseTopicWorkbook } from "../lib/topic-excel.js";
import { extractVideoId } from "../lib/youtube.js";
import {
  ExamAttemptCounterModel,
  ExamAttemptResetLogModel,
  ExamModel,
  ExamQuestionModel,
  ExamSectionModel,
  ExamTestCaseModel,
  PublicExamLinkModel,
  StudentExamAttemptModel,
} from "../models/assessment.model.js";
import { CouponModel, OrderModel } from "../models/commerce.model.js";
import {
  ChoiceModel,
  EnrollmentModel,
  ModuleModel,
  ProgramModel,
  QuestionModel,
  QuizSubmissionModel,
  SubjectModel,
  TopicModel,
  TopicProgressModel,
  type Module,
  type Program,
  type Subject,
  type Topic,
} from "../models/curriculum.model.js";
import { EssayTopicModel } from "../models/essay.model.js";

type ProgramDoc = HydratedDocument<Program>;
type SubjectDoc = HydratedDocument<Subject>;
type ModuleDoc = HydratedDocument<Module>;
type TopicDoc = HydratedDocument<Topic>;

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function objectId(id: string, code: CurriculumErrorCode, label: string): Types.ObjectId {
  if (!Types.ObjectId.isValid(id)) {
    throw new AppError(`${label} not found`, 404, code);
  }
  return new Types.ObjectId(id);
}

/** Group-count a child collection by a parent field → Map<parentId, count>. */
async function countBy(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- heterogeneous models; only aggregate() is used
  model: Model<any>,
  field: string,
  match?: Record<string, unknown>,
): Promise<Map<string, number>> {
  const rows = await model.aggregate<{ _id: Types.ObjectId | null; c: number }>([
    ...(match ? [{ $match: match }] : []),
    { $group: { _id: `$${field}`, c: { $sum: 1 } } },
  ]);
  return new Map(rows.filter((r) => r._id).map((r) => [r._id!.toString(), r.c]));
}

/**
 * Resolve the slug to persist. On create, derive from the name when absent. On
 * update, keep the current slug unless an explicit new one is given. Either way,
 * enforce uniqueness (excluding self) with a clean SLUG_TAKEN error.
 */
async function resolveSlug(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Program|Subject models; only findOne({slug}) is used
  model: Model<any>,
  opts: { provided?: string; name: string; currentSlug?: string; selfId?: Types.ObjectId },
): Promise<string> {
  let slug: string;
  if (opts.provided) {
    slug = opts.provided;
  } else if (opts.currentSlug) {
    slug = opts.currentSlug; // stable on rename
  } else {
    slug = slugify(opts.name);
  }
  if (!slug) {
    throw new AppError(
      "Could not derive a slug from the name — provide one explicitly",
      400,
      CurriculumErrorCode.SLUG_TAKEN,
    );
  }
  const clash = await model.findOne({ slug }).select("_id");
  if (clash && (!opts.selfId || clash._id.toString() !== opts.selfId.toString())) {
    throw new AppError(
      `The slug "${slug}" is already in use`,
      409,
      CurriculumErrorCode.SLUG_TAKEN,
      { slug },
    );
  }
  return slug;
}

function deleteBlocked(
  label: string,
  blockers: Record<string, number>,
): never {
  const nonZero = Object.entries(blockers).filter(([, n]) => n > 0);
  const summary = nonZero.map(([k, n]) => `${n} ${k}`).join(", ");
  throw new AppError(
    `Cannot delete this ${label} — remove its dependents first (${summary}).`,
    409,
    CurriculumErrorCode.DELETE_BLOCKED,
    { blockers: Object.fromEntries(nonZero) },
  );
}

// ---------------------------------------------------------------------------
// Program
// ---------------------------------------------------------------------------

function toAdminProgram(p: ProgramDoc, subjectCount: number): AdminProgram {
  return {
    id: p._id.toString(),
    name: p.name,
    slug: p.slug,
    description: p.description,
    order: p.order,
    isVisible: p.isVisible,
    subjectCount,
  };
}

async function loadProgram(id: string): Promise<ProgramDoc> {
  const _id = objectId(id, CurriculumErrorCode.PROGRAM_NOT_FOUND, "Program");
  const program = await ProgramModel.findById(_id);
  if (!program) {
    throw new AppError("Program not found", 404, CurriculumErrorCode.PROGRAM_NOT_FOUND);
  }
  return program;
}

export async function listProgramsAdmin(): Promise<AdminProgramListResponse> {
  const programs = await ProgramModel.find().sort({ order: 1, name: 1 });
  const counts = await countBy(SubjectModel, "program");
  return {
    items: programs.map((p) =>
      toAdminProgram(p, counts.get(p._id.toString()) ?? 0),
    ),
  };
}

export async function getProgramAdmin(id: string): Promise<AdminProgram> {
  const program = await loadProgram(id);
  const subjectCount = await SubjectModel.countDocuments({ program: program._id });
  return toAdminProgram(program, subjectCount);
}

export async function createProgram(
  input: AdminProgramUpsert,
): Promise<AdminProgram> {
  const slug = await resolveSlug(ProgramModel, {
    provided: input.slug,
    name: input.name,
  });
  const program = await ProgramModel.create({
    name: input.name,
    slug,
    description: input.description,
    order: input.order,
    isVisible: input.isVisible,
  });
  return toAdminProgram(program, 0);
}

export async function updateProgram(
  id: string,
  input: AdminProgramUpsert,
): Promise<AdminProgram> {
  const program = await loadProgram(id);
  const slug = await resolveSlug(ProgramModel, {
    provided: input.slug,
    name: input.name,
    currentSlug: program.slug,
    selfId: program._id,
  });
  program.set({
    name: input.name,
    slug,
    description: input.description,
    order: input.order,
    isVisible: input.isVisible,
  });
  await program.save();
  const subjectCount = await SubjectModel.countDocuments({ program: program._id });
  return toAdminProgram(program, subjectCount);
}

export async function deleteProgram(id: string): Promise<{ deleted: true }> {
  const program = await loadProgram(id);
  const subjects = await SubjectModel.countDocuments({ program: program._id });
  if (subjects > 0) deleteBlocked("program", { subjects });
  await ProgramModel.deleteOne({ _id: program._id });
  return { deleted: true };
}

export async function reorderPrograms(
  input: AdminReorder,
): Promise<AdminProgramListResponse> {
  await ProgramModel.bulkWrite(
    input.ids.map((id, index) => ({
      updateOne: { filter: { _id: id }, update: { $set: { order: index } } },
    })),
  );
  return listProgramsAdmin();
}

// ---------------------------------------------------------------------------
// Subject
// ---------------------------------------------------------------------------

function toAdminSubject(
  s: SubjectDoc,
  programName: string | null,
  moduleCount: number,
  enrollmentCount: number,
): AdminSubject {
  return {
    id: s._id.toString(),
    programId: s.program ? s.program.toString() : null,
    programName,
    name: s.name,
    slug: s.slug,
    image: s.image,
    description: s.description,
    price: s.price,
    discountPrice: s.discountPrice,
    validityDays: s.validityDays,
    isPopular: s.isPopular,
    isVisible: s.isVisible,
    moduleCount,
    enrollmentCount,
  };
}

async function loadSubject(id: string): Promise<SubjectDoc> {
  const _id = objectId(id, CurriculumErrorCode.SUBJECT_NOT_FOUND, "Subject");
  const subject = await SubjectModel.findById(_id);
  if (!subject) {
    throw new AppError("Course not found", 404, CurriculumErrorCode.SUBJECT_NOT_FOUND);
  }
  return subject;
}

/** Validate the optional programId (must exist when non-null) → ObjectId | null. */
async function resolveProgramRef(
  programId: string | null | undefined,
): Promise<Types.ObjectId | null> {
  if (programId == null || programId === "") return null;
  const _id = objectId(programId, CurriculumErrorCode.PROGRAM_NOT_FOUND, "Program");
  const exists = await ProgramModel.exists({ _id });
  if (!exists) {
    throw new AppError("Program not found", 404, CurriculumErrorCode.PROGRAM_NOT_FOUND);
  }
  return _id;
}

async function programNameFor(
  program: Types.ObjectId | null | undefined,
): Promise<string | null> {
  if (!program) return null;
  const doc = await ProgramModel.findById(program).select("name");
  return doc?.name ?? null;
}

export async function listSubjectsAdmin(
  programId?: string,
): Promise<AdminSubjectListResponse> {
  const filter: Record<string, unknown> = {};
  if (programId) filter.program = new Types.ObjectId(programId);
  const subjects = await SubjectModel.find(filter).sort({ createdAt: -1, _id: -1 });
  const [moduleCounts, enrollCounts, programs] = await Promise.all([
    countBy(ModuleModel, "subject"),
    // "Enrolled" = CURRENTLY active (expired enrollments are excluded, so the
    // count drops after an expiry recompute).
    countBy(EnrollmentModel, "subject", notExpiredFilter()),
    ProgramModel.find().select("name").lean<{ _id: Types.ObjectId; name: string }[]>(),
  ]);
  const programNames = new Map(programs.map((p) => [p._id.toString(), p.name]));
  return {
    items: subjects.map((s) =>
      toAdminSubject(
        s,
        s.program ? (programNames.get(s.program.toString()) ?? null) : null,
        moduleCounts.get(s._id.toString()) ?? 0,
        enrollCounts.get(s._id.toString()) ?? 0,
      ),
    ),
  };
}

export async function getSubjectAdmin(id: string): Promise<AdminSubject> {
  const subject = await loadSubject(id);
  const [moduleCount, enrollmentCount, programName] = await Promise.all([
    ModuleModel.countDocuments({ subject: subject._id }),
    // Currently active enrollments (expired excluded).
    EnrollmentModel.countDocuments({
      subject: subject._id,
      ...notExpiredFilter(),
    }),
    programNameFor(subject.program),
  ]);
  return toAdminSubject(subject, programName, moduleCount, enrollmentCount);
}

export async function createSubject(
  input: AdminSubjectUpsert,
): Promise<AdminSubject> {
  const program = await resolveProgramRef(input.programId);
  const slug = await resolveSlug(SubjectModel, {
    provided: input.slug,
    name: input.name,
  });
  const subject = await SubjectModel.create({
    name: input.name,
    slug,
    program: program ?? undefined,
    image: input.image,
    description: input.description,
    price: input.price,
    discountPrice: input.discountPrice,
    validityDays: input.validityDays,
    isPopular: input.isPopular,
    isVisible: input.isVisible,
  });
  return toAdminSubject(subject, await programNameFor(program), 0, 0);
}

export async function updateSubject(
  id: string,
  input: AdminSubjectUpsert,
): Promise<AdminSubject> {
  const subject = await loadSubject(id);
  const program = await resolveProgramRef(input.programId);
  const slug = await resolveSlug(SubjectModel, {
    provided: input.slug,
    name: input.name,
    currentSlug: subject.slug,
    selfId: subject._id,
  });
  subject.set({
    name: input.name,
    slug,
    program: program ?? null,
    image: input.image,
    description: input.description,
    price: input.price,
    discountPrice: input.discountPrice,
    validityDays: input.validityDays,
    isPopular: input.isPopular,
    isVisible: input.isVisible,
  });
  await subject.save();
  const [moduleCount, enrollmentCount] = await Promise.all([
    ModuleModel.countDocuments({ subject: subject._id }),
    EnrollmentModel.countDocuments({
      subject: subject._id,
      ...notExpiredFilter(),
    }),
  ]);
  return toAdminSubject(
    subject,
    await programNameFor(program),
    moduleCount,
    enrollmentCount,
  );
}

/**
 * Recompute every enrollment's `expiresAt` for this course from its OWN
 * enrollment date + the course's CURRENT validity (0 = lifetime → clears the
 * expiry). Run after changing a course's validity so existing learners are
 * brought in line — overwrites prior expiries (unlike the null-only backfill).
 * Returns how many enrollments were recomputed and how many are now expired.
 */
export async function recomputeSubjectEnrollmentExpiry(
  id: string,
): Promise<RecomputeExpiryResponse> {
  const subject = await loadSubject(id);
  const DAY_MS = 24 * 60 * 60 * 1000;
  if (subject.validityDays > 0) {
    // Pipeline update so each row's expiry derives from its own createdAt.
    await EnrollmentModel.updateMany({ subject: subject._id }, [
      {
        $set: {
          expiresAt: { $add: ["$createdAt", subject.validityDays * DAY_MS] },
        },
      },
    ]);
  } else {
    // Lifetime → no expiry.
    await EnrollmentModel.updateMany(
      { subject: subject._id },
      { $set: { expiresAt: null } },
    );
  }
  const [updated, expired] = await Promise.all([
    EnrollmentModel.countDocuments({ subject: subject._id }),
    subject.validityDays > 0
      ? EnrollmentModel.countDocuments({
          subject: subject._id,
          expiresAt: { $ne: null, $lte: new Date() },
        })
      : Promise.resolve(0),
  ]);
  return { updated, expired };
}

export async function deleteSubject(id: string): Promise<{ deleted: true }> {
  const subject = await loadSubject(id);
  const [modules, enrollments, orders, quizSubmissions, coupons] =
    await Promise.all([
      ModuleModel.countDocuments({ subject: subject._id }),
      EnrollmentModel.countDocuments({ subject: subject._id }),
      OrderModel.countDocuments({ subject: subject._id }),
      QuizSubmissionModel.countDocuments({ subject: subject._id }),
      CouponModel.countDocuments({ subject: subject._id }),
    ]);
  if (modules || enrollments || orders || quizSubmissions || coupons) {
    deleteBlocked("course", {
      modules,
      enrollments,
      orders,
      "quiz submissions": quizSubmissions,
      coupons,
    });
  }
  // Safe to remove: no content tree, no student/commerce refs. Also clear any
  // subject-scoped Questions with no topic (defensive; none exist when empty).
  await QuestionModel.deleteMany({ subject: subject._id });
  await SubjectModel.deleteOne({ _id: subject._id });
  return { deleted: true };
}

// ---------------------------------------------------------------------------
// Module
// ---------------------------------------------------------------------------

function toAdminModule(m: ModuleDoc, topicCount: number): AdminModule {
  return {
    id: m._id.toString(),
    subjectId: m.subject.toString(),
    name: m.name,
    order: m.order,
    topicCount,
  };
}

async function loadModule(id: string): Promise<ModuleDoc> {
  const _id = objectId(id, CurriculumErrorCode.MODULE_NOT_FOUND, "Module");
  const module = await ModuleModel.findById(_id);
  if (!module) {
    throw new AppError("Module not found", 404, CurriculumErrorCode.MODULE_NOT_FOUND);
  }
  return module;
}

export async function listModulesAdmin(
  subjectId: string,
): Promise<AdminModuleListResponse> {
  const subject = await loadSubject(subjectId);
  const modules = await ModuleModel.find({ subject: subject._id }).sort({
    order: 1,
    _id: 1,
  });
  const topicCounts = await countBy(TopicModel, "module");
  return {
    items: modules.map((m) =>
      toAdminModule(m, topicCounts.get(m._id.toString()) ?? 0),
    ),
  };
}

export async function getModuleAdmin(id: string): Promise<AdminModule> {
  const module = await loadModule(id);
  const topicCount = await TopicModel.countDocuments({ module: module._id });
  return toAdminModule(module, topicCount);
}

export async function createModule(
  subjectId: string,
  input: AdminModuleUpsert,
): Promise<AdminModule> {
  const subject = await loadSubject(subjectId);
  const module = await ModuleModel.create({
    subject: subject._id,
    name: input.name,
    order: input.order,
  });
  return toAdminModule(module, 0);
}

export async function updateModule(
  id: string,
  input: AdminModuleUpsert,
): Promise<AdminModule> {
  const module = await loadModule(id);
  module.set({ name: input.name, order: input.order });
  await module.save();
  const topicCount = await TopicModel.countDocuments({ module: module._id });
  return toAdminModule(module, topicCount);
}

export async function deleteModule(id: string): Promise<{ deleted: true }> {
  const module = await loadModule(id);
  const topics = await TopicModel.countDocuments({ module: module._id });
  if (topics > 0) deleteBlocked("module", { topics });
  await ModuleModel.deleteOne({ _id: module._id });
  return { deleted: true };
}

export async function reorderModules(
  subjectId: string,
  input: AdminReorder,
): Promise<AdminModuleListResponse> {
  const subject = await loadSubject(subjectId);
  // Scope updates to this subject's modules so a stray id can't reorder another
  // subject's tree.
  await ModuleModel.bulkWrite(
    input.ids.map((id, index) => ({
      updateOne: {
        filter: { _id: id, subject: subject._id },
        update: { $set: { order: index } },
      },
    })),
  );
  return listModulesAdmin(subjectId);
}

// ---------------------------------------------------------------------------
// Topic (leaf; type-adaptive)
// ---------------------------------------------------------------------------

function toAdminTopic(
  t: TopicDoc,
  opts: {
    examId: string | null;
    essayTopicTitle: string | null;
    questionCount: number;
  },
): AdminTopic {
  return {
    id: t._id.toString(),
    moduleId: t.module.toString(),
    name: t.name,
    topicType: t.topicType as TopicType,
    order: t.order,
    isVisible: t.isVisible,
    content: t.content,
    videoId: t.videoId,
    duration: t.duration,
    essayTopicId: t.essayTopic ? t.essayTopic.toString() : null,
    essayTopicTitle: opts.essayTopicTitle,
    examId: opts.examId,
    questionCount: opts.questionCount,
  };
}

async function loadTopic(id: string): Promise<TopicDoc> {
  const _id = objectId(id, CurriculumErrorCode.TOPIC_NOT_FOUND, "Topic");
  const topic = await TopicModel.findById(_id);
  if (!topic) {
    throw new AppError("Topic not found", 404, CurriculumErrorCode.TOPIC_NOT_FOUND);
  }
  return topic;
}

/** Next float order for a new topic: append after the current last in a module. */
async function nextTopicOrder(moduleId: Types.ObjectId): Promise<number> {
  const last = await TopicModel.findOne({ module: moduleId })
    .sort({ order: -1 })
    .select("order");
  return last ? last.order + 1 : 0;
}

async function essayTitleFor(id: Types.ObjectId): Promise<string | null> {
  const doc = await EssayTopicModel.findById(id).select("title");
  return doc?.title ?? null;
}

/** Validate the optional essayTopicId (must exist when non-null) → ObjectId | null. */
async function resolveEssayTopicRef(
  essayTopicId: string | null | undefined,
): Promise<Types.ObjectId | null> {
  if (essayTopicId == null || essayTopicId === "") return null;
  if (!Types.ObjectId.isValid(essayTopicId)) {
    throw new AppError("Essay prompt not found", 404, EssayErrorCode.ESSAY_NOT_FOUND);
  }
  const _id = new Types.ObjectId(essayTopicId);
  const exists = await EssayTopicModel.exists({ _id });
  if (!exists) {
    throw new AppError("Essay prompt not found", 404, EssayErrorCode.ESSAY_NOT_FOUND);
  }
  return _id;
}

/** Resolve the per-type extras (examId / essay title / question count) for one topic. */
async function buildOneAdminTopic(topic: TopicDoc): Promise<AdminTopic> {
  let examId: string | null = null;
  let questionCount = 0;
  let essayTopicTitle: string | null = null;
  if (topic.topicType === TopicType.EXAM) {
    const exam = await ExamModel.findOne({ topic: topic._id }).select("_id");
    examId = exam ? exam._id.toString() : null;
  } else if (topic.topicType === TopicType.QUIZ) {
    questionCount = await QuestionModel.countDocuments({ topic: topic._id });
  } else if (topic.topicType === TopicType.ESSAY && topic.essayTopic) {
    essayTopicTitle = await essayTitleFor(topic.essayTopic);
  }
  return toAdminTopic(topic, { examId, essayTopicTitle, questionCount });
}

/** Batch the per-type extras for a module's topics (avoids N+1 in the list view). */
async function buildAdminTopics(topics: TopicDoc[]): Promise<AdminTopic[]> {
  const examTopicIds = topics
    .filter((t) => t.topicType === TopicType.EXAM)
    .map((t) => t._id);
  const essayIds = topics
    .map((t) => t.essayTopic)
    .filter((x): x is Types.ObjectId => !!x);
  const [exams, questionCounts, essayTopics] = await Promise.all([
    examTopicIds.length
      ? ExamModel.find({ topic: { $in: examTopicIds } })
          .select("topic")
          .lean<{ _id: Types.ObjectId; topic: Types.ObjectId }[]>()
      : Promise.resolve([]),
    countBy(QuestionModel, "topic"),
    essayIds.length
      ? EssayTopicModel.find({ _id: { $in: essayIds } })
          .select("title")
          .lean<{ _id: Types.ObjectId; title: string }[]>()
      : Promise.resolve([]),
  ]);
  const examByTopic = new Map(
    exams.map((e) => [e.topic.toString(), e._id.toString()]),
  );
  const essayTitleById = new Map(
    essayTopics.map((e) => [e._id.toString(), e.title]),
  );
  return topics.map((t) =>
    toAdminTopic(t, {
      examId:
        t.topicType === TopicType.EXAM
          ? (examByTopic.get(t._id.toString()) ?? null)
          : null,
      essayTopicTitle: t.essayTopic
        ? (essayTitleById.get(t.essayTopic.toString()) ?? null)
        : null,
      questionCount:
        t.topicType === TopicType.QUIZ
          ? (questionCounts.get(t._id.toString()) ?? 0)
          : 0,
    }),
  );
}

export async function listTopicsAdmin(
  moduleId: string,
): Promise<AdminTopicListResponse> {
  const module = await loadModule(moduleId);
  const topics = await TopicModel.find({ module: module._id }).sort({
    order: 1,
    _id: 1,
  });
  return { items: await buildAdminTopics(topics) };
}

export async function getTopicAdmin(id: string): Promise<AdminTopic> {
  return buildOneAdminTopic(await loadTopic(id));
}

export async function createTopic(
  moduleId: string,
  input: AdminTopicUpsert,
): Promise<AdminTopic> {
  const module = await loadModule(moduleId);
  const order = input.order ?? (await nextTopicOrder(module._id));
  const doc: Record<string, unknown> = {
    module: module._id,
    name: input.name,
    topicType: input.topicType,
    order,
    isVisible: input.isVisible,
  };
  if (input.topicType === TopicType.TEXT) {
    doc.content = input.content;
  } else if (input.topicType === TopicType.VIDEO) {
    doc.videoId = input.videoId;
    doc.duration = input.duration;
  } else if (input.topicType === TopicType.ESSAY) {
    const essayId = await resolveEssayTopicRef(input.essayTopicId);
    if (essayId) doc.essayTopic = essayId;
  }
  const topic = await TopicModel.create(doc);

  if (input.topicType === TopicType.EXAM) {
    // Auto-create the 1:1 Exam shell so an exam-type topic is immediately a
    // usable, findable exam (matches the original: an exam topic IS an exam).
    await ExamModel.create({
      topic: topic._id,
      title: topic.name,
      passPercentage: 40,
    });
  }
  return buildOneAdminTopic(topic);
}

export async function updateTopic(
  id: string,
  input: AdminTopicUpsert,
): Promise<AdminTopic> {
  const topic = await loadTopic(id);
  if (topic.topicType !== input.topicType) {
    throw new AppError(
      `Cannot change a topic's type (from "${topic.topicType}" to "${input.topicType}") — delete and recreate instead.`,
      400,
      CurriculumErrorCode.TOPIC_TYPE_IMMUTABLE,
    );
  }
  topic.set({ name: input.name, isVisible: input.isVisible });
  if (input.order !== undefined) topic.set({ order: input.order });
  if (input.topicType === TopicType.TEXT) {
    topic.set({ content: input.content });
  } else if (input.topicType === TopicType.VIDEO) {
    topic.set({ videoId: input.videoId, duration: input.duration });
  } else if (input.topicType === TopicType.ESSAY) {
    // SET_NULL semantics: drop the ref when cleared, relink when provided.
    topic.set("essayTopic", await resolveEssayTopicRef(input.essayTopicId));
  }
  await topic.save();
  return buildOneAdminTopic(topic);
}

export async function deleteTopic(id: string): Promise<{ deleted: true }> {
  const topic = await loadTopic(id);
  // Completion records are student data at EVERY topic type.
  const progress = await TopicProgressModel.countDocuments({ topic: topic._id });

  if (
    topic.topicType === TopicType.TEXT ||
    topic.topicType === TopicType.VIDEO
  ) {
    if (progress > 0) deleteBlocked("topic", { "progress records": progress });
  } else if (topic.topicType === TopicType.QUIZ) {
    const submissions = await QuizSubmissionModel.countDocuments({
      topic: topic._id,
    });
    if (progress || submissions) {
      deleteBlocked("quiz topic", {
        "progress records": progress,
        "quiz submissions": submissions,
      });
    }
    // Cascade pure content: this topic's questions and their choices.
    const questions = await QuestionModel.find({ topic: topic._id }).select("_id");
    const qIds = questions.map((q) => q._id);
    if (qIds.length) await ChoiceModel.deleteMany({ question: { $in: qIds } });
    await QuestionModel.deleteMany({ topic: topic._id });
  } else if (topic.topicType === TopicType.EXAM) {
    const exam = await ExamModel.findOne({ topic: topic._id });
    if (exam) {
      const attempts = await StudentExamAttemptModel.countDocuments({
        exam: exam._id,
      });
      if (progress || attempts) {
        deleteBlocked("exam topic", {
          "progress records": progress,
          "exam attempts": attempts,
        });
      }
      // Cascade the exam tree (on_delete=CASCADE), bottom-up.
      const examQuestions = await ExamQuestionModel.find({
        exam: exam._id,
      }).select("_id");
      const eqIds = examQuestions.map((q) => q._id);
      if (eqIds.length) {
        await ExamTestCaseModel.deleteMany({ question: { $in: eqIds } });
      }
      await ExamQuestionModel.deleteMany({ exam: exam._id });
      await ExamSectionModel.deleteMany({ exam: exam._id });
      await PublicExamLinkModel.deleteMany({ exam: exam._id });
      await ExamAttemptCounterModel.deleteMany({ exam: exam._id });
      await ExamAttemptResetLogModel.deleteMany({ exam: exam._id });
      await ExamModel.deleteOne({ _id: exam._id });
    } else if (progress > 0) {
      deleteBlocked("exam topic", { "progress records": progress });
    }
  } else {
    // essay: never delete the shared EssayTopic — just drop this topic's ref.
    if (progress > 0) {
      deleteBlocked("essay topic", { "progress records": progress });
    }
  }

  await TopicModel.deleteOne({ _id: topic._id });
  return { deleted: true };
}

export async function reorderTopics(
  moduleId: string,
  input: AdminReorder,
): Promise<AdminTopicListResponse> {
  const module = await loadModule(moduleId);
  // Reorder assigns integer indices (order stays a float-compatible Number, so
  // manual insert-between edits still work afterwards). Scoped to this module.
  await TopicModel.bulkWrite(
    input.ids.map((id, index) => ({
      updateOne: {
        filter: { _id: id, module: module._id },
        update: { $set: { order: index } },
      },
    })),
  );
  return listTopicsAdmin(moduleId);
}

// ---------------------------------------------------------------------------
// Quiz Question / Choice (scoped to a quiz-type Topic)
// ---------------------------------------------------------------------------

type QuestionDoc = HydratedDocument<{
  subject: Types.ObjectId;
  topic?: Types.ObjectId | null;
  text: string;
  marks: number;
}>;

async function requireQuizTopic(topicId: string): Promise<TopicDoc> {
  const topic = await loadTopic(topicId);
  if (topic.topicType !== TopicType.QUIZ) {
    throw new AppError(
      "This topic is not a quiz topic",
      400,
      CurriculumErrorCode.NOT_A_QUIZ,
    );
  }
  return topic;
}

async function subjectIdForTopic(topic: TopicDoc): Promise<Types.ObjectId> {
  const module = await ModuleModel.findById(topic.module).select("subject");
  if (!module) {
    throw new AppError("Module not found", 404, CurriculumErrorCode.MODULE_NOT_FOUND);
  }
  return module.subject;
}

async function loadQuestion(id: string): Promise<QuestionDoc> {
  const _id = objectId(id, CurriculumErrorCode.QUESTION_NOT_FOUND, "Question");
  const question = await QuestionModel.findById(_id);
  if (!question) {
    throw new AppError("Question not found", 404, CurriculumErrorCode.QUESTION_NOT_FOUND);
  }
  return question;
}

async function questionWithChoices(q: QuestionDoc): Promise<AdminQuizQuestion> {
  const choices = await ChoiceModel.find({ question: q._id }).sort({ _id: 1 });
  return {
    id: q._id.toString(),
    topicId: q.topic ? q.topic.toString() : "",
    text: q.text,
    marks: q.marks,
    choices: choices.map((c) => ({
      id: c._id.toString(),
      text: c.text,
      isCorrect: c.isCorrect,
    })),
  };
}

export async function listQuizQuestions(
  topicId: string,
): Promise<AdminQuizQuestionListResponse> {
  const topic = await requireQuizTopic(topicId);
  const questions = await QuestionModel.find({ topic: topic._id }).sort({
    _id: 1,
  });
  const choices = await ChoiceModel.find({
    question: { $in: questions.map((q) => q._id) },
  }).sort({ _id: 1 });
  const byQuestion = new Map<string, typeof choices>();
  for (const c of choices) {
    const key = c.question.toString();
    const list = byQuestion.get(key) ?? [];
    list.push(c);
    byQuestion.set(key, list);
  }
  return {
    items: questions.map((q) => ({
      id: q._id.toString(),
      topicId: q.topic ? q.topic.toString() : "",
      text: q.text,
      marks: q.marks,
      choices: (byQuestion.get(q._id.toString()) ?? []).map((c) => ({
        id: c._id.toString(),
        text: c.text,
        isCorrect: c.isCorrect,
      })),
    })),
  };
}

export async function createQuizQuestion(
  topicId: string,
  input: AdminQuizQuestionUpsert,
): Promise<AdminQuizQuestion> {
  const topic = await requireQuizTopic(topicId);
  const subject = await subjectIdForTopic(topic);
  const question = await QuestionModel.create({
    subject,
    topic: topic._id,
    text: input.text,
    marks: input.marks,
  });
  await ChoiceModel.insertMany(
    input.choices.map((c) => ({
      question: question._id,
      text: c.text,
      isCorrect: c.isCorrect,
    })),
  );
  return questionWithChoices(question);
}

export async function updateQuizQuestion(
  questionId: string,
  input: AdminQuizQuestionUpsert,
): Promise<AdminQuizQuestion> {
  const question = await loadQuestion(questionId);
  question.set({ text: input.text, marks: input.marks });
  await question.save();
  // Replace-all: simplest correct semantics for a nested choice edit.
  await ChoiceModel.deleteMany({ question: question._id });
  await ChoiceModel.insertMany(
    input.choices.map((c) => ({
      question: question._id,
      text: c.text,
      isCorrect: c.isCorrect,
    })),
  );
  return questionWithChoices(question);
}

export async function deleteQuizQuestion(
  questionId: string,
): Promise<{ deleted: true }> {
  const question = await loadQuestion(questionId);
  await ChoiceModel.deleteMany({ question: question._id });
  await QuestionModel.deleteOne({ _id: question._id });
  return { deleted: true };
}

// ---------------------------------------------------------------------------
// Exam-topic picker — what the 4b exam editor needs to attach/find exams.
// (The exam-list gives topicId + title but no subject/module labels; this does.)
// ---------------------------------------------------------------------------

export async function listExamTopics(): Promise<AdminExamTopicListResponse> {
  const topics = await TopicModel.find({ topicType: TopicType.EXAM })
    .select("name module")
    .sort({ _id: 1 });
  if (topics.length === 0) return { items: [] };

  const modules = await ModuleModel.find({
    _id: { $in: topics.map((t) => t.module) },
  })
    .select("name subject")
    .lean<{ _id: Types.ObjectId; name: string; subject: Types.ObjectId }[]>();
  const moduleById = new Map(modules.map((m) => [m._id.toString(), m]));

  const subjects = await SubjectModel.find({
    _id: { $in: modules.map((m) => m.subject) },
  })
    .select("name")
    .lean<{ _id: Types.ObjectId; name: string }[]>();
  const subjectNameById = new Map(subjects.map((s) => [s._id.toString(), s.name]));

  const exams = await ExamModel.find({ topic: { $in: topics.map((t) => t._id) } })
    .select("topic")
    .lean<{ _id: Types.ObjectId; topic: Types.ObjectId }[]>();
  const examByTopic = new Map(
    exams.map((e) => [e.topic.toString(), e._id.toString()]),
  );

  const items: AdminExamTopic[] = [];
  for (const t of topics) {
    const examId = examByTopic.get(t._id.toString());
    if (!examId) continue; // defensive: an exam topic with no shell (shouldn't happen)
    const module = moduleById.get(t.module.toString());
    items.push({
      topicId: t._id.toString(),
      examId,
      name: t.name,
      moduleId: t.module.toString(),
      moduleName: module?.name ?? "",
      subjectId: module ? module.subject.toString() : "",
      subjectName: module
        ? (subjectNameById.get(module.subject.toString()) ?? "")
        : "",
    });
  }
  return { items };
}

// ---------------------------------------------------------------------------
// Bulk topic import (Excel) — text/video only, per subject.
//
// Mirrors the original Django importer's SCOPE (get-or-create a Module by name,
// then create text/video topics; never quiz/exam/essay, never questions). The
// one improvement over the original's all-or-nothing blind create: PARTIAL
// SUCCESS with a per-row error report. Every topic is written through the same
// createTopic service used interactively (validated via adminTopicUpsertSchema),
// so order-append, defaults, and side-effects stay identical.
// ---------------------------------------------------------------------------

export async function bulkUploadTopics(
  subjectId: string,
  fileBase64: string,
): Promise<TopicExcelUploadResponse> {
  const subject = await loadSubject(subjectId);
  const buffer = Buffer.from(fileBase64, "base64");
  const { rows, errors: parseErrors } = await parseTopicWorkbook(buffer);
  const errors: { row: number; message: string }[] = [...parseErrors];

  // Preload existing modules for case-insensitive get-or-create by name.
  const existing = await ModuleModel.find({ subject: subject._id })
    .select("name")
    .lean<{ _id: Types.ObjectId; name: string }[]>();
  const moduleByName = new Map(
    existing.map((m) => [m.name.trim().toLowerCase(), m._id.toString()]),
  );
  let moduleOrder = existing.length;

  let createdModules = 0;
  let createdTopics = 0;

  for (const row of rows) {
    try {
      const name = row.name.trim();
      if (!name) {
        errors.push({ row: row.rowNumber, message: "Missing topic name" });
        continue;
      }

      const moduleName = row.module.trim();
      if (!moduleName) {
        errors.push({
          row: row.rowNumber,
          message: "Missing module — a topic must belong to a module",
        });
        continue;
      }

      // Resolve type (text/video only). quiz/exam/essay are explicit errors.
      const rawType = row.type.trim().toLowerCase();
      const videoId = extractVideoId(row.video);
      let topicType: typeof TopicType.TEXT | typeof TopicType.VIDEO;
      if (
        rawType === TopicType.QUIZ ||
        rawType === TopicType.EXAM ||
        rawType === TopicType.ESSAY
      ) {
        errors.push({
          row: row.rowNumber,
          message: `${rawType} topics must be authored individually, not bulk-uploaded`,
        });
        continue;
      } else if (rawType === TopicType.TEXT) {
        topicType = TopicType.TEXT;
      } else if (rawType === TopicType.VIDEO) {
        topicType = TopicType.VIDEO;
      } else if (rawType === "") {
        // Auto-detect: a resolvable video → video, else text.
        topicType = videoId ? TopicType.VIDEO : TopicType.TEXT;
      } else {
        errors.push({
          row: row.rowNumber,
          message: `Invalid type "${row.type.trim()}" (use text or video)`,
        });
        continue;
      }

      // Get-or-create the module by name under this subject.
      const key = moduleName.toLowerCase();
      let moduleId = moduleByName.get(key);
      if (!moduleId) {
        const created = await createModule(subject._id.toString(), {
          name: moduleName,
          order: moduleOrder,
        });
        moduleOrder += 1;
        moduleId = created.id;
        moduleByName.set(key, moduleId);
        createdModules += 1;
      }

      // Honour an explicit order; otherwise omit so createTopic appends (max+1).
      const orderNum = Number(row.order);
      const hasOrder = row.order.trim() !== "" && Number.isFinite(orderNum);

      // Validate through the SAME shared schema the interactive form uses.
      const rawPayload =
        topicType === TopicType.VIDEO
          ? {
              topicType: TopicType.VIDEO,
              name,
              videoId,
              duration: row.duration,
              ...(hasOrder ? { order: orderNum } : {}),
            }
          : {
              topicType: TopicType.TEXT,
              name,
              content: row.content,
              ...(hasOrder ? { order: orderNum } : {}),
            };
      const parsed = adminTopicUpsertSchema.safeParse(rawPayload);
      if (!parsed.success) {
        errors.push({
          row: row.rowNumber,
          message: parsed.error.issues.map((iss) => iss.message).join("; "),
        });
        continue;
      }

      await createTopic(moduleId, parsed.data);
      createdTopics += 1;
    } catch (err) {
      // One bad row never aborts the import.
      errors.push({
        row: row.rowNumber,
        message: err instanceof AppError ? err.message : "Failed to import row",
      });
    }
  }

  return { createdModules, createdTopics, errors };
}
