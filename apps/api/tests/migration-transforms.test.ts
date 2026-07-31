/**
 * Migration transform unit tests — NO live database. Exercises the tricky,
 * locked rules: money → paise (incl. the percentage-coupon exception), the
 * user/profile split + role derivation, exam/daily option collapsing, enum
 * translation (+ flagging), null / unresolved FK handling, and unmapped-field
 * preservation.
 */
import { Types } from "mongoose";
import { describe, expect, it } from "vitest";

import { MigrationReport } from "../src/migration/report.js";
import {
  TABLES,
  collapseDailyOptions,
  collapseExamOptions,
  rupeesToPaise,
  transformCoupon,
  transformEnrollment,
  transformEssayAttempt,
  transformEssayTopic,
  transformJob,
  transformModule,
  transformOrder,
  transformProgram,
  transformResetLog,
  transformSubject,
  transformUser,
  transformExamQuestion,
  type Ctx,
  type IdMaps,
} from "../src/migration/transforms.js";

function makeCtx(hints?: Ctx["hints"]): {
  ctx: Ctx;
  report: MigrationReport;
  maps: IdMaps;
} {
  const report = new MigrationReport();
  const maps: IdMaps = Object.fromEntries(
    TABLES.map((t) => [t.logical, new Map<string, Types.ObjectId>()]),
  );
  const ctx: Ctx = { id: new Types.ObjectId(), maps, report, hints };
  return { ctx, report, maps };
}

describe("money → integer paise", () => {
  it("rounds rupees ×100", () => {
    expect(rupeesToPaise("199.50")).toBe(19950);
    expect(rupeesToPaise(0)).toBe(0);
    expect(rupeesToPaise("0.01")).toBe(1);
    expect(rupeesToPaise(null)).toBe(0);
  });

  it("converts subject + order amounts", () => {
    const s = makeCtx();
    const subject = transformSubject(
      { id: 1, name: "DS", slug: "ds", price: "199.00", discount_price: "149.50" },
      s.ctx,
    );
    expect(subject.price).toBe(19900);
    expect(subject.discountPrice).toBe(14950);

    const o = makeCtx();
    const order = transformOrder(
      { id: 1, order_id: "ORD1", amount: "500", discount_amount: "50", status: "SUCCESS" },
      o.ctx,
    );
    expect(order.amount).toBe(50000);
    expect(order.discountAmount).toBe(5000);
    expect(order.status).toBe("success");
  });

  it("keeps a PERCENTAGE coupon value as-is, but converts a FIXED value to paise", () => {
    const pct = makeCtx();
    const percentage = transformCoupon(
      { id: 1, code: "save10", discount_type: "percentage", discount_value: "10" },
      pct.ctx,
    );
    expect(percentage.discountType).toBe("percentage");
    expect(percentage.discountValue).toBe(10); // percent, unchanged
    expect(percentage.code).toBe("SAVE10");

    const fixed = makeCtx();
    const fixedCoupon = transformCoupon(
      { id: 2, code: "FLAT50", discount_type: "fixed", discount_value: "50" },
      fixed.ctx,
    );
    expect(fixedCoupon.discountType).toBe("fixed");
    expect(fixedCoupon.discountValue).toBe(5000); // ₹50 → paise
  });
});

describe("user split + role derivation", () => {
  it("maps superuser/staff to admin and records them; keeps the Django hash as-is", () => {
    const { ctx, report } = makeCtx();
    const doc = transformUser(
      {
        id: 7,
        username: "boss",
        email: "BOSS@Example.com",
        password: "pbkdf2_sha256$260000$abc$def==",
        is_superuser: false,
        is_staff: true,
        is_active: true,
      },
      ctx,
    );
    expect(doc.role).toBe("admin");
    expect(doc.passwordHash).toBe("pbkdf2_sha256$260000$abc$def==");
    expect(doc.email).toBe("boss@example.com");
    expect(doc.tokenVersion).toBe(0);
    expect(report.admins).toEqual([{ username: "boss", email: "boss@example.com" }]);
  });

  it("defaults a plain user to student and pulls forcePasswordChange from hints", () => {
    const hints = { forcePwByUserId: new Map([["9", true]]) };
    const { ctx, report } = makeCtx(hints);
    const doc = transformUser(
      { id: 9, username: "stu", email: "s@x.com", password: "h", is_superuser: false, is_staff: false, is_active: true },
      ctx,
    );
    expect(doc.role).toBe("student");
    expect(doc.forcePasswordChange).toBe(true);
    expect(report.admins).toHaveLength(0);
  });
});

describe("option collapsing", () => {
  it("collapses exam option_1..5 + comma-sep correct into a compact 0-based set", () => {
    const { options, correctOptions } = collapseExamOptions({
      option_1: "A",
      option_2: "",
      option_3: "B",
      option_4: "C",
      correct_options: "1,3",
    });
    expect(options).toEqual(["A", "B", "C"]);
    expect(correctOptions).toEqual([0, 1]); // option numbers 1 & 3 → indices 0 & 1
  });

  it("derives MCQ_SINGLE vs MCQ_MULTI from the correct count for a generic 'MCQ'", () => {
    const single = makeCtx();
    const q1 = transformExamQuestion(
      { id: 1, question_type: "MCQ", text: "q", option_1: "A", option_2: "B", correct_options: "1" },
      single.ctx,
    );
    expect(q1.questionType).toBe("MCQ_SINGLE");

    const multi = makeCtx();
    const q2 = transformExamQuestion(
      { id: 2, question_type: "MCQ", text: "q", option_1: "A", option_2: "B", correct_options: "1,2" },
      multi.ctx,
    );
    expect(q2.questionType).toBe("MCQ_MULTI");

    const code = makeCtx();
    const q3 = transformExamQuestion(
      { id: 3, question_type: "CODE", text: "q", starter_code: "print()" },
      code.ctx,
    );
    expect(q3.questionType).toBe("CODE");
    expect(q3.options).toBeUndefined();
    expect(q3.correctOptions).toBeUndefined();
  });

  it("collapses daily option_a..d with a letter correct_option", () => {
    expect(collapseDailyOptions({ option_a: "X", option_b: "Y", option_c: "Z", correct_option: "b" })).toEqual({
      options: ["X", "Y", "Z"],
      correctOption: 1,
    });
    // 1-based numeric correct_option resolves to the same index.
    expect(collapseDailyOptions({ option_a: "X", option_b: "Y", correct_option: 2 })).toEqual({
      options: ["X", "Y"],
      correctOption: 1,
    });
  });
});

describe("enum translation", () => {
  it("flags an unknown value and falls back (never silently dropped)", () => {
    const { ctx, report } = makeCtx();
    const order = transformOrder(
      { id: 1, order_id: "O", amount: "0", status: "WEIRD_STATUS" },
      ctx,
    );
    expect(order.status).toBe("pending"); // fallback
    const flag = [...report.enumFlags.values()][0];
    expect(flag).toMatchObject({
      table: "order",
      field: "status",
      sourceValue: "WEIRD_STATUS",
      fallback: "pending",
    });
  });
});

describe("FK remapping", () => {
  it("resolves a mapped FK, nulls an absent FK (no flag), flags an unresolved FK", () => {
    // absent FK → null, no flag
    const a = makeCtx();
    const m0 = transformModule({ id: 1, name: "M", subject_id: null }, a.ctx);
    expect(m0.subject).toBeNull();
    expect(a.report.unresolvedFks.size).toBe(0);

    // mapped FK → the parent ObjectId
    const b = makeCtx();
    const parentId = new Types.ObjectId();
    b.maps.subject!.set("42", parentId);
    const m1 = transformModule({ id: 2, name: "M", subject_id: 42 }, b.ctx);
    expect(m1.subject).toBe(parentId);
    expect(b.report.unresolvedFks.size).toBe(0);

    // non-null FK with no parent → null + flagged
    const c = makeCtx();
    const m2 = transformModule({ id: 3, name: "M", subject_id: 999 }, c.ctx);
    expect(m2.subject).toBeNull();
    expect(c.report.unresolvedFks.get("module.subject")?.count).toBe(1);
  });
});

describe("unmapped-field preservation + timestamps", () => {
  it("stashes unknown columns under _migrated and records them", () => {
    const { ctx, report } = makeCtx();
    const created = new Date("2020-01-02T03:04:05Z");
    const doc = transformProgram(
      { id: 1, name: "P", slug: "p", legacy_flag: true, weird_col: 5, created_at: created },
      ctx,
    );
    expect((doc._migrated as Record<string, unknown>).legacy_flag).toBe(true);
    expect((doc._migrated as Record<string, unknown>).weird_col).toBe(5);
    expect(doc.createdAt).toEqual(created); // original timestamp carried over
    const preserved = report.preserved.get("program");
    expect(preserved?.has("legacy_flag")).toBe(true);
    expect(preserved?.has("weird_col")).toBe(true);
    // created_at is consumed as a timestamp, not stashed.
    expect(preserved?.has("created_at")).toBe(false);
  });

  it("adds no _migrated when every column is mapped", () => {
    const { ctx } = makeCtx();
    const doc = transformProgram({ id: 1, name: "P", slug: "p", description: "", order: 0, is_visible: true }, ctx);
    expect(doc._migrated).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Round-2 fixes (from the first dry-run report)
// ---------------------------------------------------------------------------

describe("FIX 1 — exam question type reads q_type", () => {
  it("maps MCQ_SINGLE / MCQ_MULTI / CODE directly from q_type", () => {
    const single = makeCtx();
    expect(
      transformExamQuestion({ id: 1, q_type: "MCQ_SINGLE", text: "q", option_1: "A", option_2: "B", correct_options: "1" }, single.ctx)
        .questionType,
    ).toBe("MCQ_SINGLE");
    expect(single.report.enumFlags.size).toBe(0); // no flag now

    const multi = makeCtx();
    expect(
      transformExamQuestion({ id: 2, q_type: "MCQ_MULTI", text: "q", option_1: "A", option_2: "B", correct_options: "1,2" }, multi.ctx)
        .questionType,
    ).toBe("MCQ_MULTI");

    const code = makeCtx();
    const q = transformExamQuestion({ id: 3, q_type: "CODE", text: "q", starter_code: "x" }, code.ctx);
    expect(q.questionType).toBe("CODE");
    expect(q.options).toBeUndefined();
  });

  it("is driven by q_type, not the legacy question_type column", () => {
    const { ctx } = makeCtx();
    // q_type=CODE must win even if a stray question_type=MCQ_SINGLE is present.
    const q = transformExamQuestion(
      { id: 1, q_type: "CODE", question_type: "MCQ_SINGLE", text: "q" },
      ctx,
    );
    expect(q.questionType).toBe("CODE");
    // q_type is consumed → not stashed.
    expect(q._migrated).toBeUndefined();
  });

  it("derives exam from the section when the source has no exam_id", () => {
    // Django's ExamQuestion has no exam_id — exam is reached via the section.
    const { ctx, maps } = makeCtx({
      examPgIdBySectionPgId: new Map([["3", "7"]]), // section 3 → exam 7
    });
    const examId = new Types.ObjectId();
    maps.exam!.set("7", examId); // exam PG id 7 → its ObjectId
    const q = transformExamQuestion(
      { id: 1, section_id: 3, q_type: "MCQ_SINGLE", text: "x", option_1: "A", option_2: "B", correct_options: "1" },
      ctx,
    );
    expect(q.exam).toBe(examId); // derived via the section
  });

  it("prefers a direct exam_id when the source has one", () => {
    const { ctx, maps } = makeCtx();
    const examId = new Types.ObjectId();
    maps.exam!.set("9", examId);
    const q = transformExamQuestion(
      { id: 1, exam_id: 9, section_id: 3, q_type: "CODE", text: "x" },
      ctx,
    );
    expect(q.exam).toBe(examId);
  });
});

describe("FIX 2 — essay grading status maps GRADED", () => {
  it("maps GRADED → completed with no enum flag", () => {
    const { ctx, report } = makeCtx();
    const doc = transformEssayAttempt(
      { id: 1, user_id: 1, essay_topic_id: 1, attempt_number: 1, grading_status: "GRADED" },
      ctx,
    );
    expect(doc.gradingStatus).toBe("completed");
    expect(report.enumFlags.size).toBe(0);
  });
});

describe("FIX 3 — mismatched columns map to real targets (leave _migrated)", () => {
  it("enrollment.enrolled_at → createdAt (not stashed)", () => {
    const { ctx, report } = makeCtx();
    const enrolledAt = new Date("2021-05-06T07:08:09Z");
    const doc = transformEnrollment(
      { id: 1, user_id: 1, subject_id: 1, enrolled_at: enrolledAt },
      ctx,
    );
    expect(doc.createdAt).toEqual(enrolledAt);
    expect(doc._migrated).toBeUndefined();
    expect(report.preserved.get("enrollment")?.has("enrolled_at")).not.toBe(true);
  });

  it("job.company_name → company and job.apply_link → applyUrl (not blank, not stashed)", () => {
    const { ctx } = makeCtx();
    const doc = transformJob(
      {
        id: 1,
        title: "SWE Intern",
        company_name: "Acme Corp",
        apply_link: "https://acme.example/jobs/1",
        employment_type: "internship",
      },
      ctx,
    );
    expect(doc.company).toBe("Acme Corp");
    expect(doc.applyUrl).toBe("https://acme.example/jobs/1");
    expect(doc.employmentType).toBe("internship");
    const migrated = (doc._migrated ?? {}) as Record<string, unknown>;
    expect(migrated.company_name).toBeUndefined();
    expect(migrated.apply_link).toBeUndefined();
  });

  it("resetlog.note → reason, previous_attempt_count → previousCount; new_attempt_count preserved", () => {
    const { ctx } = makeCtx();
    const doc = transformResetLog(
      {
        id: 1,
        user_id: 1,
        exam_id: 1,
        reset_by_id: 2,
        note: "student appealed",
        previous_attempt_count: 3,
        new_attempt_count: 0,
      },
      ctx,
    );
    expect(doc.reason).toBe("student appealed");
    expect(doc.previousCount).toBe(3);
    // new_attempt_count has no rebuild home → preserved.
    expect((doc._migrated as Record<string, unknown>).new_attempt_count).toBe(0);
  });
});

describe("essaytopic.created_by_id — preserved as a resolvable ObjectId", () => {
  it("remaps created_by_id through the user map and stashes the ObjectId (not the raw int)", () => {
    const { ctx, maps } = makeCtx();
    const creatorId = new Types.ObjectId();
    maps.user!.set("55", creatorId);
    const doc = transformEssayTopic({ id: 1, title: "Remote work", created_by_id: 55 }, ctx);
    const migrated = doc._migrated as Record<string, unknown>;
    expect(migrated.created_by).toBe(creatorId); // remapped ObjectId
    expect(migrated.created_by_id).toBeUndefined(); // raw int not stashed
  });

  it("null created_by_id → nothing preserved (no flag)", () => {
    const { ctx, report } = makeCtx();
    const doc = transformEssayTopic({ id: 1, title: "T", created_by_id: null }, ctx);
    expect(doc._migrated).toBeUndefined();
    expect(report.unresolvedFks.size).toBe(0);
  });

  it("unresolved created_by_id → null + flagged (like any FK)", () => {
    const { ctx, report } = makeCtx();
    const doc = transformEssayTopic({ id: 1, title: "T", created_by_id: 999 }, ctx);
    expect((doc._migrated as Record<string, unknown>).created_by).toBeNull();
    expect(report.unresolvedFks.get("essaytopic.createdBy")?.count).toBe(1);
  });
});
