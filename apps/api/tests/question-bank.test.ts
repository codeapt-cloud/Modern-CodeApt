/**
 * Question bank (net-new) — global banks (super-admin CRUD + categorized
 * importer), per-college auto-populated Self Bank, browse/filter, grant gating,
 * tenant isolation, and pull-into-exam. Proves: a bank question's payload mirrors
 * ExamQuestion so a pull copies cleanly (MCQ + CODE with test cases); the
 * importer reuses the exam parsers (extended with metadata); filters return
 * correct subsets; a college bulk-upload ALSO populates its Self Bank (deduped,
 * isolated); a college without the `question_banks` grant can't browse/pull the
 * GLOBAL banks (403) but CAN use its own Self Bank; and cross-tenant self-bank
 * access is denied. The exam suites prove the exam importer/creation are
 * unchanged. supertest + in-memory Mongo, mirroring college-exams.test.ts.
 */
import { ExamQuestionType, Role, UserType } from "@codeapt/shared";
import type { Express } from "express";
import { Types } from "mongoose";
import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";

import { createApp } from "../src/app.js";
import { UserModel } from "../src/models/user.model.js";
import * as colleges from "../src/services/college.service.js";
import { buildMcqTemplateWorkbook } from "../src/lib/exam-excel.js";
import {
  buildBankCodingTemplateWorkbook,
  buildBankMcqTemplateWorkbook,
} from "../src/lib/question-bank-excel.js";

let app: Express;
beforeAll(() => {
  app = createApp();
});

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

let counter = 0;
async function makeUser(fields?: {
  role?: string;
  userType?: string;
  college?: Types.ObjectId | null;
}): Promise<{ token: string; userId: string }> {
  counter += 1;
  const u = `qb${counter}`;
  await request(app)
    .post("/api/auth/register")
    .send({
      username: u,
      email: `${u}@example.com`,
      password: "Password123",
      fullName: `QB User ${counter}`,
      rollNumber: `QBU-${counter}`,
      collegeName: "Acme",
      phoneNumber: "9999999999",
      state: "KA",
    });
  const res = await request(app)
    .post("/api/auth/login")
    .send({ identifier: u, password: "Password123" });
  const userId = res.body.user.id as string;
  // require-auth re-reads role from the DB, so overriding it here is enough.
  if (fields) await UserModel.updateOne({ _id: userId }, { $set: fields });
  return { token: res.body.accessToken as string, userId };
}

async function superToken(): Promise<string> {
  const s = await makeUser({ role: Role.SUPER_ADMIN });
  return s.token;
}

async function setupCollege(
  slug: string,
  features: Record<string, boolean> = { question_banks: true },
): Promise<{ collegeId: string; adminToken: string }> {
  const platform = await makeUser({ role: Role.SUPER_ADMIN });
  const collegeId = await colleges.createCollege({ name: slug, slug }, platform.userId);
  await colleges.setEntitlements(collegeId.id, { features });
  const admin = await makeUser({
    role: Role.COLLEGE_ADMIN,
    userType: UserType.COLLEGE,
    college: new Types.ObjectId(collegeId.id),
  });
  return { collegeId: collegeId.id, adminToken: admin.token };
}

const ADMIN_BANK = "/api/admin/question-banks";
const b64 = (buf: Buffer) => buf.toString("base64");

async function createGlobal(
  token: string,
  body: Record<string, unknown>,
): Promise<string> {
  const res = await request(app).post(ADMIN_BANK).set(auth(token)).send(body);
  expect(res.status).toBe(201);
  return res.body.id as string;
}

const MCQ = (over: Record<string, unknown> = {}) => ({
  category: "Aptitude",
  company: "General",
  difficulty: "easy",
  questionType: ExamQuestionType.MCQ_SINGLE,
  text: "2 + 2 = ?",
  options: ["3", "4", "5"],
  correctOptions: [1],
  ...over,
});
const CODE = (over: Record<string, unknown> = {}) => ({
  category: "Coding",
  company: "General",
  difficulty: "medium",
  questionType: ExamQuestionType.CODE,
  text: "Print sum of two ints",
  starterCode: "# code here",
  language: "python",
  testCases: [
    { input: "2 3", expectedOutput: "5", isHidden: false, order: 0 },
    { input: "10 20", expectedOutput: "30", isHidden: true, order: 1 },
  ],
  ...over,
});

// ---------------------------------------------------------------------------
// Global bank CRUD + importer (super-admin)
// ---------------------------------------------------------------------------

describe("global bank — CRUD + importer (super-admin)", () => {
  it("creates a global MCQ + CODE question with the mirrored ExamQuestion payload", async () => {
    const token = await superToken();
    const mcqId = await createGlobal(token, MCQ());
    const codeId = await createGlobal(token, CODE());

    const list = await request(app)
      .get(ADMIN_BANK)
      .set(auth(token))
      .query({ pageSize: 100 });
    expect(list.status).toBe(200);
    const byId = new Map<string, Record<string, unknown>>(
      list.body.items.map((q: { id: string }) => [q.id, q]),
    );

    const mcq = byId.get(mcqId)!;
    expect(mcq.scope).toBe("global");
    expect(mcq.college).toBeNull();
    expect(mcq.kind).toBe("standard");
    expect(mcq.questionType).toBe("MCQ_SINGLE");
    expect(mcq.options).toEqual(["3", "4", "5"]);
    expect(mcq.correctOptions).toEqual([1]);
    expect(mcq.testCases).toEqual([]);

    const code = byId.get(codeId)!;
    expect(code.kind).toBe("coding");
    expect(code.questionType).toBe("CODE");
    expect(code.options).toBeNull();
    expect(code.testCases).toEqual([
      { input: "2 3", expectedOutput: "5", isHidden: false, order: 0 },
      { input: "10 20", expectedOutput: "30", isHidden: true, order: 1 },
    ]);
  });

  it("rejects a non-super-admin (403)", async () => {
    const { adminToken } = await setupCollege("qb-crud-403");
    const res = await request(app).post(ADMIN_BANK).set(auth(adminToken)).send(MCQ());
    expect(res.status).toBe(403);
  });

  it("imports the categorized MCQ template into the global Standard bank", async () => {
    const token = await superToken();
    const file = b64(await buildBankMcqTemplateWorkbook());
    const res = await request(app)
      .post(`${ADMIN_BANK}/import`)
      .set(auth(token))
      .send({ fileBase64: file, kind: "mcq" });
    expect(res.status).toBe(200);
    expect(res.body.created).toBe(2); // the template has 2 worked MCQ rows
    expect(res.body.errors).toEqual([]);

    const list = await request(app)
      .get(ADMIN_BANK)
      .set(auth(token))
      .query({ kind: "standard", pageSize: 100 });
    const cats = list.body.items.map((q: { category: string }) => q.category);
    expect(cats).toContain("Aptitude");
    expect(cats).toContain("Data Structures");
    // Metadata carried from the sheet (company/difficulty).
    const ds = list.body.items.find(
      (q: { category: string }) => q.category === "Data Structures",
    );
    expect(ds.company).toBe("Acme");
    expect(ds.difficulty).toBe("medium");
    expect(ds.questionType).toBe("MCQ_MULTI"); // 2 correct answers
  });

  it("imports the categorized CODING template with inline test cases", async () => {
    const token = await superToken();
    const file = b64(await buildBankCodingTemplateWorkbook());
    const res = await request(app)
      .post(`${ADMIN_BANK}/import`)
      .set(auth(token))
      .send({ fileBase64: file, kind: "coding" });
    expect(res.status).toBe(200);
    expect(res.body.created).toBe(1);

    const list = await request(app)
      .get(ADMIN_BANK)
      .set(auth(token))
      .query({ kind: "coding", pageSize: 100 });
    const coding = list.body.items.find(
      (q: { text: string }) => q.text === "Read two integers and print their sum.",
    );
    expect(coding.kind).toBe("coding");
    expect(coding.testCases).toHaveLength(2);
    expect(coding.testCases[1].isHidden).toBe(true);
  });

  it("dedupes a re-imported global file (same type+text skipped)", async () => {
    const token = await superToken();
    const file = b64(await buildBankMcqTemplateWorkbook());
    const first = await request(app)
      .post(`${ADMIN_BANK}/import`)
      .set(auth(token))
      .send({ fileBase64: file, kind: "mcq" });
    expect(first.body.created).toBe(2);
    const second = await request(app)
      .post(`${ADMIN_BANK}/import`)
      .set(auth(token))
      .send({ fileBase64: file, kind: "mcq" });
    expect(second.body.created).toBe(0);
    expect(second.body.skipped).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

describe("browse filters (kind / category / company / difficulty / search)", () => {
  it("returns the correct subsets", async () => {
    const token = await superToken();
    await createGlobal(token, MCQ({ category: "Aptitude", company: "Acme", difficulty: "easy", text: "Q apt 1" }));
    await createGlobal(token, MCQ({ category: "Verbal", company: "Globex", difficulty: "hard", text: "Q verbal synonyms" }));
    await createGlobal(token, CODE({ category: "Coding", company: "Acme", difficulty: "hard", text: "Q code arrays" }));

    const only = async (q: Record<string, string | number>) => {
      const res = await request(app).get(ADMIN_BANK).set(auth(token)).query({ pageSize: 100, ...q });
      expect(res.status).toBe(200);
      return res.body.items as { category: string; company: string; difficulty: string; kind: string; text: string }[];
    };

    expect((await only({ kind: "coding" })).every((x) => x.kind === "coding")).toBe(true);
    expect((await only({ category: "Verbal" })).every((x) => x.category === "Verbal")).toBe(true);
    expect((await only({ company: "Globex" })).every((x) => x.company === "Globex")).toBe(true);
    const hard = await only({ difficulty: "hard" });
    expect(hard.length).toBeGreaterThanOrEqual(2);
    expect(hard.every((x) => x.difficulty === "hard")).toBe(true);
    const search = await only({ q: "synonyms" });
    expect(search.every((x) => x.text.includes("synonyms"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Self-bank auto-populate (tenant-scoped) + isolation
// ---------------------------------------------------------------------------

describe("self-bank auto-populate", () => {
  async function makeExamWithSection(slug: string, token: string) {
    const exam = await request(app)
      .post(`/api/c/${slug}/exams`)
      .set(auth(token))
      .send({ title: "Bank Src", orgUnitIds: [] });
    expect(exam.status).toBe(201);
    const withSection = await request(app)
      .post(`/api/c/${slug}/exams/${exam.body.id}/sections`)
      .set(auth(token))
      .send({ name: "Aptitude", durationMinutes: 30 });
    expect(withSection.status).toBe(201);
    return {
      examId: exam.body.id as string,
      sectionId: withSection.body.sections[0].id as string,
    };
  }

  it("a college exam bulk-upload ALSO populates its Self Bank (deduped, isolated)", async () => {
    const a = await setupCollege("qb-self-a", { exams: true, question_banks: true });
    const b = await setupCollege("qb-self-b", { exams: true, question_banks: true });
    const { examId } = await makeExamWithSection("qb-self-a", a.adminToken);
    const file = b64(await buildMcqTemplateWorkbook()); // exam MCQ template: 2 MCQs, section "Aptitude"

    const up = await request(app)
      .post(`/api/c/qb-self-a/exams/${examId}/bulk-upload`)
      .set(auth(a.adminToken))
      .send({ fileBase64: file, kind: "mcq" });
    expect(up.status).toBe(200);
    expect(up.body.createdQuestions).toBe(2);

    // Self bank now has those 2 questions (category = the section name).
    const selfA = await request(app)
      .get("/api/c/qb-self-a/question-banks")
      .set(auth(a.adminToken))
      .query({ scope: "college", pageSize: 100 });
    expect(selfA.status).toBe(200);
    expect(selfA.body.items).toHaveLength(2);
    expect(selfA.body.items.every((q: { scope: string; category: string }) => q.scope === "college" && q.category === "Aptitude")).toBe(true);

    // Re-upload the same file → self bank stays 2 (deduped).
    await request(app)
      .post(`/api/c/qb-self-a/exams/${examId}/bulk-upload`)
      .set(auth(a.adminToken))
      .send({ fileBase64: file, kind: "mcq" });
    const selfA2 = await request(app)
      .get("/api/c/qb-self-a/question-banks")
      .set(auth(a.adminToken))
      .query({ scope: "college", pageSize: 100 });
    expect(selfA2.body.items).toHaveLength(2);

    // College B's self bank is empty — tenant isolation.
    const selfB = await request(app)
      .get("/api/c/qb-self-b/question-banks")
      .set(auth(b.adminToken))
      .query({ scope: "college", pageSize: 100 });
    expect(selfB.body.items).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Grant gating + isolation
// ---------------------------------------------------------------------------

describe("grant gating + isolation", () => {
  it("a college WITHOUT the grant can't browse GLOBAL but CAN browse its own Self Bank", async () => {
    const token = await superToken();
    await createGlobal(token, MCQ({ text: "global-only-q" }));
    // No question_banks grant (exams on so it can author/self-populate).
    const ungranted = await setupCollege("qb-nogrant", { exams: true });

    const global = await request(app)
      .get("/api/c/qb-nogrant/question-banks")
      .set(auth(ungranted.adminToken))
      .query({ scope: "global" });
    expect(global.status).toBe(403);
    expect(global.body.error.code).toBe("FEATURE_NOT_ENABLED");

    const self = await request(app)
      .get("/api/c/qb-nogrant/question-banks")
      .set(auth(ungranted.adminToken))
      .query({ scope: "college" });
    expect(self.status).toBe(200); // own data always available

    // scope=all without the grant → only self bank, no global leak, no error.
    const all = await request(app)
      .get("/api/c/qb-nogrant/question-banks")
      .set(auth(ungranted.adminToken))
      .query({ scope: "all", pageSize: 100 });
    expect(all.status).toBe(200);
    expect(all.body.items.every((q: { scope: string }) => q.scope === "college")).toBe(true);
  });

  it("a granted college sees the global banks", async () => {
    const token = await superToken();
    await createGlobal(token, MCQ({ text: "granted-global-q" }));
    const granted = await setupCollege("qb-grant", { question_banks: true });
    const res = await request(app)
      .get("/api/c/qb-grant/question-banks")
      .set(auth(granted.adminToken))
      .query({ scope: "global", pageSize: 100 });
    expect(res.status).toBe(200);
    expect(res.body.items.some((q: { text: string }) => q.text === "granted-global-q")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Pull into exam
// ---------------------------------------------------------------------------

describe("pull into exam (clean copy, reusing exam creation)", () => {
  async function makeExamWithSection(slug: string, token: string) {
    const exam = await request(app)
      .post(`/api/c/${slug}/exams`)
      .set(auth(token))
      .send({ title: "Pull Target", orgUnitIds: [] });
    expect(exam.status).toBe(201);
    const withSection = await request(app)
      .post(`/api/c/${slug}/exams/${exam.body.id}/sections`)
      .set(auth(token))
      .send({ name: "Section 1", durationMinutes: 30 });
    expect(withSection.status).toBe(201);
    return {
      examId: exam.body.id as string,
      sectionId: withSection.body.sections[0].id as string,
    };
  }

  it("copies MCQ + CODE (with test cases) from a granted global bank into the exam", async () => {
    const token = await superToken();
    const mcqId = await createGlobal(token, MCQ({ text: "pull-mcq" }));
    const codeId = await createGlobal(token, CODE({ text: "pull-code" }));
    const c = await setupCollege("qb-pull", { exams: true, question_banks: true });
    const { examId, sectionId } = await makeExamWithSection("qb-pull", c.adminToken);

    const pull = await request(app)
      .post("/api/c/qb-pull/question-banks/pull-into-exam")
      .set(auth(c.adminToken))
      .send({ examId, sectionId, questionIds: [mcqId, codeId] });
    expect(pull.status).toBe(200);
    expect(pull.body.pulled).toBe(2);
    expect(pull.body.skipped).toBe(0);

    // The exam now holds the two copied questions (CODE keeps its test cases).
    const detail = await request(app)
      .get(`/api/c/qb-pull/exams/${examId}`)
      .set(auth(c.adminToken));
    expect(detail.status).toBe(200);
    const qs = detail.body.sections.find((s: { id: string }) => s.id === sectionId).questions;
    expect(qs).toHaveLength(2);
    const code = qs.find((q: { type: string }) => q.type === "CODE");
    expect(code.testCases).toHaveLength(2);
    const mcq = qs.find((q: { type: string }) => q.type === "MCQ_SINGLE");
    expect(mcq.options).toEqual(["3", "4", "5"]);
  });

  it("denies pulling a GLOBAL question without the grant (403)", async () => {
    const token = await superToken();
    const gid = await createGlobal(token, MCQ({ text: "nopull-global" }));
    const c = await setupCollege("qb-pull-nogrant", { exams: true }); // no grant
    const { examId, sectionId } = await makeExamWithSection("qb-pull-nogrant", c.adminToken);

    const pull = await request(app)
      .post("/api/c/qb-pull-nogrant/question-banks/pull-into-exam")
      .set(auth(c.adminToken))
      .send({ examId, sectionId, questionIds: [gid] });
    expect(pull.status).toBe(403);
    expect(pull.body.error.code).toBe("FEATURE_NOT_ENABLED");
  });

  it("skips another college's self-bank question (cannot pull cross-tenant)", async () => {
    // College A auto-populates a self-bank question via an exam upload.
    const a = await setupCollege("qb-x-a", { exams: true, question_banks: true });
    const aExam = await request(app)
      .post("/api/c/qb-x-a/exams")
      .set(auth(a.adminToken))
      .send({ title: "A src", orgUnitIds: [] });
    const aSec = await request(app)
      .post(`/api/c/qb-x-a/exams/${aExam.body.id}/sections`)
      .set(auth(a.adminToken))
      .send({ name: "Aptitude", durationMinutes: 30 });
    void aSec;
    await request(app)
      .post(`/api/c/qb-x-a/exams/${aExam.body.id}/bulk-upload`)
      .set(auth(a.adminToken))
      .send({ fileBase64: b64(await buildMcqTemplateWorkbook()), kind: "mcq" });
    const aSelf = await request(app)
      .get("/api/c/qb-x-a/question-banks")
      .set(auth(a.adminToken))
      .query({ scope: "college", pageSize: 100 });
    const aQuestionId = aSelf.body.items[0].id as string;

    // College B tries to pull A's self-bank question into B's exam → skipped.
    const b = await setupCollege("qb-x-b", { exams: true, question_banks: true });
    const bExam = await request(app)
      .post("/api/c/qb-x-b/exams")
      .set(auth(b.adminToken))
      .send({ title: "B target", orgUnitIds: [] });
    const bSec = await request(app)
      .post(`/api/c/qb-x-b/exams/${bExam.body.id}/sections`)
      .set(auth(b.adminToken))
      .send({ name: "S", durationMinutes: 30 });
    const pull = await request(app)
      .post("/api/c/qb-x-b/question-banks/pull-into-exam")
      .set(auth(b.adminToken))
      .send({
        examId: bExam.body.id,
        sectionId: bSec.body.sections[0].id,
        questionIds: [aQuestionId],
      });
    expect(pull.status).toBe(200);
    expect(pull.body.pulled).toBe(0);
    expect(pull.body.skipped).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Filter facets — DISTINCT values across the WHOLE bank (not the page), scoped
// ---------------------------------------------------------------------------

describe("filter facets (bank-wide distinct values, scope-respecting)", () => {
  async function selfBankExam(slug: string, token: string) {
    const exam = await request(app)
      .post(`/api/c/${slug}/exams`)
      .set(auth(token))
      .send({ title: "Facet Src", orgUnitIds: [] });
    await request(app)
      .post(`/api/c/${slug}/exams/${exam.body.id}/sections`)
      .set(auth(token))
      .send({ name: "Aptitude", durationMinutes: 30 });
    await request(app)
      .post(`/api/c/${slug}/exams/${exam.body.id}/bulk-upload`)
      .set(auth(token))
      .send({ fileBase64: b64(await buildMcqTemplateWorkbook()), kind: "mcq" });
  }

  it("returns distinct category/company/subCategory/tag values across ALL pages", async () => {
    const token = await superToken();
    await createGlobal(
      token,
      MCQ({ category: "FacAlpha", company: "FacAcme", subCategory: "FS1", tags: ["ftag1"], text: "facet q1" }),
    );
    await createGlobal(
      token,
      MCQ({ category: "FacBeta", company: "FacGlobex", subCategory: "FS2", tags: ["ftag2", "ftag3"], text: "facet q2" }),
    );
    await createGlobal(
      token,
      CODE({ category: "FacGamma", company: "FacInitech", subCategory: "FS3", tags: ["ftag4"], text: "facet q3" }),
    );

    // A single-row PAGE, yet the facets span every value in the bank.
    const res = await request(app).get(ADMIN_BANK).set(auth(token)).query({ pageSize: 1 });
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    const f = res.body.facets as {
      categories: string[];
      companies: string[];
      subCategories: string[];
      tags: string[];
      difficulties: string[];
      kinds: string[];
    };
    expect(f.categories).toEqual(expect.arrayContaining(["FacAlpha", "FacBeta", "FacGamma"]));
    expect(f.companies).toEqual(expect.arrayContaining(["FacAcme", "FacGlobex", "FacInitech"]));
    expect(f.subCategories).toEqual(expect.arrayContaining(["FS1", "FS2", "FS3"]));
    expect(f.tags).toEqual(expect.arrayContaining(["ftag1", "ftag2", "ftag3", "ftag4"]));
    expect(f.difficulties.length).toBeGreaterThan(0);
    expect(f.kinds).toEqual(expect.arrayContaining(["standard", "coding"]));
    // Facets never carry empty strings (blank subCategory/company).
    expect(f.subCategories).not.toContain("");
  });

  it("college facets respect scope/grant — no leak of banks you can't browse", async () => {
    const token = await superToken();
    await createGlobal(token, MCQ({ category: "GlobalOnlyCat", company: "GCo", text: "global-only-facet" }));
    const c = await setupCollege("qb-facet-scope", { exams: true, question_banks: true });
    await selfBankExam("qb-facet-scope", c.adminToken);

    // scope=college → only the college's own self-bank values.
    const selfF = await request(app)
      .get("/api/c/qb-facet-scope/question-banks")
      .set(auth(c.adminToken))
      .query({ scope: "college" });
    expect(selfF.status).toBe(200);
    expect(selfF.body.facets.categories).toContain("Aptitude");
    expect(selfF.body.facets.categories).not.toContain("GlobalOnlyCat");

    // scope=global (granted) → the global values.
    const globalF = await request(app)
      .get("/api/c/qb-facet-scope/question-banks")
      .set(auth(c.adminToken))
      .query({ scope: "global" });
    expect(globalF.body.facets.categories).toContain("GlobalOnlyCat");
  });

  it("an ungranted college's scope=all facets never include global values", async () => {
    const token = await superToken();
    await createGlobal(token, MCQ({ category: "SecretGlobalCat", text: "secret-facet" }));
    const c = await setupCollege("qb-facet-nogrant", { exams: true }); // no question_banks
    await selfBankExam("qb-facet-nogrant", c.adminToken);

    const all = await request(app)
      .get("/api/c/qb-facet-nogrant/question-banks")
      .set(auth(c.adminToken))
      .query({ scope: "all" });
    expect(all.status).toBe(200);
    expect(all.body.facets.categories).toContain("Aptitude");
    expect(all.body.facets.categories).not.toContain("SecretGlobalCat");
  });

  it("cascades: sub-category + tag facets scope to the selected category, parents stay full", async () => {
    const token = await superToken();
    await createGlobal(token, MCQ({ category: "CascA", subCategory: "CascA1", tags: ["cta1"], company: "CascCoA", text: "casc-a1" }));
    await createGlobal(token, MCQ({ category: "CascA", subCategory: "CascA2", tags: ["cta2"], company: "CascCoA", text: "casc-a2" }));
    await createGlobal(token, MCQ({ category: "CascB", subCategory: "CascB1", tags: ["ctb1"], company: "CascCoB", text: "casc-b1" }));

    // Pick category CascA → child facets narrow to CascA only…
    const inA = await request(app).get(ADMIN_BANK).set(auth(token)).query({ category: "CascA" });
    expect(inA.status).toBe(200);
    const fA = inA.body.facets as {
      categories: string[];
      companies: string[];
      subCategories: string[];
      tags: string[];
    };
    expect(fA.subCategories).toEqual(expect.arrayContaining(["CascA1", "CascA2"]));
    expect(fA.subCategories).not.toContain("CascB1");
    expect(fA.tags).toEqual(expect.arrayContaining(["cta1", "cta2"]));
    expect(fA.tags).not.toContain("ctb1");
    // …while PARENT facets (category, company) stay complete so you can switch.
    expect(fA.categories).toEqual(expect.arrayContaining(["CascA", "CascB"]));
    expect(fA.companies).toEqual(expect.arrayContaining(["CascCoA", "CascCoB"]));

    // Narrow further by sub-category → tags scope to that sub-topic only.
    const inA1 = await request(app)
      .get(ADMIN_BANK)
      .set(auth(token))
      .query({ category: "CascA", subCategory: "CascA1" });
    expect(inA1.body.facets.tags).toEqual(expect.arrayContaining(["cta1"]));
    expect(inA1.body.facets.tags).not.toContain("cta2");
    expect(inA1.body.facets.tags).not.toContain("ctb1");
  });

  it("filters results by subCategory and tag", async () => {
    const token = await superToken();
    await createGlobal(token, MCQ({ subCategory: "FiltArrays", tags: ["fdp", "fgreedy"], text: "filt-arrays-q" }));
    await createGlobal(token, MCQ({ subCategory: "FiltTrees", tags: ["fdp"], text: "filt-trees-q" }));

    const bySub = await request(app)
      .get(ADMIN_BANK)
      .set(auth(token))
      .query({ subCategory: "FiltArrays", pageSize: 100 });
    expect(bySub.status).toBe(200);
    expect(bySub.body.items.every((x: { subCategory: string }) => x.subCategory === "FiltArrays")).toBe(true);
    expect(bySub.body.items.some((x: { text: string }) => x.text === "filt-arrays-q")).toBe(true);

    const byTag = await request(app)
      .get(ADMIN_BANK)
      .set(auth(token))
      .query({ tag: "fgreedy", pageSize: 100 });
    expect(byTag.status).toBe(200);
    expect(byTag.body.items.every((x: { tags: string[] }) => x.tags.includes("fgreedy"))).toBe(true);
    expect(byTag.body.items.some((x: { text: string }) => x.text === "filt-arrays-q")).toBe(true);
  });
});
