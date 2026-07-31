/**
 * Per-student AI credit distribution service (layers UNDER Stage-1 pool +
 * Stage-2 governor). The college_admin carves the college's per-period pool into
 * per-student allocations; students spend only their own at the gateway seam.
 *
 * ACCOUNTING (no double-charge): the pool is committed to a student at
 * ALLOCATION time — captured by Σ(student allocations) reducing `distributable`
 * (= pool.allocated − Σ allocated). At SPEND time the seam debits the STUDENT
 * ledger only (reserveStudentCredits), never the college pool again. Non-student
 * (faculty/platform) AI keeps drawing the pool directly (Stage-1, unchanged).
 *
 * Reserve is a single conditional atomic $inc (concurrency-safe). Rows are per
 * monthly-IST periodKey (same key as the pool) → no rollover; a new period has
 * no rows and the admin re-distributes.
 */
import {
  AiCreditErrorCode,
  Role,
  UserType,
  aiActionWeight,
  aiCreditPeriodKey,
  aiCreditsRemaining,
  collectDescendantUnitIds,
  distributableCredits,
  type AiCreditDistributionResponse,
  type AllocateStudentCreditsInput,
  type StudentAiCreditRow,
  type StudentOwnAiCredit,
} from "@codeapt/shared";
import { Types } from "mongoose";

import { AppError } from "../errors/app-error.js";
import { createTenantScope } from "../lib/tenant-scope.js";
import { CollegeModel } from "../models/college.model.js";
import { OrgUnitModel } from "../models/org-unit.model.js";
import { ProfileModel, UserModel } from "../models/user.model.js";
import { StudentAiCreditLedgerModel } from "../models/student-ai-credit.model.js";
import { ensureLedger } from "./ai-credit.service.js";

// --- Mode flag (opt-in) ------------------------------------------------------

/** Whether the college runs per-student distribution (default false). */
export async function getPerStudentEnabled(collegeId: string): Promise<boolean> {
  const college = await CollegeModel.findById(collegeId).select("credits").lean();
  return college?.credits?.perStudentDistribution === true;
}

export async function setPerStudentEnabled(
  collegeId: string,
  enabled: boolean,
): Promise<boolean> {
  await CollegeModel.updateOne(
    { _id: new Types.ObjectId(collegeId) },
    { $set: { "credits.perStudentDistribution": enabled } },
  );
  return enabled;
}

/**
 * The studentId to meter an AI call against, or undefined. Returns the id ONLY
 * when the college has per-student distribution enabled — so when it's off, the
 * seam falls back to Stage-1 per-college metering (unchanged). Called at the
 * student-initiated AI call/enqueue sites.
 */
export async function resolveStudentMeterId(
  collegeId: string | null | undefined,
  studentUserId: string | null | undefined,
): Promise<string | undefined> {
  if (!collegeId || !studentUserId) return undefined;
  return (await getPerStudentEnabled(collegeId)) ? studentUserId : undefined;
}

// --- Seam metering (student ledger; mirrors the college reserve) -------------

/** Atomically reserve the action's weight against the student's allocation. */
export async function reserveStudentCredits(
  collegeId: string,
  studentId: string,
  feature: string,
  now: Date,
): Promise<boolean> {
  if (!Types.ObjectId.isValid(collegeId) || !Types.ObjectId.isValid(studentId)) {
    return false;
  }
  const periodKey = aiCreditPeriodKey(now);
  const weight = aiActionWeight(feature);
  const updated = await StudentAiCreditLedgerModel.findOneAndUpdate(
    {
      college: new Types.ObjectId(collegeId),
      student: new Types.ObjectId(studentId),
      periodKey,
      $expr: { $lte: [{ $add: ["$consumed", weight] }, "$allocated"] },
    },
    { $inc: { consumed: weight, [`byFeature.${feature}`]: weight } },
    { new: true },
  );
  return updated !== null;
}

/** Refund a reserved weight (provider call failed after we reserved). */
export async function refundStudentCredits(
  collegeId: string,
  studentId: string,
  feature: string,
  now: Date,
): Promise<void> {
  if (!Types.ObjectId.isValid(collegeId) || !Types.ObjectId.isValid(studentId)) {
    return;
  }
  const periodKey = aiCreditPeriodKey(now);
  const weight = aiActionWeight(feature);
  await StudentAiCreditLedgerModel.updateOne(
    {
      college: new Types.ObjectId(collegeId),
      student: new Types.ObjectId(studentId),
      periodKey,
    },
    { $inc: { consumed: -weight, [`byFeature.${feature}`]: -weight } },
  );
}

// --- Student selection (reuse the attendance selection methods) --------------

/**
 * Resolve a unique set of college-student ids from any combination of org-unit
 * subtrees, individual ids, and matched roll numbers — the same three selection
 * methods the attendance group formation uses. college_admin is unrestricted.
 */
async function resolveStudentIds(
  collegeId: string,
  input: {
    orgUnitIds?: string[];
    studentIds?: string[];
    excelRollNumbers?: string[];
  },
): Promise<string[]> {
  const scope = createTenantScope(collegeId);
  const ids = new Set<string>();
  const studentFilter = { role: Role.STUDENT, userType: UserType.COLLEGE };

  // 1) ORG-UNIT / SECTION subtree → every student under each unit + descendants.
  const orgUnitIds = [...new Set(input.orgUnitIds ?? [])];
  if (orgUnitIds.length > 0) {
    const units = await OrgUnitModel.find(scope.filter()).select("_id parent");
    const known = new Set(units.map((u) => u._id.toString()));
    for (const unitId of orgUnitIds) {
      if (!Types.ObjectId.isValid(unitId) || !known.has(unitId)) {
        throw new AppError(
          "An org-unit was not found in this college",
          400,
          AiCreditErrorCode.ORG_UNIT_NOT_FOUND,
        );
      }
    }
    const refs = units.map((u) => ({
      id: u._id.toString(),
      parentId: u.parent ? u.parent.toString() : null,
    }));
    const subtree = collectDescendantUnitIds(refs, orgUnitIds).map(
      (id) => new Types.ObjectId(id),
    );
    const students = await UserModel.find(
      scope.filter({ ...studentFilter, orgUnit: { $in: subtree } }),
    ).select("_id");
    for (const s of students) ids.add(s._id.toString());
  }

  // 2) INDIVIDUAL ids — must be college students in this tenant.
  const studentIds = [...new Set(input.studentIds ?? [])].filter((id) =>
    Types.ObjectId.isValid(id),
  );
  if (studentIds.length > 0) {
    const students = await UserModel.find(
      scope.filter({
        ...studentFilter,
        _id: { $in: studentIds.map((id) => new Types.ObjectId(id)) },
      }),
    ).select("_id");
    if (students.length !== studentIds.length) {
      throw new AppError(
        "A selected student was not found in this college",
        400,
        AiCreditErrorCode.STUDENT_NOT_FOUND,
      );
    }
    for (const s of students) ids.add(s._id.toString());
  }

  // 3) EXCEL roll numbers — matched to students; unmatched are silently skipped
  // (the preview endpoint already surfaced them to the admin).
  const rolls = [...new Set((input.excelRollNumbers ?? []).map((r) => r.trim()).filter(Boolean))];
  if (rolls.length > 0) {
    const students = await UserModel.find(
      scope.filter({ ...studentFilter, rollNumber: { $in: rolls } }),
    ).select("_id");
    for (const s of students) ids.add(s._id.toString());
  }

  return [...ids];
}

// --- Distribution view + allocate --------------------------------------------

interface LedgerLean {
  student: Types.ObjectId;
  allocated: number;
  consumed: number;
}

async function buildDistribution(
  collegeId: string,
  now: Date,
): Promise<AiCreditDistributionResponse> {
  const scope = createTenantScope(collegeId);
  const [enabled, pool] = await Promise.all([
    getPerStudentEnabled(collegeId),
    ensureLedger(collegeId, now),
  ]);
  const periodKey = pool.periodKey;
  const ledgers = (await StudentAiCreditLedgerModel.find(
    scope.filter({ periodKey }),
  )
    .select("student allocated consumed")
    .lean()) as unknown as LedgerLean[];

  const allocatedToStudents = ledgers.reduce((s, l) => s + l.allocated, 0);
  const consumedByStudents = ledgers.reduce((s, l) => s + l.consumed, 0);

  // Rows for students who currently hold an allocation.
  const held = ledgers.filter((l) => l.allocated > 0);
  const studentObjIds = held.map((l) => l.student);
  const [users, profiles] = await Promise.all([
    UserModel.find(scope.filter({ _id: { $in: studentObjIds } }))
      .select("_id rollNumber orgUnit")
      .lean(),
    ProfileModel.find({ user: { $in: studentObjIds } })
      .select("user fullName")
      .lean(),
  ]);
  const userById = new Map(users.map((u) => [u._id.toString(), u]));
  const nameByUser = new Map(profiles.map((p) => [p.user.toString(), p.fullName]));

  const students: StudentAiCreditRow[] = held
    .map((l) => {
      const uid = l.student.toString();
      const u = userById.get(uid);
      return {
        studentId: uid,
        fullName: nameByUser.get(uid) ?? "",
        rollNumber: u?.rollNumber ?? "",
        orgUnitId: u?.orgUnit ? u.orgUnit.toString() : null,
        allocated: l.allocated,
        consumed: l.consumed,
        remaining: aiCreditsRemaining(l.allocated, l.consumed),
      };
    })
    .sort((a, b) => b.allocated - a.allocated || a.fullName.localeCompare(b.fullName));

  return {
    enabled,
    periodKey,
    poolAllocated: pool.allocated,
    allocatedToStudents,
    distributable: distributableCredits(pool.allocated, allocatedToStudents),
    consumedByStudents,
    students,
  };
}

export async function getCreditDistribution(
  collegeId: string,
  now: Date,
): Promise<AiCreditDistributionResponse> {
  return buildDistribution(collegeId, now);
}

/**
 * SET each selected student's allocation to `amount` for the current period,
 * rejecting if the resulting Σ would exceed the pool. Returns the fresh view.
 */
export async function allocateStudentCredits(
  collegeId: string,
  input: AllocateStudentCreditsInput,
  now: Date,
): Promise<AiCreditDistributionResponse> {
  const scope = createTenantScope(collegeId);
  const pool = await ensureLedger(collegeId, now);
  const periodKey = pool.periodKey;

  const selected = await resolveStudentIds(collegeId, input);
  if (selected.length === 0) {
    // Nothing matched (e.g. all roll numbers unmatched) → no-op, return view.
    return buildDistribution(collegeId, now);
  }

  const ledgers = (await StudentAiCreditLedgerModel.find(scope.filter({ periodKey }))
    .select("student allocated")
    .lean()) as unknown as { student: Types.ObjectId; allocated: number }[];
  const currentTotal = ledgers.reduce((s, l) => s + l.allocated, 0);
  const selectedSet = new Set(selected);
  const selectedCurrent = ledgers
    .filter((l) => selectedSet.has(l.student.toString()))
    .reduce((s, l) => s + l.allocated, 0);

  // Distributable EXCLUDING the selected students' current allocations (we're
  // replacing them), then check the new total fits the pool.
  const newTotal = currentTotal - selectedCurrent + input.amount * selected.length;
  if (newTotal > pool.allocated) {
    const freeForSelection = pool.allocated - (currentTotal - selectedCurrent);
    throw new AppError(
      "Allocating this amount would exceed the college's distributable credits",
      400,
      AiCreditErrorCode.OVER_ALLOCATION,
      {
        requested: input.amount * selected.length,
        distributable: Math.max(0, freeForSelection),
        perStudent: input.amount,
        students: selected.length,
      },
    );
  }

  // SET-semantics: each selected student's allocation becomes `amount`.
  await StudentAiCreditLedgerModel.bulkWrite(
    selected.map((id) => ({
      updateOne: {
        filter: scope.filter({ student: new Types.ObjectId(id), periodKey }),
        update: {
          $set: { allocated: input.amount },
          $setOnInsert: { consumed: 0, byFeature: {} },
        },
        upsert: true,
      },
    })),
  );

  return buildDistribution(collegeId, now);
}

// --- Student's own view (own-data-only) --------------------------------------

export async function getStudentOwnCredits(
  collegeId: string,
  studentId: string,
  now: Date,
): Promise<StudentOwnAiCredit> {
  const scope = createTenantScope(collegeId);
  const enabled = await getPerStudentEnabled(collegeId);
  const periodKey = aiCreditPeriodKey(now);
  const row = await StudentAiCreditLedgerModel.findOne(
    scope.filter({ student: new Types.ObjectId(studentId), periodKey }),
  )
    .select("allocated consumed")
    .lean();
  return {
    enabled,
    periodKey,
    allocated: row ? row.allocated : null,
    consumed: row ? row.consumed : 0,
    remaining: row ? aiCreditsRemaining(row.allocated, row.consumed) : 0,
  };
}
