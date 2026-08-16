/**
 * The authoring-mutation surface shared by the platform-admin and college exam
 * editors. The reused editor components (SectionEditorDialog, QuestionEditorDialog,
 * TestCaseEditor, BulkUploadDialog, PublicLinksDialog, ExamSectionCard) call
 * ONLY these methods — never a concrete api group — so the SAME components drive
 * both surfaces by swapping the injected `authApi`:
 *   - platform admin → `api.adminExams` (satisfies this shape as-is; the default)
 *   - college        → `collegeExamAuthoringApi(slug)` (binds the tenant slug)
 *
 * The signatures are IDENTICAL to `api.adminExams`'s authoring subset, so passing
 * `api.adminExams` requires no adapter and the admin editor is behaviourally
 * unchanged. The college engine returns the same DTOs (it delegates to the same
 * exam-admin service), so nothing here special-cases the tenant.
 */
import type {
  AdminExamDetail,
  AdminPublicLinkUpsert,
  AdminQuestionUpsert,
  AdminSectionUpsert,
  AdminTestCaseUpsert,
  ExamBulkUploadKind,
  ExcelUploadResponse,
  PublicLink,
} from "@codeapt/shared";

import { api } from "./api-client.js";

/** The exam-authoring mutations the reused editor components depend on. */
export interface ExamAuthoringApi {
  createSection(examId: string, body: AdminSectionUpsert): Promise<AdminExamDetail>;
  updateSection(
    sectionId: string,
    body: AdminSectionUpsert,
  ): Promise<AdminExamDetail>;
  deleteSection(sectionId: string): Promise<void>;
  createQuestion(body: AdminQuestionUpsert): Promise<{ id: string }>;
  updateQuestion(
    questionId: string,
    body: AdminQuestionUpsert,
  ): Promise<{ id: string }>;
  deleteQuestion(questionId: string): Promise<void>;
  addTestCase(
    questionId: string,
    body: AdminTestCaseUpsert,
  ): Promise<{ id: string }>;
  updateTestCase(
    testCaseId: string,
    body: AdminTestCaseUpsert,
  ): Promise<{ id: string }>;
  deleteTestCase(testCaseId: string): Promise<void>;
  bulkUpload(
    examId: string,
    fileBase64: string,
    kind: ExamBulkUploadKind,
  ): Promise<ExcelUploadResponse>;
  /** Download the ready-to-fill MCQ or coding .xlsx template. */
  bulkUploadTemplate(
    kind: ExamBulkUploadKind,
  ): Promise<{ blob: Blob; filename: string }>;
  createPublicLink(
    examId: string,
    body: AdminPublicLinkUpsert,
  ): Promise<PublicLink>;
  updatePublicLink(
    linkId: string,
    body: AdminPublicLinkUpsert,
  ): Promise<PublicLink>;
  deletePublicLink(linkId: string): Promise<void>;
  /** Download results for ONE public link (its anonymous takers only). */
  exportPublicLinkResults(
    linkId: string,
  ): Promise<{ blob: Blob; filename: string }>;
}

/**
 * The subset of `api.collegeExams` this adapter binds a slug onto. Declared as a
 * minimal interface (not `typeof api.collegeExams`) so the adapter is pure and
 * unit-testable with a fake group — no axios/network involved.
 */
export interface CollegeExamAuthoringGroup {
  createSection(
    slug: string,
    examId: string,
    body: AdminSectionUpsert,
  ): Promise<AdminExamDetail>;
  updateSection(
    slug: string,
    sectionId: string,
    body: AdminSectionUpsert,
  ): Promise<AdminExamDetail>;
  deleteSection(slug: string, sectionId: string): Promise<void>;
  createQuestion(
    slug: string,
    body: AdminQuestionUpsert,
  ): Promise<{ id: string }>;
  updateQuestion(
    slug: string,
    questionId: string,
    body: AdminQuestionUpsert,
  ): Promise<{ id: string }>;
  deleteQuestion(slug: string, questionId: string): Promise<void>;
  addTestCase(
    slug: string,
    questionId: string,
    body: AdminTestCaseUpsert,
  ): Promise<{ id: string }>;
  updateTestCase(
    slug: string,
    testCaseId: string,
    body: AdminTestCaseUpsert,
  ): Promise<{ id: string }>;
  deleteTestCase(slug: string, testCaseId: string): Promise<void>;
  bulkUpload(
    slug: string,
    examId: string,
    fileBase64: string,
    kind: ExamBulkUploadKind,
  ): Promise<ExcelUploadResponse>;
  bulkUploadTemplate(
    slug: string,
    kind: ExamBulkUploadKind,
  ): Promise<{ blob: Blob; filename: string }>;
  createPublicLink(
    slug: string,
    examId: string,
    body: AdminPublicLinkUpsert,
  ): Promise<PublicLink>;
  updatePublicLink(
    slug: string,
    linkId: string,
    body: AdminPublicLinkUpsert,
  ): Promise<PublicLink>;
  deletePublicLink(slug: string, linkId: string): Promise<void>;
  exportPublicLinkResults(
    slug: string,
    linkId: string,
  ): Promise<{ blob: Blob; filename: string }>;
}

/**
 * Bind a tenant `slug` onto the college exam group so it satisfies the
 * slug-free `ExamAuthoringApi` the reused editor components expect. `group`
 * defaults to `api.collegeExams`; inject a fake in tests.
 */
export function collegeExamAuthoringApi(
  slug: string,
  group: CollegeExamAuthoringGroup = api.collegeExams,
): ExamAuthoringApi {
  return {
    createSection: (examId, body) => group.createSection(slug, examId, body),
    updateSection: (sectionId, body) =>
      group.updateSection(slug, sectionId, body),
    deleteSection: (sectionId) => group.deleteSection(slug, sectionId),
    createQuestion: (body) => group.createQuestion(slug, body),
    updateQuestion: (questionId, body) =>
      group.updateQuestion(slug, questionId, body),
    deleteQuestion: (questionId) => group.deleteQuestion(slug, questionId),
    addTestCase: (questionId, body) =>
      group.addTestCase(slug, questionId, body),
    updateTestCase: (testCaseId, body) =>
      group.updateTestCase(slug, testCaseId, body),
    deleteTestCase: (testCaseId) => group.deleteTestCase(slug, testCaseId),
    bulkUpload: (examId, fileBase64, kind) =>
      group.bulkUpload(slug, examId, fileBase64, kind),
    bulkUploadTemplate: (kind) => group.bulkUploadTemplate(slug, kind),
    createPublicLink: (examId, body) =>
      group.createPublicLink(slug, examId, body),
    updatePublicLink: (linkId, body) =>
      group.updatePublicLink(slug, linkId, body),
    deletePublicLink: (linkId) => group.deletePublicLink(slug, linkId),
    exportPublicLinkResults: (linkId) =>
      group.exportPublicLinkResults(slug, linkId),
  };
}
