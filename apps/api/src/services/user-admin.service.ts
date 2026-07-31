/**
 * User ADMIN service (item 4-i) — READ/reporting over existing data. Mirrors the
 * other admin services (thin, admin-guarded at the route; AppError envelope) but
 * performs NO writes: a searchable/paginated user list, a per-user aggregate
 * detail (enrollments + exam/essay attempts + daily streak + progress), and a
 * per-college student-performance .xlsx export.
 *
 * All performance numbers are read straight from the collections that own them
 * (StudentExamAttempt, EssayAttempt, UserStreak, TopicProgress, …) — no scoring
 * logic is duplicated here.
 */
import {
  Role,
  UserAdminErrorCode,
  type AdminUpdateProfile,
  type AdminUserDetail,
  type AdminUserListQuery,
  type AdminUserListResponse,
} from "@codeapt/shared";
import { Types, type Model } from "mongoose";

import { AppError } from "../errors/app-error.js";
import {
  buildCollegePerformanceWorkbook,
  type CollegePerformanceRow,
} from "../lib/user-report-excel.js";
import { StudentExamAttemptModel } from "../models/assessment.model.js";
import {
  DailySubmissionModel,
  UserStreakModel,
} from "../models/challenge.model.js";
import {
  EnrollmentModel,
  QuizSubmissionModel,
  TopicProgressModel,
} from "../models/curriculum.model.js";
import { EssayAttemptModel } from "../models/essay.model.js";
import { ProfileModel, UserModel } from "../models/user.model.js";

// Escape user input before it becomes a case-insensitive regex.
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function iso(d: Date | null | undefined): string | null {
  return d ? new Date(d).toISOString() : null;
}

interface ProfileLean {
  fullName: string;
  collegeName?: string;
  rollNumber: string;
  phoneNumber?: string;
  state?: string;
  bio?: string;
}

// ---------------------------------------------------------------------------
// List / search
// ---------------------------------------------------------------------------

export async function listUsersAdmin(
  query: AdminUserListQuery,
): Promise<AdminUserListResponse> {
  const { q, role, college, page, pageSize } = query;

  const match: Record<string, unknown> = {};
  if (role) match.role = role;
  if (college) match["profile.collegeName"] = college;
  if (q) {
    const rx = new RegExp(escapeRegex(q), "i");
    match.$or = [
      { username: rx },
      { email: rx },
      { "profile.fullName": rx },
      { "profile.rollNumber": rx },
      { "profile.collegeName": rx },
    ];
  }

  const rows = await UserModel.aggregate<{
    items: {
      _id: Types.ObjectId;
      username: string;
      email: string;
      role: string;
      isActive: boolean;
      createdAt: Date;
      lastLoginAt?: Date;
      profile?: ProfileLean;
    }[];
    total: { n: number }[];
  }>([
    {
      $lookup: {
        from: "profiles",
        localField: "_id",
        foreignField: "user",
        as: "profile",
      },
    },
    { $unwind: { path: "$profile", preserveNullAndEmptyArrays: true } },
    { $match: match },
    {
      $facet: {
        items: [
          { $sort: { createdAt: -1, _id: -1 } },
          { $skip: (page - 1) * pageSize },
          { $limit: pageSize },
        ],
        total: [{ $count: "n" }],
      },
    },
  ]);

  const facet = rows[0] ?? { items: [], total: [] };
  return {
    items: facet.items.map((u) => ({
      id: u._id.toString(),
      username: u.username,
      email: u.email,
      role: u.role as Role,
      isActive: u.isActive,
      fullName: u.profile?.fullName ?? "",
      collegeName: u.profile?.collegeName ?? "",
      rollNumber: u.profile?.rollNumber ?? "",
      createdAt: new Date(u.createdAt).toISOString(),
      lastLoginAt: iso(u.lastLoginAt),
    })),
    total: facet.total[0]?.n ?? 0,
    page,
    pageSize,
  };
}

// ---------------------------------------------------------------------------
// Per-user detail aggregate
// ---------------------------------------------------------------------------

export async function getUserDetailAdmin(id: string): Promise<AdminUserDetail> {
  if (!Types.ObjectId.isValid(id)) {
    throw new AppError("User not found", 404, UserAdminErrorCode.USER_NOT_FOUND);
  }
  const user = await UserModel.findById(id);
  if (!user) {
    throw new AppError("User not found", 404, UserAdminErrorCode.USER_NOT_FOUND);
  }
  const userId = user._id;

  const [
    profile,
    enrollmentDocs,
    examDocs,
    essayDocs,
    streak,
    topicProgressDocs,
    quizDocs,
    dailyDocs,
  ] = await Promise.all([
    ProfileModel.findOne({ user: userId }).lean<ProfileLean | null>(),
    EnrollmentModel.find({ user: userId })
      .populate<{ subject: { name: string } | null }>("subject", "name")
      .sort({ createdAt: -1 }),
    StudentExamAttemptModel.find({ user: userId })
      .populate<{ exam: { title: string; totalMarks: number } | null }>(
        "exam",
        "title totalMarks",
      )
      .sort({ createdAt: -1 }),
    EssayAttemptModel.find({ user: userId })
      .populate<{ essayTopic: { title: string } | null }>("essayTopic", "title")
      .sort({ createdAt: -1 }),
    UserStreakModel.findOne({ user: userId }),
    TopicProgressModel.find({ user: userId })
      .populate<{ topic: { name: string } | null }>("topic", "name")
      .sort({ updatedAt: -1 }),
    QuizSubmissionModel.find({ user: userId })
      .populate<{ subject: { name: string } | null }>("subject", "name")
      .populate<{ topic: { name: string } | null }>("topic", "name")
      .sort({ createdAt: -1 }),
    DailySubmissionModel.find({ user: userId })
      .populate<{ question: { title: string; releaseDate: Date } | null }>(
        "question",
        "title releaseDate",
      )
      .sort({ createdAt: -1 }),
  ]);

  const enrollments = enrollmentDocs.map((e) => ({
    id: e._id.toString(),
    subject: e.subject?.name ?? "(removed subject)",
    source: e.source,
    createdAt: new Date(e.createdAt).toISOString(),
  }));

  const examAttempts = examDocs.map((a) => ({
    exam: a.exam?.title ?? "(removed exam)",
    score: a.score,
    totalMarks: a.exam?.totalMarks ?? 0,
    passed: a.passed,
    status: a.status,
    completedAt: iso(a.completedAt),
  }));

  const essayAttempts = essayDocs.map((a) => ({
    topic: a.essayTopic?.title ?? "(removed prompt)",
    finalScore: a.finalScore,
    status: a.status,
    submittedAt: iso(a.submittedAt),
  }));

  const topicProgress = topicProgressDocs.map((p) => ({
    topic: p.topic?.name ?? "(removed topic)",
    isCompleted: p.isCompleted,
    completedAt: iso(p.completedAt),
  }));

  const quizSubmissions = quizDocs.map((s) => ({
    subject: s.subject?.name ?? "(removed subject)",
    topic: s.topic?.name ?? null,
    score: s.score,
    totalQuestions: s.totalQuestions,
    percentage:
      s.totalQuestions > 0
        ? Math.round((s.score / s.totalQuestions) * 100)
        : 0,
    submittedAt: iso(s.createdAt),
  }));

  const dailySubmissions = dailyDocs.map((s) => ({
    question: s.question?.title ?? "(removed question)",
    releaseDate: iso(s.question?.releaseDate),
    isCorrect: s.isCorrect,
    score: s.score,
    submittedAt: iso(s.createdAt),
  }));

  const topicsCompleted = topicProgress.filter((p) => p.isCompleted).length;

  return {
    id: user._id.toString(),
    username: user.username,
    email: user.email,
    role: user.role as Role,
    isActive: user.isActive,
    createdAt: new Date(user.createdAt).toISOString(),
    lastLoginAt: iso(user.lastLoginAt),
    profile: {
      fullName: profile?.fullName ?? "",
      collegeName: profile?.collegeName ?? "",
      rollNumber: profile?.rollNumber ?? "",
      phoneNumber: profile?.phoneNumber ?? "",
      state: profile?.state ?? "",
      bio: profile?.bio ?? "",
    },
    stats: {
      enrollments: enrollments.length,
      examAttempts: examAttempts.length,
      examsPassed: examAttempts.filter((a) => a.passed).length,
      essayAttempts: essayAttempts.length,
      topicsCompleted,
      quizSubmissions: quizSubmissions.length,
      dailySubmissions: dailySubmissions.length,
      currentStreak: streak?.currentStreak ?? 0,
      maxStreak: streak?.maxStreak ?? 0,
      dailyTotalScore: streak?.totalScore ?? 0,
    },
    enrollments,
    examAttempts,
    essayAttempts,
    topicProgress,
    quizSubmissions,
    dailySubmissions,
  };
}

// ---------------------------------------------------------------------------
// Per-college performance export
// ---------------------------------------------------------------------------

/** Group-count docs by their `user` field → Map<userId, count>. */
async function countByUser(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- heterogeneous models; only aggregate() is used
  model: Model<any>,
  match: Record<string, unknown> = {},
): Promise<Map<string, number>> {
  const rows = await model.aggregate<{ _id: Types.ObjectId | null; c: number }>([
    { $match: match },
    { $group: { _id: "$user", c: { $sum: 1 } } },
  ]);
  return new Map(rows.filter((r) => r._id).map((r) => [r._id!.toString(), r.c]));
}

export async function exportCollegePerformance(): Promise<{
  buffer: Buffer;
  filename: string;
}> {
  // Per-college performance is about STUDENTS.
  const students = await UserModel.find({ role: Role.STUDENT }).lean<
    {
      _id: Types.ObjectId;
      email: string;
      createdAt: Date;
    }[]
  >();
  const ids = students.map((s) => s._id);

  const profiles = await ProfileModel.find({ user: { $in: ids } }).lean<
    ({ user: Types.ObjectId } & ProfileLean)[]
  >();
  const profileByUser = new Map(profiles.map((p) => [p.user.toString(), p]));

  const [enrollCounts, topicCounts, streaks] = await Promise.all([
    countByUser(EnrollmentModel, { user: { $in: ids } }),
    countByUser(TopicProgressModel, { user: { $in: ids }, isCompleted: true }),
    UserStreakModel.find({ user: { $in: ids } }).lean<
      {
        user: Types.ObjectId;
        currentStreak: number;
        maxStreak: number;
        totalScore: number;
      }[]
    >(),
  ]);
  const streakByUser = new Map(streaks.map((s) => [s.user.toString(), s]));

  // Exam attempts → taken / passed / avg percent, grouped by user.
  const examAgg = (await StudentExamAttemptModel.aggregate([
    { $match: { user: { $in: ids } } },
    {
      $lookup: {
        from: "exams",
        localField: "exam",
        foreignField: "_id",
        as: "exam",
      },
    },
    { $unwind: { path: "$exam", preserveNullAndEmptyArrays: true } },
    {
      $group: {
        _id: "$user",
        taken: { $sum: 1 },
        passed: { $sum: { $cond: ["$passed", 1, 0] } },
        pctSum: {
          $sum: {
            $cond: [
              { $gt: ["$exam.totalMarks", 0] },
              {
                $multiply: [
                  { $divide: ["$score", "$exam.totalMarks"] },
                  100,
                ],
              },
              0,
            ],
          },
        },
      },
    },
  ])) as {
    _id: Types.ObjectId;
    taken: number;
    passed: number;
    pctSum: number;
  }[];
  const examByUser = new Map(examAgg.map((e) => [e._id.toString(), e]));

  // Essay attempts → count / avg final score, grouped by user.
  const essayAgg = (await EssayAttemptModel.aggregate([
    { $match: { user: { $in: ids } } },
    {
      $group: {
        _id: "$user",
        count: { $sum: 1 },
        scoreSum: { $sum: "$finalScore" },
      },
    },
  ])) as { _id: Types.ObjectId; count: number; scoreSum: number }[];
  const essayByUser = new Map(essayAgg.map((e) => [e._id.toString(), e]));

  const rows: CollegePerformanceRow[] = students.map((s) => {
    const key = s._id.toString();
    const profile = profileByUser.get(key);
    const exam = examByUser.get(key);
    const essay = essayByUser.get(key);
    const streak = streakByUser.get(key);
    const examsTaken = exam?.taken ?? 0;
    const essaysSubmitted = essay?.count ?? 0;
    return {
      college: profile?.collegeName ?? "",
      student: profile?.fullName ?? "",
      rollNumber: profile?.rollNumber ?? "",
      email: s.email,
      enrollments: enrollCounts.get(key) ?? 0,
      examsTaken,
      examsPassed: exam?.passed ?? 0,
      avgExamPercent:
        examsTaken > 0 ? Math.round((exam!.pctSum / examsTaken) * 10) / 10 : 0,
      essaysSubmitted,
      avgEssayScore:
        essaysSubmitted > 0
          ? Math.round((essay!.scoreSum / essaysSubmitted) * 10) / 10
          : 0,
      currentStreak: streak?.currentStreak ?? 0,
      maxStreak: streak?.maxStreak ?? 0,
      dailyTotalScore: streak?.totalScore ?? 0,
      topicsCompleted: topicCounts.get(key) ?? 0,
      joinedAt: new Date(s.createdAt).toISOString(),
    };
  });

  // Sort by college, then student name (blank colleges last).
  rows.sort((a, b) => {
    const ca = a.college || "￿";
    const cb = b.college || "￿";
    return ca.localeCompare(cb) || a.student.localeCompare(b.student);
  });

  const buffer = await buildCollegePerformanceWorkbook(rows);
  return { buffer, filename: "college-performance.xlsx" };
}

// ---------------------------------------------------------------------------
// CONFIG mutations (item CRUD-batch-2)
// ---------------------------------------------------------------------------
//
// passwordHash and tokenVersion are NEVER written here. Deactivation and role
// change take effect immediately via the live gate in requireAuth (it re-loads
// the user and rejects on !isActive or a role change every request), so there
// is no need to touch tokenVersion — that is reserved for password-change /
// logout-all. Password resets go through the existing force-password-change
// flow, not a raw field here.

async function loadUser(id: string) {
  if (!Types.ObjectId.isValid(id)) {
    throw new AppError("User not found", 404, UserAdminErrorCode.USER_NOT_FOUND);
  }
  const user = await UserModel.findById(id);
  if (!user) {
    throw new AppError("User not found", 404, UserAdminErrorCode.USER_NOT_FOUND);
  }
  return user;
}

/** True when at least one OTHER active admin exists besides `exceptId`. */
async function anotherActiveAdminExists(
  exceptId: Types.ObjectId,
): Promise<boolean> {
  const count = await UserModel.countDocuments({
    role: Role.ADMIN,
    isActive: true,
    _id: { $ne: exceptId },
  });
  return count > 0;
}

const MONGO_DUPLICATE_KEY = 11000;
function isDuplicateKeyError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: number }).code === MONGO_DUPLICATE_KEY
  );
}

export async function setUserActive(
  adminId: string,
  targetId: string,
  isActive: boolean,
): Promise<AdminUserDetail> {
  const user = await loadUser(targetId);
  if (!isActive) {
    if (user._id.toString() === adminId) {
      throw new AppError(
        "You can't deactivate your own account.",
        400,
        UserAdminErrorCode.SELF_ACTION_FORBIDDEN,
      );
    }
    if (user.role === Role.ADMIN && !(await anotherActiveAdminExists(user._id))) {
      throw new AppError(
        "Can't deactivate the last active admin.",
        409,
        UserAdminErrorCode.LAST_ADMIN,
      );
    }
  }
  user.isActive = isActive;
  await user.save();
  return getUserDetailAdmin(targetId);
}

export async function setUserRole(
  adminId: string,
  targetId: string,
  role: Role,
): Promise<AdminUserDetail> {
  const user = await loadUser(targetId);
  if (user._id.toString() === adminId) {
    throw new AppError(
      "You can't change your own role.",
      400,
      UserAdminErrorCode.SELF_ACTION_FORBIDDEN,
    );
  }
  // Demoting an admin must not strand the system with zero active admins.
  if (
    user.role === Role.ADMIN &&
    role !== Role.ADMIN &&
    !(await anotherActiveAdminExists(user._id))
  ) {
    throw new AppError(
      "Can't demote the last active admin.",
      409,
      UserAdminErrorCode.LAST_ADMIN,
    );
  }
  user.role = role;
  await user.save();
  return getUserDetailAdmin(targetId);
}

export async function updateUserProfile(
  targetId: string,
  input: AdminUpdateProfile,
): Promise<AdminUserDetail> {
  const user = await loadUser(targetId);
  const profile = await ProfileModel.findOne({ user: user._id });
  if (!profile) {
    throw new AppError("User not found", 404, UserAdminErrorCode.USER_NOT_FOUND);
  }
  profile.fullName = input.fullName.trim();
  profile.collegeName = input.collegeName;
  profile.rollNumber = input.rollNumber.trim();
  profile.phoneNumber = input.phoneNumber;
  profile.state = input.state;
  profile.bio = input.bio;
  try {
    await profile.save();
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      throw new AppError(
        `Roll number "${input.rollNumber}" is already in use.`,
        409,
        UserAdminErrorCode.ROLL_TAKEN,
      );
    }
    throw err;
  }
  return getUserDetailAdmin(targetId);
}

/**
 * Remove a user's enrollment in a subject. Deletes ONLY the Enrollment row —
 * TopicProgress / quiz / attempt history is keyed by (user, topic/subject), not
 * by the enrollment, so it is preserved. Re-enrolling restores the same
 * progress; unenrolling never destroys learning history.
 */
export async function unenrollUser(
  targetId: string,
  enrollmentId: string,
): Promise<AdminUserDetail> {
  const user = await loadUser(targetId);
  if (!Types.ObjectId.isValid(enrollmentId)) {
    throw new AppError(
      "Enrollment not found",
      404,
      UserAdminErrorCode.ENROLLMENT_NOT_FOUND,
    );
  }
  const result = await EnrollmentModel.deleteOne({
    _id: enrollmentId,
    user: user._id,
  });
  if (result.deletedCount === 0) {
    throw new AppError(
      "Enrollment not found",
      404,
      UserAdminErrorCode.ENROLLMENT_NOT_FOUND,
    );
  }
  return getUserDetailAdmin(targetId);
}
