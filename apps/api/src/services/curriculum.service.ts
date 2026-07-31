/**
 * Curriculum / LMS service — catalog browse, subject detail, enrollment,
 * progress, topic content, and server-authoritative quiz grading.
 *
 * Money stays in integer paise here; the view layer formats to ₹. Correct
 * quiz answers never leave this layer except inside a graded result.
 */
import {
  CurriculumErrorCode,
  EnrollResult,
  EnrollmentSource,
  TopicType,
  effectivePricePaise,
  isFree,
  type CatalogItem,
  type CatalogQuery,
  type CatalogResponse,
  type EnrollResponse,
  type MyEnrollmentsResponse,
  type ProgramSummary,
  type ProgressInfo,
  type Quiz,
  type QuizResult,
  type QuizSubmitRequest,
  type SubjectDetail,
  type TopicCompleteResponse,
  type TopicContent,
} from "@codeapt/shared";
import { Types, type HydratedDocument, type PipelineStage } from "mongoose";

import { AppError } from "../errors/app-error.js";
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
  type Subject,
} from "../models/curriculum.model.js";

type SubjectDoc = HydratedDocument<Subject>;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface ProgramLike {
  _id: Types.ObjectId;
  name: string;
  slug: string;
}

function toProgramSummary(
  program: ProgramLike | null | undefined,
): ProgramSummary | null {
  if (!program) return null;
  return {
    id: program._id.toString(),
    name: program.name,
    slug: program.slug,
  };
}

async function getVisibleSubjectBySlug(slug: string): Promise<SubjectDoc> {
  const subject = await SubjectModel.findOne({ slug, isVisible: true });
  if (!subject) {
    throw new AppError(
      "Course not found",
      404,
      CurriculumErrorCode.SUBJECT_NOT_FOUND,
    );
  }
  return subject;
}

/** Ids of the visible topics under a subject (via its modules). */
async function getVisibleTopicIds(
  subjectId: Types.ObjectId,
): Promise<Types.ObjectId[]> {
  const modules = await ModuleModel.find({ subject: subjectId })
    .select("_id")
    .lean();
  const moduleIds = modules.map((m) => m._id);
  if (moduleIds.length === 0) return [];
  const topics = await TopicModel.find({
    module: { $in: moduleIds },
    isVisible: true,
  })
    .select("_id")
    .lean();
  return topics.map((t) => t._id);
}

async function computeProgress(
  userId: string,
  topicIds: Types.ObjectId[],
): Promise<ProgressInfo> {
  const totalTopics = topicIds.length;
  if (totalTopics === 0) {
    return { completedTopics: 0, totalTopics: 0, percentage: 0 };
  }
  const completedTopics = await TopicProgressModel.countDocuments({
    user: userId,
    topic: { $in: topicIds },
    isCompleted: true,
  });
  return {
    completedTopics,
    totalTopics,
    percentage: Math.round((completedTopics / totalTopics) * 100),
  };
}

async function findEnrollment(userId: string, subjectId: Types.ObjectId) {
  return EnrollmentModel.findOne({ user: userId, subject: subjectId });
}

async function ensureEnrolled(
  userId: string,
  subjectId: Types.ObjectId,
): Promise<void> {
  const enrollment = await findEnrollment(userId, subjectId);
  if (!enrollment) {
    throw new AppError(
      "You must enrol in this course first",
      403,
      CurriculumErrorCode.NOT_ENROLLED,
    );
  }
}

/** Load a topic and confirm it belongs to the given subject. */
async function getTopicInSubject(subjectId: Types.ObjectId, topicId: string) {
  if (!Types.ObjectId.isValid(topicId)) {
    throw new AppError(
      "Topic not found",
      404,
      CurriculumErrorCode.TOPIC_NOT_FOUND,
    );
  }
  const topic = await TopicModel.findById(topicId);
  if (!topic) {
    throw new AppError(
      "Topic not found",
      404,
      CurriculumErrorCode.TOPIC_NOT_FOUND,
    );
  }
  const module = await ModuleModel.findById(topic.module).select("subject");
  if (!module || module.subject.toString() !== subjectId.toString()) {
    throw new AppError(
      "Topic not found",
      404,
      CurriculumErrorCode.TOPIC_NOT_FOUND,
    );
  }
  return topic;
}

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

interface CatalogAggRow {
  _id: Types.ObjectId;
  slug: string;
  name: string;
  description: string;
  image: string;
  price: number;
  discountPrice: number;
  effectivePrice: number;
  isPopular: boolean;
  moduleCount: number;
  topicCount: number;
  program: ProgramLike | null;
}

export async function getCatalog(
  query: CatalogQuery,
  userId?: string,
): Promise<CatalogResponse> {
  const match: Record<string, unknown> = { isVisible: true };
  if (query.popular) match.isPopular = true;
  if (query.q) {
    match.$or = [
      { name: { $regex: query.q, $options: "i" } },
      { description: { $regex: query.q, $options: "i" } },
    ];
  }
  if (query.program) {
    const program = await ProgramModel.findOne({ slug: query.program }).select(
      "_id",
    );
    // A non-existent program slug yields an empty result set.
    match.program = program?._id ?? new Types.ObjectId();
  }

  const effectivePriceExpr = {
    $cond: [
      {
        $and: [
          { $gt: ["$discountPrice", 0] },
          { $lt: ["$discountPrice", "$price"] },
        ],
      },
      "$discountPrice",
      "$price",
    ],
  };

  const preFacet: Record<string, unknown>[] = [
    { $match: match },
    { $addFields: { effectivePrice: effectivePriceExpr } },
  ];
  if (query.free) preFacet.push({ $match: { effectivePrice: 0 } });

  const itemStages: Record<string, unknown>[] = [
    { $sort: { isPopular: -1, createdAt: -1 } },
    { $skip: (query.page - 1) * query.limit },
    { $limit: query.limit },
    {
      $lookup: {
        from: "modules",
        localField: "_id",
        foreignField: "subject",
        as: "modules",
      },
    },
    {
      $lookup: {
        from: "topics",
        let: { mids: "$modules._id" },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $in: ["$module", "$$mids"] },
                  { $eq: ["$isVisible", true] },
                ],
              },
            },
          },
          { $count: "c" },
        ],
        as: "topicCountArr",
      },
    },
    {
      $lookup: {
        from: "programs",
        localField: "program",
        foreignField: "_id",
        as: "programArr",
      },
    },
    {
      $addFields: {
        moduleCount: { $size: "$modules" },
        topicCount: { $ifNull: [{ $arrayElemAt: ["$topicCountArr.c", 0] }, 0] },
        program: { $arrayElemAt: ["$programArr", 0] },
      },
    },
    { $project: { modules: 0, topicCountArr: 0, programArr: 0 } },
  ];

  // The pipeline is built dynamically (conditional $match stages), so we assert
  // the Mongoose PipelineStage type at the boundary rather than threading the
  // strict stage unions through every push.
  const pipeline = [
    ...preFacet,
    { $facet: { items: itemStages, total: [{ $count: "count" }] } },
  ] as unknown as PipelineStage[];

  const [facet] = await SubjectModel.aggregate<{
    items: CatalogAggRow[];
    total: { count: number }[];
  }>(pipeline);

  const rows = facet?.items ?? [];
  const total = facet?.total[0]?.count ?? 0;

  // Enrolled flags for the signed-in user.
  let enrolledIds = new Set<string>();
  if (userId && rows.length > 0) {
    const enrollments = await EnrollmentModel.find({
      user: userId,
      subject: { $in: rows.map((r) => r._id) },
    })
      .select("subject")
      .lean();
    enrolledIds = new Set(enrollments.map((e) => e.subject.toString()));
  }

  const items: CatalogItem[] = rows.map((r) => ({
    id: r._id.toString(),
    slug: r.slug,
    name: r.name,
    description: r.description,
    image: r.image,
    price: r.price,
    discountPrice: r.discountPrice,
    effectivePrice: r.effectivePrice,
    isFree: r.effectivePrice <= 0,
    isPopular: r.isPopular,
    moduleCount: r.moduleCount,
    topicCount: r.topicCount,
    program: toProgramSummary(r.program),
    isEnrolled: enrolledIds.has(r._id.toString()),
  }));

  const programs = await ProgramModel.find({ isVisible: true })
    .sort({ order: 1, name: 1 })
    .select("name slug")
    .lean();

  return {
    items,
    programs: programs.map((p) => ({
      id: p._id.toString(),
      name: p.name,
      slug: p.slug,
    })),
    page: query.page,
    limit: query.limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / query.limit)),
  };
}

// ---------------------------------------------------------------------------
// Subject detail (browse)
// ---------------------------------------------------------------------------

export async function getSubjectDetail(
  slug: string,
  userId?: string,
): Promise<SubjectDetail> {
  const subject = await SubjectModel.findOne({
    slug,
    isVisible: true,
  }).populate<{
    program: ProgramLike | null;
  }>("program", "name slug");
  if (!subject) {
    throw new AppError(
      "Course not found",
      404,
      CurriculumErrorCode.SUBJECT_NOT_FOUND,
    );
  }

  const modules = await ModuleModel.find({ subject: subject._id }).sort({
    order: 1,
  });
  const moduleIds = modules.map((m) => m._id);
  const topics =
    moduleIds.length > 0
      ? await TopicModel.find({
          module: { $in: moduleIds },
          isVisible: true,
        }).sort({ order: 1 })
      : [];

  const enrollment = userId ? await findEnrollment(userId, subject._id) : null;
  const isEnrolled = Boolean(enrollment);

  // Completed set for the user.
  let completed = new Set<string>();
  if (userId && topics.length > 0) {
    const progressRows = await TopicProgressModel.find({
      user: userId,
      topic: { $in: topics.map((t) => t._id) },
      isCompleted: true,
    })
      .select("topic")
      .lean();
    completed = new Set(progressRows.map((p) => p.topic.toString()));
  }

  const topicsByModule = new Map<string, typeof topics>();
  for (const topic of topics) {
    const key = topic.module.toString();
    const list = topicsByModule.get(key) ?? [];
    list.push(topic);
    topicsByModule.set(key, list);
  }

  const price = subject.price;
  const discountPrice = subject.discountPrice;

  return {
    id: subject._id.toString(),
    slug: subject.slug,
    name: subject.name,
    description: subject.description,
    image: subject.image,
    price,
    discountPrice,
    effectivePrice: effectivePricePaise(price, discountPrice),
    isFree: isFree(price, discountPrice),
    isPopular: subject.isPopular,
    program: toProgramSummary(subject.program),
    moduleCount: modules.length,
    topicCount: topics.length,
    modules: modules.map((m) => ({
      id: m._id.toString(),
      name: m.name,
      order: m.order,
      topics: (topicsByModule.get(m._id.toString()) ?? []).map((t) => ({
        id: t._id.toString(),
        name: t.name,
        topicType: t.topicType as TopicType,
        order: t.order,
        duration: t.duration,
        isLocked: !isEnrolled,
        isCompleted: completed.has(t._id.toString()),
      })),
    })),
    enrollment: {
      isEnrolled,
      enrolledAt: enrollment?.createdAt
        ? enrollment.createdAt.toISOString()
        : null,
    },
    // Progress only meaningful for a signed-in user; anonymous sees zero.
    progress: userId
      ? await computeProgress(
          userId,
          topics.map((t) => t._id),
        )
      : { completedTopics: 0, totalTopics: topics.length, percentage: 0 },
  };
}

// ---------------------------------------------------------------------------
// Enrollment
// ---------------------------------------------------------------------------

export async function enroll(
  slug: string,
  userId: string,
): Promise<EnrollResponse> {
  const subject = await getVisibleSubjectBySlug(slug);
  const topicIds = await getVisibleTopicIds(subject._id);

  const existing = await findEnrollment(userId, subject._id);
  if (existing) {
    return {
      result: EnrollResult.ALREADY_ENROLLED,
      subjectSlug: slug,
      progress: await computeProgress(userId, topicIds),
    };
  }

  const price = effectivePricePaise(subject.price, subject.discountPrice);
  if (price > 0) {
    // Free path only for now — checkout arrives in the payments step.
    throw new AppError(
      "This is a paid course — payment is required to enrol",
      402,
      CurriculumErrorCode.PAYMENT_REQUIRED,
      { pricePaise: price, subjectSlug: slug },
    );
  }

  try {
    await EnrollmentModel.create({
      user: userId,
      subject: subject._id,
      source: "manual",
    });
  } catch (err) {
    // Unique (user, subject) — a race means someone already enrolled us.
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code?: number }).code === 11000
    ) {
      return {
        result: EnrollResult.ALREADY_ENROLLED,
        subjectSlug: slug,
        progress: await computeProgress(userId, topicIds),
      };
    }
    throw err;
  }

  return {
    result: EnrollResult.ENROLLED,
    subjectSlug: slug,
    progress: await computeProgress(userId, topicIds),
  };
}

/** Shape a user's enrollments (matching `filter`) into the list DTO — shared by
 * the individual `/me/enrollments` read and the tenant-scoped college read. */
async function shapeEnrollments(
  userId: string,
  filter: Record<string, unknown>,
): Promise<MyEnrollmentsResponse> {
  const enrollments = await EnrollmentModel.find(filter)
    .sort({ createdAt: -1 })
    .populate<{
      subject:
        (HydratedDocument<Subject> & { program: ProgramLike | null }) | null;
    }>({
      path: "subject",
      populate: { path: "program", select: "name slug" },
    });

  const items = [];
  for (const enrollment of enrollments) {
    const subject = enrollment.subject;
    if (!subject || !subject.isVisible) continue;
    const topicIds = await getVisibleTopicIds(subject._id);
    items.push({
      subject: {
        id: subject._id.toString(),
        slug: subject.slug,
        name: subject.name,
        image: subject.image,
        program: toProgramSummary(subject.program),
      },
      enrolledAt: (enrollment.createdAt ?? new Date()).toISOString(),
      progress: await computeProgress(userId, topicIds),
    });
  }
  return { items };
}

export function getMyEnrollments(
  userId: string,
): Promise<MyEnrollmentsResponse> {
  return shapeEnrollments(userId, { user: userId });
}

/**
 * A college student's ASSIGNED college courses — enrollments scoped to this
 * tenant + `source=college`. Same DTO/shaping as `/me/enrollments` (so the same
 * card + `/learn/:slug` player are reused), but tenant-isolated: only this
 * college's assignments, never the student's individual (B2C) enrollments.
 */
export function getMyCollegeEnrollments(
  userId: string,
  collegeId: string,
): Promise<MyEnrollmentsResponse> {
  return shapeEnrollments(userId, {
    user: userId,
    college: new Types.ObjectId(collegeId),
    source: EnrollmentSource.COLLEGE,
  });
}

// ---------------------------------------------------------------------------
// Topic content + progress (player step consumes these)
// ---------------------------------------------------------------------------

export async function getTopicContent(
  slug: string,
  topicId: string,
  userId: string,
): Promise<TopicContent> {
  const subject = await getVisibleSubjectBySlug(slug);
  await ensureEnrolled(userId, subject._id);
  const topic = await getTopicInSubject(subject._id, topicId);

  const progress = await TopicProgressModel.findOne({
    user: userId,
    topic: topic._id,
  }).select("isCompleted");

  return {
    id: topic._id.toString(),
    moduleId: topic.module.toString(),
    name: topic.name,
    topicType: topic.topicType as TopicType,
    order: topic.order,
    content: topic.content,
    videoId: topic.videoId,
    duration: topic.duration,
    isCompleted: progress?.isCompleted ?? false,
  };
}

export async function setTopicCompletion(
  slug: string,
  topicId: string,
  userId: string,
  completed: boolean,
): Promise<TopicCompleteResponse> {
  const subject = await getVisibleSubjectBySlug(slug);
  await ensureEnrolled(userId, subject._id);
  const topic = await getTopicInSubject(subject._id, topicId);

  await TopicProgressModel.updateOne(
    { user: userId, topic: topic._id },
    {
      $set: {
        isCompleted: completed,
        completedAt: completed ? new Date() : null,
      },
    },
    { upsert: true },
  );

  const topicIds = await getVisibleTopicIds(subject._id);
  return {
    topicId: topic._id.toString(),
    isCompleted: completed,
    progress: await computeProgress(userId, topicIds),
  };
}

// ---------------------------------------------------------------------------
// Quiz (server-authoritative grading; answers never leaked in GET)
// ---------------------------------------------------------------------------

async function loadQuizTopic(
  slug: string,
  topicId: string,
  userId: string,
): Promise<{
  subjectId: Types.ObjectId;
  topic: Awaited<ReturnType<typeof getTopicInSubject>>;
}> {
  const subject = await getVisibleSubjectBySlug(slug);
  await ensureEnrolled(userId, subject._id);
  const topic = await getTopicInSubject(subject._id, topicId);
  if (topic.topicType !== TopicType.QUIZ) {
    throw new AppError(
      "This topic is not a quiz",
      400,
      CurriculumErrorCode.NOT_A_QUIZ,
    );
  }
  return { subjectId: subject._id, topic };
}

export async function getQuiz(
  slug: string,
  topicId: string,
  userId: string,
): Promise<Quiz> {
  const { topic } = await loadQuizTopic(slug, topicId, userId);
  const questions = await QuestionModel.find({ topic: topic._id }).sort({
    createdAt: 1,
  });
  const choices = await ChoiceModel.find({
    question: { $in: questions.map((q) => q._id) },
  }).select("question text"); // note: NO isCorrect selected

  const choicesByQuestion = new Map<string, typeof choices>();
  for (const choice of choices) {
    const key = choice.question.toString();
    const list = choicesByQuestion.get(key) ?? [];
    list.push(choice);
    choicesByQuestion.set(key, list);
  }

  return {
    topicId: topic._id.toString(),
    subjectSlug: slug,
    title: topic.name,
    questions: questions.map((q) => ({
      id: q._id.toString(),
      text: q.text,
      marks: q.marks,
      choices: (choicesByQuestion.get(q._id.toString()) ?? []).map((c) => ({
        id: c._id.toString(),
        text: c.text,
      })),
    })),
  };
}

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((x) => set.has(x));
}

export async function submitQuiz(
  slug: string,
  topicId: string,
  userId: string,
  input: QuizSubmitRequest,
): Promise<QuizResult> {
  const { subjectId, topic } = await loadQuizTopic(slug, topicId, userId);

  const questions = await QuestionModel.find({ topic: topic._id }).sort({
    createdAt: 1,
  });
  const choices = await ChoiceModel.find({
    question: { $in: questions.map((q) => q._id) },
  }); // includes isCorrect — server-side only

  const correctByQuestion = new Map<string, string[]>();
  const validByQuestion = new Map<string, Set<string>>();
  for (const choice of choices) {
    const qid = choice.question.toString();
    validByQuestion.set(
      qid,
      (validByQuestion.get(qid) ?? new Set()).add(choice._id.toString()),
    );
    if (choice.isCorrect) {
      correctByQuestion.set(qid, [
        ...(correctByQuestion.get(qid) ?? []),
        choice._id.toString(),
      ]);
    }
  }

  const answerMap = new Map(
    input.answers.map((a) => [a.questionId, a.choiceIds]),
  );

  let score = 0;
  let maxScore = 0;
  let correctCount = 0;
  const results = questions.map((q) => {
    const qid = q._id.toString();
    const valid = validByQuestion.get(qid) ?? new Set<string>();
    const correctChoiceIds = correctByQuestion.get(qid) ?? [];
    // Keep only choice ids that actually belong to this question.
    const selectedChoiceIds = (answerMap.get(qid) ?? []).filter((id) =>
      valid.has(id),
    );
    const correct = sameSet(selectedChoiceIds, correctChoiceIds);
    maxScore += q.marks;
    if (correct) {
      score += q.marks;
      correctCount += 1;
    }
    return { questionId: qid, correct, selectedChoiceIds, correctChoiceIds };
  });

  await QuizSubmissionModel.create({
    user: userId,
    subject: subjectId,
    topic: topic._id,
    score,
    totalQuestions: questions.length,
  });

  return {
    score,
    maxScore,
    totalQuestions: questions.length,
    correctCount,
    percentage: maxScore > 0 ? Math.round((score / maxScore) * 100) : 0,
    results,
  };
}
