/**
 * Typed API client — axios wrapper for the CodeApt REST API.
 *
 * Browser auth rides on httpOnly cookies (withCredentials), so we don't store
 * tokens in JS. A response interceptor transparently refreshes once on 401 and
 * retries; a 403 FORCE_PASSWORD_CHANGE is surfaced to the app via a handler so
 * the router can gate access. In dev, VITE_API_URL is empty and requests hit
 * `/api/*` same-origin (Vite proxies to the API).
 */
import {
  API_PREFIX,
  AuthErrorCode,
  type AdminApplicationListResponse,
  type AdminCoupon,
  type AdminCouponListResponse,
  type AdminCouponUpsert,
  type AdminChallenge,
  type AdminChallengeBulkImportResponse,
  type AdminChallengeListResponse,
  type AdminChallengeUpsert,
  type AiBuildChallengeResponse,
  type AiCreditBalance,
  type SetCollegeCreditsInput,
  type AttendanceGroup,
  type AttendanceGroupListResponse,
  type AttendanceImportPreviewResponse,
  type AttendanceSettings,
  type AddAttendanceMembersInput,
  type CreateAttendanceGroupInput,
  type SetAttendanceSettingsInput,
  type UpdateAttendanceGroupInput,
  type AttendanceSession,
  type AttendanceSessionListResponse,
  type AttendanceRosterResponse,
  type CreateAttendanceSessionInput,
  type SaveAttendanceInput,
  type UpdateAttendanceSessionInput,
  type AttendanceAnalyticsResponse,
  type CodingProfileResponse,
  type SetCodingHandlesInput,
  type CodingLeaderboardResponse,
  type CodingPlatform,
  type CodingMetric,
  type AiCreditDistributionResponse,
  type AllocateStudentCreditsInput,
  type StudentOwnAiCredit,
  type DailyQuestionType,
  type RegenerateDailyChallengeResponse,
  type AdminEssayAnalyticsListQuery,
  type AdminEssayAnalyticsListResponse,
  type AdminEssayAttemptAnalytics,
  type AdminOrderDetail,
  type AdminOrderListQuery,
  type AdminOrderListResponse,
  type AiGenerateExamRequest,
  type AiGenerateExamResponse,
  type AiGenerateQuestionsRequest,
  type AiGenerateQuestionsResponse,
  type AiGovernorView,
  type SetAiGovernorConfigInput,
  type AiProviderAdmin,
  type AiProviderPatch,
  type AiProvidersListResponse,
  type KeyStatusResponse,
  type TestProviderKeyResponse,
  type UsageTrendsResponse,
  type BankBrowseQuery,
  type BankImportResponse,
  type BankListResponse,
  type BankPullIntoExamRequest,
  type BankPullIntoExamResponse,
  type BankQuestion,
  type BankQuestionUpsert,
  type College,
  type CollegeBranding,
  type CollegeAdmin,
  type CollegeAdminListResponse,
  type CollegeContextResponse,
  type CollegeCourseListResponse,
  type CollegeExamListResponse,
  type CollegeExamResultsResponse,
  type ExamAnalysisResponse,
  type CreateCollegeExamInput,
  type UpdateCollegeExamInput,
  type CollegeEssayListResponse,
  type CollegeEssayResultsResponse,
  type CreateCollegeEssayInput,
  type CollegeChallengeLeaderboardResponse,
  type CollegeAnalyticsOverview,
  type CollegeAnalyticsByUnitResponse,
  type CollegeAnalyticsStudent,
  type CollegePostingListResponse,
  type CollegePostingSummary,
  type CollegeStudentPostingListResponse,
  type CreateCollegePostingInput,
  type CollegeSummaryResponse,
  type CollegeListResponse,
  type CreateCollegeAdminInput,
  type CollegeStudent,
  type CollegeStudentListQuery,
  type CollegeStudentListResponse,
  type CollegeStudentSummaryResponse,
  type StudentAttendanceResponse,
  type CourseAssignResponse,
  type CourseAssignedStudentsResponse,
  type CourseRevokeResponse,
  type CreateCollegeInput,
  type CreateCollegeStudentInput,
  type CreateFacultyInput,
  type CreateOrgUnitInput,
  type BulkCreateOrgUnitsInput,
  type BulkCreateOrgUnitsResponse,
  type Faculty,
  type FacultyListResponse,
  type GrantCoursesInput,
  type MyCollegeResponse,
  type OrgUnit,
  type OrgUnitTreeResponse,
  type SetEntitlementsInput,
  type StudentImportCommitResponse,
  type StudentImportPreviewResponse,
  type StudentImportRowInput,
  type UpdateCollegeInput,
  type UpdateCollegeStudentInput,
  type UpdateFacultyInput,
  type UpdateOrgUnitInput,
  type UploadSignatureResponse,
  type AdminExamAttemptCountersResponse,
  type AdminExamResetLogResponse,
  type AdminUserExamAttemptsResponse,
  type AdminUpdateProfile,
  type AdminUserDetail,
  type AdminUserListQuery,
  type AdminUserListResponse,
  type Role,
  type AdminEssayTopic,
  type AdminEssayTopicListResponse,
  type AdminEssayTopicUpsert,
  type GenerateKeywordsRequest,
  type GenerateKeywordsResponse,
  type AdminExamDetail,
  type AdminExamListResponse,
  type AdminExamUpsert,
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
  type AdminEnrollmentAddResponse,
  type AdminEnrollmentCollegesResponse,
  type AdminEnrollmentListResponse,
  type AdminEnrollmentRemoveResponse,
  type AdminSubject,
  type AdminSubjectListResponse,
  type AdminSubjectUpsert,
  type RecomputeExpiryResponse,
  type AdminTopic,
  type BulkEnrollResponse,
  type AdminTopicListResponse,
  type AdminTopicUpsert,
  type TopicExcelUploadResponse,
  type AdminPosting,
  type AdminPostingListResponse,
  type AdminPostingUpsert,
  type AdminPublicLinkUpsert,
  type AdminQuestionUpsert,
  type AdminResetAttemptsRequest,
  type AdminSectionUpsert,
  type AdminTestCaseUpsert,
  type ExamBulkUploadKind,
  type ExcelUploadResponse,
  type PublicLink,
  type ApplicationResponse,
  type ApplyRequest,
  type AuthResponse,
  type CatalogQuery,
  type CatalogResponse,
  type ChallengeTodayResponse,
  type ChangePasswordInput,
  type AnswerInput,
  type AttemptSectionView,
  type CreateOrderRequest,
  type CreateOrderResponse,
  type JobApplicationStatus,
  type MyApplicationsResponse,
  type PostingDetail,
  type PostingListQuery,
  type PostingListResponse,
  type EnrollResponse,
  type EssayAnalyticsInput,
  type EssayDraftResponse,
  type EssayAiFeedbackResponse,
  type EssayGradingResult,
  type EssayIntegrity,
  type EssayListResponse,
  type EssayPromptDetail,
  type EssaySubmissionListResponse,
  type SaveEssayDraftResponse,
  type ExamListResponse,
  type ExamResult,
  type AdvanceGameResponse,
  type AiBuildGameSetRequest,
  type AiBuildGameSetResponse,
  type AnswerGameItemResponse,
  type BeginGameResponse,
  type GameAttemptAdminList,
  type GameAttemptHistoryResponse,
  type GameCohortReport,
  type GameExplanationResponse,
  type GamePlayListResponse,
  type GameResult,
  type GameSetDetail,
  type GameSetListResponse,
  type GameSetUpdate,
  type GameSetUpsert,
  type ProbeGameItemResponse,
  type RecordGameWarningResponse,
  type StartGameSetResponse,
  type SpeakingPlayListResponse,
  type StartSpeakingResponse,
  type SpeakingCurrentResponse,
  type SubmitSpeakingItemResponse,
  type SpeakingAttemptResult,
  type SpeakingAttemptAdminList,
  type SpeakingAssessmentListResponse,
  type SpeakingAssessmentDetail,
  type SpeakingAssessmentUpsert,
  type SpeakingTtsResponse,
  type CommunicationAvailableListResponse,
  type CommunicationStudentView,
  type CommunicationLaunchResponse,
  type CommunicationAssessmentListResponse,
  type CommunicationAssessmentDetail,
  type CommunicationAssessmentUpsert,
  type CommunicationCohortReport,
  type MockPayRequest,
  type OrderListResponse,
  type OrderStatusResponse,
  type QuoteRequest,
  type QuoteResponse,
  type ExecuteRequest,
  type ExecuteStatusResponse,
  type FinalizeChallengeResponse,
  type HealthResponse,
  type JobRef,
  type LeaderboardQuery,
  type LeaderboardResponse,
  type LoginInput,
  type PublicExamAvailability,
  type PublicStartRequest,
  type RecordWarningResponse,
  type RecordStimulusPlayResponse,
  type SaveSectionAnswersResponse,
  type StartAttemptResponse,
  type MeResponse,
  type MyEnrollmentsResponse,
  type Quiz,
  type QuizResult,
  type QuizSubmitRequest,
  type RegisterInput,
  type RegisterResponse,
  type SubmitCodeRequest,
  type SubmitMcqResponse,
  type SubjectDetail,
  type TopicCompleteResponse,
  type TopicContent,
  type UpdateMeInput,
} from "@codeapt/shared";
import axios, {
  AxiosError,
  type AxiosInstance,
  type InternalAxiosRequestConfig,
} from "axios";

import { apiUrl } from "./url.js";

// Trim any trailing slash so manual joins (e.g. the SSE stream URL below) don't
// produce a double slash like `http://host//api/...` when VITE_API_URL is set
// with a trailing "/". Axios already normalizes its own base+path join, so this
// is a no-op for axios requests and a correctness fix for hand-built URLs.
const baseURL = (import.meta.env.VITE_API_URL ?? "").replace(/\/+$/, "");

export const http: AxiosInstance = axios.create({
  baseURL,
  withCredentials: true,
  headers: { "Content-Type": "application/json" },
});

// --- Structured API error helper -------------------------------------------

export interface ApiErrorShape {
  message: string;
  code?: string;
  /** Field-level validation errors, when the server provides them. */
  fields?: Record<string, string>;
  /** Raw `error.details` payload (e.g. delete-blocker counts), when present. */
  details?: unknown;
  status?: number;
}

export function parseApiError(err: unknown): ApiErrorShape {
  if (err instanceof AxiosError && err.response) {
    const data = err.response.data as
      | { error?: { message?: string; code?: string; details?: unknown } }
      | undefined;
    const detail = data?.error;
    let message = detail?.message ?? "Something went wrong";
    let fields =
      detail?.details &&
      typeof detail.details === "object" &&
      "fields" in detail.details
        ? ((detail.details as { fields?: Record<string, string> }).fields ??
          undefined)
        : undefined;

    // A Zod validation error serializes its `issues` array into `details`. Turn
    // those into per-field messages and a specific top-level message, so forms
    // show the actual reason (e.g. "Password must contain an uppercase letter")
    // instead of the generic "Request validation failed".
    if (!fields && Array.isArray(detail?.details)) {
      const issues = detail.details as Array<{
        path?: (string | number)[];
        message?: string;
      }>;
      const derived: Record<string, string> = {};
      for (const issue of issues) {
        if (!issue?.message) continue;
        const key =
          Array.isArray(issue.path) && issue.path.length > 0
            ? issue.path.join(".")
            : "_";
        derived[key] ??= issue.message;
      }
      if (Object.keys(derived).length > 0) {
        fields = derived;
        const first = issues.find((i) => i?.message)?.message;
        if (first && message === "Request validation failed") message = first;
      }
    }

    return {
      message,
      code: detail?.code,
      fields,
      details: detail?.details,
      status: err.response.status,
    };
  }
  return { message: "Network error — please try again" };
}

// --- Auth event handlers (registered by AuthProvider) ----------------------

interface AuthEventHandlers {
  onSessionExpired?: () => void;
  onForcePasswordChange?: () => void;
}
let handlers: AuthEventHandlers = {};
export function setAuthEventHandlers(next: AuthEventHandlers): void {
  handlers = next;
}

// --- Refresh interceptor (single-flight) -----------------------------------

const AUTH_PATHS = [
  "/auth/login",
  "/auth/register",
  "/auth/refresh",
  "/auth/logout",
];
type RetryConfig = InternalAxiosRequestConfig & { _retried?: boolean };

let refreshPromise: Promise<void> | null = null;

async function runRefresh(): Promise<void> {
  refreshPromise ??= http
    .post(`${API_PREFIX}/auth/refresh`)
    .then(() => undefined)
    .finally(() => {
      refreshPromise = null;
    });
  return refreshPromise;
}

http.interceptors.response.use(
  (res) => res,
  async (error: unknown) => {
    if (!(error instanceof AxiosError) || !error.config || !error.response) {
      return Promise.reject(error);
    }
    const config = error.config as RetryConfig;
    const status = error.response.status;
    const code = (error.response.data as { error?: { code?: string } })?.error
      ?.code;
    const isAuthPath = AUTH_PATHS.some((p) => config.url?.includes(p));

    // Forced password change: let the app route to the change-password gate.
    if (status === 403 && code === AuthErrorCode.FORCE_PASSWORD_CHANGE) {
      handlers.onForcePasswordChange?.();
      return Promise.reject(error);
    }

    // One transparent refresh + retry on 401 (never for auth endpoints).
    if (status === 401 && !config._retried && !isAuthPath) {
      config._retried = true;
      try {
        await runRefresh();
        return await http(config);
      } catch (refreshErr) {
        handlers.onSessionExpired?.();
        return Promise.reject(refreshErr);
      }
    }

    return Promise.reject(error);
  },
);

// --- Endpoint helpers ------------------------------------------------------

export const api = {
  health: async (): Promise<HealthResponse> => {
    const { data } = await http.get<HealthResponse>(`${API_PREFIX}/health`);
    return data;
  },

  /** Public (pre-auth) reads — safe for anonymous visitors. */
  public: {
    /** A college's login-page branding by slug (throws on unknown slug). */
    collegeBranding: async (slug: string): Promise<CollegeBranding> => {
      const { data } = await http.get<CollegeBranding>(
        `${API_PREFIX}/public/colleges/${encodeURIComponent(slug)}/branding`,
      );
      return data;
    },
  },

  auth: {
    register: async (input: RegisterInput): Promise<RegisterResponse> => {
      const { data } = await http.post<RegisterResponse>(
        `${API_PREFIX}/auth/register`,
        input,
      );
      return data;
    },
    login: async (input: LoginInput): Promise<AuthResponse> => {
      const { data } = await http.post<AuthResponse>(
        `${API_PREFIX}/auth/login`,
        input,
      );
      return data;
    },
    logout: async (): Promise<void> => {
      await http.post(`${API_PREFIX}/auth/logout`);
    },
    changePassword: async (
      input: ChangePasswordInput,
    ): Promise<AuthResponse> => {
      const { data } = await http.post<AuthResponse>(
        `${API_PREFIX}/auth/change-password`,
        input,
      );
      return data;
    },
  },

  me: {
    get: async (): Promise<MeResponse> => {
      const { data } = await http.get<MeResponse>(`${API_PREFIX}/me`);
      return data;
    },
    update: async (input: UpdateMeInput): Promise<MeResponse> => {
      const { data } = await http.patch<MeResponse>(`${API_PREFIX}/me`, input);
      return data;
    },
    enrollments: async (): Promise<MyEnrollmentsResponse> => {
      const { data } = await http.get<MyEnrollmentsResponse>(
        `${API_PREFIX}/me/enrollments`,
      );
      return data;
    },
    /** The caller's own college membership (null for individual users). */
    college: async (): Promise<MyCollegeResponse> => {
      const { data } = await http.get<MyCollegeResponse>(
        `${API_PREFIX}/me/college`,
      );
      return data;
    },
  },

  curriculum: {
    catalog: async (
      params: Partial<CatalogQuery> = {},
    ): Promise<CatalogResponse> => {
      const { data } = await http.get<CatalogResponse>(
        `${API_PREFIX}/catalog`,
        {
          params,
        },
      );
      return data;
    },
    subject: async (slug: string): Promise<SubjectDetail> => {
      const { data } = await http.get<SubjectDetail>(
        `${API_PREFIX}/subjects/${slug}`,
      );
      return data;
    },
    enroll: async (slug: string): Promise<EnrollResponse> => {
      const { data } = await http.post<EnrollResponse>(
        `${API_PREFIX}/subjects/${slug}/enroll`,
      );
      return data;
    },
    topic: async (slug: string, topicId: string): Promise<TopicContent> => {
      const { data } = await http.get<TopicContent>(
        `${API_PREFIX}/subjects/${slug}/topics/${topicId}`,
      );
      return data;
    },
    completeTopic: async (
      slug: string,
      topicId: string,
      completed: boolean,
    ): Promise<TopicCompleteResponse> => {
      const { data } = await http.post<TopicCompleteResponse>(
        `${API_PREFIX}/subjects/${slug}/topics/${topicId}/complete`,
        { completed },
      );
      return data;
    },
    quiz: async (slug: string, topicId: string): Promise<Quiz> => {
      const { data } = await http.get<Quiz>(
        `${API_PREFIX}/subjects/${slug}/topics/${topicId}/quiz`,
      );
      return data;
    },
    submitQuiz: async (
      slug: string,
      topicId: string,
      body: QuizSubmitRequest,
    ): Promise<QuizResult> => {
      const { data } = await http.post<QuizResult>(
        `${API_PREFIX}/subjects/${slug}/topics/${topicId}/quiz/submit`,
        body,
      );
      return data;
    },
  },

  execute: {
    /** Submit code; returns fast with a jobId to poll/stream. */
    submit: async (body: ExecuteRequest): Promise<JobRef> => {
      const { data } = await http.post<JobRef>(`${API_PREFIX}/execute`, body);
      return data;
    },
    /** Poll a job's status + result. */
    status: async (jobId: string): Promise<ExecuteStatusResponse> => {
      const { data } = await http.get<ExecuteStatusResponse>(
        `${API_PREFIX}/execute/${jobId}`,
      );
      return data;
    },
    /** SSE endpoint URL for status transitions (same-origin; cookies ride along). */
    streamUrl: (jobId: string): string =>
      apiUrl(baseURL, `${API_PREFIX}/execute/${jobId}/stream`),
  },

  challenges: {
    today: async (): Promise<ChallengeTodayResponse> => {
      const { data } = await http.get<ChallengeTodayResponse>(
        `${API_PREFIX}/challenges/today`,
      );
      return data;
    },
    submitMcq: async (option: number): Promise<SubmitMcqResponse> => {
      const { data } = await http.post<SubmitMcqResponse>(
        `${API_PREFIX}/challenges/today/submit-mcq`,
        { option },
      );
      return data;
    },
    submitCode: async (body: SubmitCodeRequest): Promise<JobRef> => {
      const { data } = await http.post<JobRef>(
        `${API_PREFIX}/challenges/today/submit-code`,
        body,
      );
      return data;
    },
    finalize: async (jobId: string): Promise<FinalizeChallengeResponse> => {
      const { data } = await http.post<FinalizeChallengeResponse>(
        `${API_PREFIX}/challenges/submissions/${jobId}/finalize`,
      );
      return data;
    },
    leaderboard: async (
      params: Partial<LeaderboardQuery> = {},
    ): Promise<LeaderboardResponse> => {
      const { data } = await http.get<LeaderboardResponse>(
        `${API_PREFIX}/challenges/leaderboard`,
        { params },
      );
      return data;
    },
  },

  payments: {
    /** Price + coupon preview (no side effects). */
    quote: async (body: QuoteRequest): Promise<QuoteResponse> => {
      const { data } = await http.post<QuoteResponse>(
        `${API_PREFIX}/payments/quote`,
        body,
      );
      return data;
    },
    /** Create an order; returns the gateway redirect payload. */
    createOrder: async (
      body: CreateOrderRequest,
    ): Promise<CreateOrderResponse> => {
      const { data } = await http.post<CreateOrderResponse>(
        `${API_PREFIX}/payments/orders`,
        body,
      );
      return data;
    },
    /** Poll an order's status + enrollment flag. */
    order: async (orderId: string): Promise<OrderStatusResponse> => {
      const { data } = await http.get<OrderStatusResponse>(
        `${API_PREFIX}/payments/orders/${orderId}`,
      );
      return data;
    },
    /** The caller's order history (newest first). */
    orders: async (): Promise<OrderListResponse> => {
      const { data } = await http.get<OrderListResponse>(
        `${API_PREFIX}/payments/orders`,
      );
      return data;
    },
    /** Mock-only: drive a verified success/failure callback (dev gateway). */
    mockPay: async (body: MockPayRequest): Promise<OrderStatusResponse> => {
      const { data } = await http.post<OrderStatusResponse>(
        `${API_PREFIX}/payments/mock/pay`,
        body,
      );
      return data;
    },
  },

  essays: {
    /** Essay prompts the logged-in student can attempt (enrolled subjects). */
    list: async (): Promise<EssayListResponse> => {
      const { data } = await http.get<EssayListResponse>(
        `${API_PREFIX}/essays`,
      );
      return data;
    },
    /** Student prompt detail (no rubric internals / reference keywords). */
    get: async (id: string): Promise<EssayPromptDetail> => {
      const { data } = await http.get<EssayPromptDetail>(
        `${API_PREFIX}/essays/${id}`,
      );
      return data;
    },
    /** Latest recoverable draft for a prompt ({ draft: … | null }). */
    draft: async (id: string): Promise<EssayDraftResponse> => {
      const { data } = await http.get<EssayDraftResponse>(
        `${API_PREFIX}/essays/${id}/draft`,
      );
      return data;
    },
    /** Autosave a draft snapshot. Never submits/grades/consumes an attempt. */
    saveDraft: async (
      id: string,
      content: string,
    ): Promise<SaveEssayDraftResponse> => {
      const { data } = await http.put<SaveEssayDraftResponse>(
        `${API_PREFIX}/essays/${id}/draft`,
        { content },
      );
      return data;
    },
    /** Submit an essay; returns fast (202) with a jobId to poll. `integrity` is
     * sent only for proctored (college) essays; omitted for individual ones. */
    submit: async (
      id: string,
      content: string,
      integrity?: EssayIntegrity,
    ): Promise<JobRef> => {
      const { data } = await http.post<JobRef>(
        `${API_PREFIX}/essays/${id}/submit`,
        integrity ? { content, integrity } : { content },
      );
      return data;
    },
    /** Poll a submission's grading status/result. */
    submission: async (jobId: string): Promise<EssayGradingResult> => {
      const { data } = await http.get<EssayGradingResult>(
        `${API_PREFIX}/essays/submissions/${jobId}`,
      );
      return data;
    },
    /** A prompt's submission history (newest first). */
    submissions: async (id: string): Promise<EssaySubmissionListResponse> => {
      const { data } = await http.get<EssaySubmissionListResponse>(
        `${API_PREFIX}/essays/${id}/submissions`,
      );
      return data;
    },
    /**
     * Optional, additive writing analytics (counts + timings, no content).
     * Never affects the grade. Best-effort — failures are swallowed by callers.
     */
    analytics: async (
      jobId: string,
      body: EssayAnalyticsInput,
    ): Promise<void> => {
      await http.post(
        `${API_PREFIX}/essays/submissions/${jobId}/analytics`,
        body,
      );
    },
    /** On-demand AI Scoring & Feedback for the caller's own submission. */
    aiFeedback: async (jobId: string): Promise<EssayAiFeedbackResponse> => {
      const { data } = await http.post<EssayAiFeedbackResponse>(
        `${API_PREFIX}/essays/submissions/${jobId}/ai-feedback`,
      );
      return data;
    },
  },

  careers: {
    /** Paginated job/placement postings (active + not-past-deadline by default). */
    list: async (
      params: Partial<PostingListQuery> = {},
    ): Promise<PostingListResponse> => {
      const { data } = await http.get<PostingListResponse>(
        `${API_PREFIX}/careers`,
        { params },
      );
      return data;
    },
    /** Student posting detail (+ the caller's own application, if any). */
    get: async (id: string): Promise<PostingDetail> => {
      const { data } = await http.get<PostingDetail>(
        `${API_PREFIX}/careers/${id}`,
      );
      return data;
    },
    /** Apply in-app to a posting (only for postings without an applyUrl). */
    apply: async (
      id: string,
      body: ApplyRequest,
    ): Promise<ApplicationResponse> => {
      const { data } = await http.post<ApplicationResponse>(
        `${API_PREFIX}/careers/${id}/apply`,
        body,
      );
      return data;
    },
    /** The caller's own in-app applications (newest first). */
    myApplications: async (): Promise<MyApplicationsResponse> => {
      const { data } = await http.get<MyApplicationsResponse>(
        `${API_PREFIX}/careers/applications`,
      );
      return data;
    },
  },

  adminCareers: {
    list: async (): Promise<AdminPostingListResponse> => {
      const { data } = await http.get<AdminPostingListResponse>(
        `${API_PREFIX}/admin/careers`,
      );
      return data;
    },
    get: async (id: string): Promise<AdminPosting> => {
      const { data } = await http.get<AdminPosting>(
        `${API_PREFIX}/admin/careers/${id}`,
      );
      return data;
    },
    create: async (body: AdminPostingUpsert): Promise<AdminPosting> => {
      const { data } = await http.post<AdminPosting>(
        `${API_PREFIX}/admin/careers`,
        body,
      );
      return data;
    },
    update: async (
      id: string,
      body: AdminPostingUpsert,
    ): Promise<AdminPosting> => {
      const { data } = await http.patch<AdminPosting>(
        `${API_PREFIX}/admin/careers/${id}`,
        body,
      );
      return data;
    },
    publish: async (id: string): Promise<AdminPosting> => {
      const { data } = await http.post<AdminPosting>(
        `${API_PREFIX}/admin/careers/${id}/publish`,
      );
      return data;
    },
    close: async (id: string): Promise<AdminPosting> => {
      const { data } = await http.post<AdminPosting>(
        `${API_PREFIX}/admin/careers/${id}/close`,
      );
      return data;
    },
    remove: async (id: string): Promise<{ deleted: true }> => {
      const { data } = await http.delete<{ deleted: true }>(
        `${API_PREFIX}/admin/careers/${id}`,
      );
      return data;
    },
    applications: async (
      id: string,
    ): Promise<AdminApplicationListResponse> => {
      const { data } = await http.get<AdminApplicationListResponse>(
        `${API_PREFIX}/admin/careers/${id}/applications`,
      );
      return data;
    },
    updateApplicationStatus: async (
      appId: string,
      status: JobApplicationStatus,
    ): Promise<{ id: string; status: JobApplicationStatus }> => {
      const { data } = await http.patch<{
        id: string;
        status: JobApplicationStatus;
      }>(`${API_PREFIX}/admin/careers/applications/${appId}`, { status });
      return data;
    },
  },

  adminCoupons: {
    list: async (): Promise<AdminCouponListResponse> => {
      const { data } = await http.get<AdminCouponListResponse>(
        `${API_PREFIX}/admin/coupons`,
      );
      return data;
    },
    get: async (id: string): Promise<AdminCoupon> => {
      const { data } = await http.get<AdminCoupon>(
        `${API_PREFIX}/admin/coupons/${id}`,
      );
      return data;
    },
    create: async (body: AdminCouponUpsert): Promise<AdminCoupon> => {
      const { data } = await http.post<AdminCoupon>(
        `${API_PREFIX}/admin/coupons`,
        body,
      );
      return data;
    },
    update: async (
      id: string,
      body: AdminCouponUpsert,
    ): Promise<AdminCoupon> => {
      const { data } = await http.patch<AdminCoupon>(
        `${API_PREFIX}/admin/coupons/${id}`,
        body,
      );
      return data;
    },
    setActive: async (id: string, active: boolean): Promise<AdminCoupon> => {
      const { data } = await http.post<AdminCoupon>(
        `${API_PREFIX}/admin/coupons/${id}/active`,
        { active },
      );
      return data;
    },
    remove: async (id: string): Promise<{ deleted: true }> => {
      const { data } = await http.delete<{ deleted: true }>(
        `${API_PREFIX}/admin/coupons/${id}`,
      );
      return data;
    },
  },

  /**
   * College (tenant) provisioning + entitlement control — the Phase 0
   * super-admin API. All routes are platform-admin-guarded server-side.
   */
  adminColleges: {
    list: async (): Promise<CollegeListResponse> => {
      const { data } = await http.get<CollegeListResponse>(
        `${API_PREFIX}/admin/colleges`,
      );
      return data;
    },
    get: async (id: string): Promise<College> => {
      const { data } = await http.get<College>(
        `${API_PREFIX}/admin/colleges/${id}`,
      );
      return data;
    },
    create: async (body: CreateCollegeInput): Promise<College> => {
      const { data } = await http.post<College>(
        `${API_PREFIX}/admin/colleges`,
        body,
      );
      return data;
    },
    update: async (id: string, body: UpdateCollegeInput): Promise<College> => {
      const { data } = await http.patch<College>(
        `${API_PREFIX}/admin/colleges/${id}`,
        body,
      );
      return data;
    },
    /** Toggle any subset of feature / sub-capability entitlements. */
    setEntitlements: async (
      id: string,
      body: SetEntitlementsInput,
    ): Promise<College> => {
      const { data } = await http.put<College>(
        `${API_PREFIX}/admin/colleges/${id}/entitlements`,
        body,
      );
      return data;
    },
    /** Grant specific master-catalog courses (Subject ids) to the college. */
    grantCourses: async (
      id: string,
      body: GrantCoursesInput,
    ): Promise<College> => {
      const { data } = await http.post<College>(
        `${API_PREFIX}/admin/colleges/${id}/courses`,
        body,
      );
      return data;
    },
    /** Revoke previously-granted courses from the college. */
    revokeCourses: async (
      id: string,
      body: GrantCoursesInput,
    ): Promise<College> => {
      const { data } = await http.delete<College>(
        `${API_PREFIX}/admin/colleges/${id}/courses`,
        { data: body },
      );
      return data;
    },
    /** AI credits (Stage 1): the live balance for a college's current period. */
    getCredits: async (id: string): Promise<AiCreditBalance> => {
      const { data } = await http.get<AiCreditBalance>(
        `${API_PREFIX}/admin/colleges/${id}/credits`,
      );
      return data;
    },
    /** Set a college's AI-credit tier / explicit override / reset this period. */
    setCredits: async (
      id: string,
      body: SetCollegeCreditsInput,
    ): Promise<AiCreditBalance> => {
      const { data } = await http.put<AiCreditBalance>(
        `${API_PREFIX}/admin/colleges/${id}/credits`,
        body,
      );
      return data;
    },
    /** The college_admins provisioned for a college. */
    listAdmins: async (id: string): Promise<CollegeAdminListResponse> => {
      const { data } = await http.get<CollegeAdminListResponse>(
        `${API_PREFIX}/admin/colleges/${id}/admins`,
      );
      return data;
    },
    /** Designate a new college_admin (temp password + forced first-login change). */
    createAdmin: async (
      id: string,
      body: CreateCollegeAdminInput,
    ): Promise<CollegeAdmin> => {
      const { data } = await http.post<CollegeAdmin>(
        `${API_PREFIX}/admin/colleges/${id}/admins`,
        body,
      );
      return data;
    },
  },

  /**
   * Tenant-scoped college space (Phase 2b) — everything under /c/:slug/... . The
   * caller must be a member of (or a platform admin over) the college; the server
   * validates the slug via resolveTenant and 403s cross-tenant access.
   */
  collegeContext: {
    /** Resolved identity + membership + entitlements for the college. */
    get: async (slug: string): Promise<CollegeContextResponse> => {
      const { data } = await http.get<CollegeContextResponse>(
        `${API_PREFIX}/c/${slug}/context`,
      );
      return data;
    },
    /** Dashboard aggregate counts + recent students (operators only). */
    summary: async (slug: string): Promise<CollegeSummaryResponse> => {
      const { data } = await http.get<CollegeSummaryResponse>(
        `${API_PREFIX}/c/${slug}/summary`,
      );
      return data;
    },
    /** Read-only AI-credit balance for the operator workspace (view only). */
    aiCredits: async (slug: string): Promise<AiCreditBalance> => {
      const { data } = await http.get<AiCreditBalance>(
        `${API_PREFIX}/c/${slug}/ai-credits`,
      );
      return data;
    },
    /** Student home overview counts (any tenant member; computed for the caller). */
    studentSummary: async (
      slug: string,
    ): Promise<CollegeStudentSummaryResponse> => {
      const { data } = await http.get<CollegeStudentSummaryResponse>(
        `${API_PREFIX}/c/${slug}/student/summary`,
      );
      return data;
    },
    /** The student's assigned college courses (same shape as /me/enrollments). */
    studentCourses: async (slug: string): Promise<MyEnrollmentsResponse> => {
      const { data } = await http.get<MyEnrollmentsResponse>(
        `${API_PREFIX}/c/${slug}/student/courses`,
      );
      return data;
    },
    /** The CALLING student's own attendance (overall + per-group + history). */
    myAttendance: async (slug: string): Promise<StudentAttendanceResponse> => {
      const { data } = await http.get<StudentAttendanceResponse>(
        `${API_PREFIX}/c/${slug}/student/attendance`,
      );
      return data;
    },
  },

  /** The college's academic structure (departments → years → sections → …). */
  collegeOrgUnits: {
    /** The full nested tree (faculty and above may read). */
    listTree: async (slug: string): Promise<OrgUnitTreeResponse> => {
      const { data } = await http.get<OrgUnitTreeResponse>(
        `${API_PREFIX}/c/${slug}/org-units`,
      );
      return data;
    },
    create: async (slug: string, body: CreateOrgUnitInput): Promise<OrgUnit> => {
      const { data } = await http.post<OrgUnit>(
        `${API_PREFIX}/c/${slug}/org-units`,
        body,
      );
      return data;
    },
    update: async (
      slug: string,
      id: string,
      body: UpdateOrgUnitInput,
    ): Promise<OrgUnit> => {
      const { data } = await http.patch<OrgUnit>(
        `${API_PREFIX}/c/${slug}/org-units/${id}`,
        body,
      );
      return data;
    },
    remove: async (slug: string, id: string): Promise<{ deleted: true }> => {
      const { data } = await http.delete<{ deleted: true }>(
        `${API_PREFIX}/c/${slug}/org-units/${id}`,
      );
      return data;
    },
    /** Paste-to-create: one parent + type + many names → many sibling units. */
    bulkCreate: async (
      slug: string,
      body: BulkCreateOrgUnitsInput,
    ): Promise<BulkCreateOrgUnitsResponse> => {
      const { data } = await http.post<BulkCreateOrgUnitsResponse>(
        `${API_PREFIX}/c/${slug}/org-units/bulk`,
        body,
      );
      return data;
    },
  },

  /** Faculty accounts for the college (gated by the faculty_management feature). */
  collegeFaculty: {
    list: async (slug: string): Promise<FacultyListResponse> => {
      const { data } = await http.get<FacultyListResponse>(
        `${API_PREFIX}/c/${slug}/faculty`,
      );
      return data;
    },
    create: async (slug: string, body: CreateFacultyInput): Promise<Faculty> => {
      const { data } = await http.post<Faculty>(
        `${API_PREFIX}/c/${slug}/faculty`,
        body,
      );
      return data;
    },
    update: async (
      slug: string,
      id: string,
      body: UpdateFacultyInput,
    ): Promise<Faculty> => {
      const { data } = await http.patch<Faculty>(
        `${API_PREFIX}/c/${slug}/faculty/${id}`,
        body,
      );
      return data;
    },
    /** Soft-deactivate (kills sessions; preserves records). */
    deactivate: async (slug: string, id: string): Promise<Faculty> => {
      const { data } = await http.delete<Faculty>(
        `${API_PREFIX}/c/${slug}/faculty/${id}`,
      );
      return data;
    },
  },

  /**
   * College students + bulk import (Phase 3b). List/add are open to any college
   * member (faculty scope enforced server-side); the import endpoints require the
   * `bulk_import` feature. Both file and paste UIs produce the SAME
   * StudentImportRowInput[] and hit the same preview/commit endpoints.
   */
  collegeStudents: {
    list: async (
      slug: string,
      query: CollegeStudentListQuery = {},
    ): Promise<CollegeStudentListResponse> => {
      const { data } = await http.get<CollegeStudentListResponse>(
        `${API_PREFIX}/c/${slug}/students`,
        { params: query },
      );
      return data;
    },
    create: async (
      slug: string,
      body: CreateCollegeStudentInput,
    ): Promise<CollegeStudent> => {
      const { data } = await http.post<CollegeStudent>(
        `${API_PREFIX}/c/${slug}/students`,
        body,
      );
      return data;
    },
    /** Edit a student's details (name / email / roll / org-unit). */
    update: async (
      slug: string,
      id: string,
      body: UpdateCollegeStudentInput,
    ): Promise<CollegeStudent> => {
      const { data } = await http.patch<CollegeStudent>(
        `${API_PREFIX}/c/${slug}/students/${id}`,
        body,
      );
      return data;
    },
    /** Soft-deactivate a student (kills sessions; preserves records). */
    deactivate: async (slug: string, id: string): Promise<CollegeStudent> => {
      const { data } = await http.delete<CollegeStudent>(
        `${API_PREFIX}/c/${slug}/students/${id}`,
      );
      return data;
    },
    resetPassword: async (slug: string, id: string): Promise<void> => {
      await http.post(
        `${API_PREFIX}/c/${slug}/students/${id}/reset-password`,
      );
    },
    /** Dry-run: per-row verdicts + summary. Writes nothing. */
    importPreview: async (
      slug: string,
      rows: StudentImportRowInput[],
    ): Promise<StudentImportPreviewResponse> => {
      const { data } = await http.post<StudentImportPreviewResponse>(
        `${API_PREFIX}/c/${slug}/students/import/preview`,
        { rows },
      );
      return data;
    },
    /** Create the valid rows; returns created / skipped / failed. */
    importCommit: async (
      slug: string,
      rows: StudentImportRowInput[],
    ): Promise<StudentImportCommitResponse> => {
      const { data } = await http.post<StudentImportCommitResponse>(
        `${API_PREFIX}/c/${slug}/students/import/commit`,
        { rows },
      );
      return data;
    },
    /** Download the sample import CSV (auth cookie rides along). */
    template: async (
      slug: string,
    ): Promise<{ blob: Blob; filename: string }> => {
      const res = await http.get(
        `${API_PREFIX}/c/${slug}/students/import/template`,
        { responseType: "blob" },
      );
      const disposition = String(res.headers["content-disposition"] ?? "");
      const match = /filename="?([^"]+)"?/.exec(disposition);
      return {
        blob: res.data as Blob,
        filename: match?.[1] ?? "student-import-template.csv",
      };
    },
  },

  /**
   * Attendance groups (Prompt 1). Form classes/events from org-units, sections,
   * individuals, and Excel roll-number uploads (matched/unmatched preview before
   * confirming). Faculty authoring; scope + the cross-cutting permission are
   * enforced server-side. Requires the `attendance` feature.
   */
  attendance: {
    listGroups: async (slug: string): Promise<AttendanceGroupListResponse> => {
      const { data } = await http.get<AttendanceGroupListResponse>(
        `${API_PREFIX}/c/${slug}/attendance/groups`,
      );
      return data;
    },
    getGroup: async (slug: string, id: string): Promise<AttendanceGroup> => {
      const { data } = await http.get<AttendanceGroup>(
        `${API_PREFIX}/c/${slug}/attendance/groups/${id}`,
      );
      return data;
    },
    createGroup: async (
      slug: string,
      body: CreateAttendanceGroupInput,
    ): Promise<AttendanceGroup> => {
      const { data } = await http.post<AttendanceGroup>(
        `${API_PREFIX}/c/${slug}/attendance/groups`,
        body,
      );
      return data;
    },
    updateGroup: async (
      slug: string,
      id: string,
      body: UpdateAttendanceGroupInput,
    ): Promise<AttendanceGroup> => {
      const { data } = await http.patch<AttendanceGroup>(
        `${API_PREFIX}/c/${slug}/attendance/groups/${id}`,
        body,
      );
      return data;
    },
    deleteGroup: async (
      slug: string,
      id: string,
    ): Promise<{ deleted: true }> => {
      const { data } = await http.delete<{ deleted: true }>(
        `${API_PREFIX}/c/${slug}/attendance/groups/${id}`,
      );
      return data;
    },
    addMembers: async (
      slug: string,
      id: string,
      body: AddAttendanceMembersInput,
    ): Promise<AttendanceGroup> => {
      const { data } = await http.post<AttendanceGroup>(
        `${API_PREFIX}/c/${slug}/attendance/groups/${id}/members`,
        body,
      );
      return data;
    },
    removeMember: async (
      slug: string,
      id: string,
      studentId: string,
    ): Promise<AttendanceGroup> => {
      const { data } = await http.delete<AttendanceGroup>(
        `${API_PREFIX}/c/${slug}/attendance/groups/${id}/members/${studentId}`,
      );
      return data;
    },
    /** Upload an .xlsx of roll numbers → matched/unmatched (persists nothing). */
    importPreview: async (
      slug: string,
      fileBase64: string,
    ): Promise<AttendanceImportPreviewResponse> => {
      const { data } = await http.post<AttendanceImportPreviewResponse>(
        `${API_PREFIX}/c/${slug}/attendance/groups/import/preview`,
        { fileBase64 },
      );
      return data;
    },
    /** Download the roll-number .xlsx template (auth cookie rides along). */
    template: async (
      slug: string,
    ): Promise<{ blob: Blob; filename: string }> => {
      const res = await http.get(
        `${API_PREFIX}/c/${slug}/attendance/groups/import/template`,
        { responseType: "blob" },
      );
      const disposition = String(res.headers["content-disposition"] ?? "");
      const match = /filename="?([^"]+)"?/.exec(disposition);
      return {
        blob: res.data as Blob,
        filename: match?.[1] ?? "attendance-roll-numbers-template.xlsx",
      };
    },
    getSettings: async (slug: string): Promise<AttendanceSettings> => {
      const { data } = await http.get<AttendanceSettings>(
        `${API_PREFIX}/c/${slug}/attendance/settings`,
      );
      return data;
    },
    setSettings: async (
      slug: string,
      body: SetAttendanceSettingsInput,
    ): Promise<AttendanceSettings> => {
      const { data } = await http.put<AttendanceSettings>(
        `${API_PREFIX}/c/${slug}/attendance/settings`,
        body,
      );
      return data;
    },

    /** Sessions (Prompt 2) — schedule/ad-hoc + take attendance on a group. */
    listSessions: async (
      slug: string,
      groupId: string,
    ): Promise<AttendanceSessionListResponse> => {
      const { data } = await http.get<AttendanceSessionListResponse>(
        `${API_PREFIX}/c/${slug}/attendance/groups/${groupId}/sessions`,
      );
      return data;
    },
    createSession: async (
      slug: string,
      groupId: string,
      body: CreateAttendanceSessionInput,
    ): Promise<AttendanceSession> => {
      const { data } = await http.post<AttendanceSession>(
        `${API_PREFIX}/c/${slug}/attendance/groups/${groupId}/sessions`,
        body,
      );
      return data;
    },
    /** The session + its roster (members + each one's mark). */
    getSession: async (
      slug: string,
      sessionId: string,
    ): Promise<AttendanceRosterResponse> => {
      const { data } = await http.get<AttendanceRosterResponse>(
        `${API_PREFIX}/c/${slug}/attendance/sessions/${sessionId}`,
      );
      return data;
    },
    updateSession: async (
      slug: string,
      sessionId: string,
      body: UpdateAttendanceSessionInput,
    ): Promise<AttendanceSession> => {
      const { data } = await http.patch<AttendanceSession>(
        `${API_PREFIX}/c/${slug}/attendance/sessions/${sessionId}`,
        body,
      );
      return data;
    },
    deleteSession: async (
      slug: string,
      sessionId: string,
    ): Promise<{ deleted: true }> => {
      const { data } = await http.delete<{ deleted: true }>(
        `${API_PREFIX}/c/${slug}/attendance/sessions/${sessionId}`,
      );
      return data;
    },
    /** Save the final marks → records upserted, session completed. */
    saveAttendance: async (
      slug: string,
      sessionId: string,
      body: SaveAttendanceInput,
    ): Promise<AttendanceRosterResponse> => {
      const { data } = await http.put<AttendanceRosterResponse>(
        `${API_PREFIX}/c/${slug}/attendance/sessions/${sessionId}/attendance`,
        body,
      );
      return data;
    },

    /** Analytics (Prompt 3) — read-only rollups over completed sessions. */
    analytics: async (
      slug: string,
      threshold?: number,
    ): Promise<AttendanceAnalyticsResponse> => {
      const { data } = await http.get<AttendanceAnalyticsResponse>(
        `${API_PREFIX}/c/${slug}/attendance/analytics`,
        { params: threshold !== undefined ? { threshold } : {} },
      );
      return data;
    },
    /** Download a group's P/A register .xlsx. */
    registerReport: async (
      slug: string,
      groupId: string,
    ): Promise<{ blob: Blob; filename: string }> => {
      const res = await http.get(
        `${API_PREFIX}/c/${slug}/attendance/analytics/report/register`,
        { params: { groupId }, responseType: "blob" },
      );
      const disposition = String(res.headers["content-disposition"] ?? "");
      const match = /filename="?([^"]+)"?/.exec(disposition);
      return {
        blob: res.data as Blob,
        filename: match?.[1] ?? "attendance-register.xlsx",
      };
    },
    /** Download the summary/defaulters .xlsx (optional filters). */
    summaryReport: async (
      slug: string,
      params: {
        threshold?: number;
        groupId?: string;
        unitId?: string;
        from?: string;
        to?: string;
      } = {},
    ): Promise<{ blob: Blob; filename: string }> => {
      const res = await http.get(
        `${API_PREFIX}/c/${slug}/attendance/analytics/report/summary`,
        { params, responseType: "blob" },
      );
      const disposition = String(res.headers["content-disposition"] ?? "");
      const match = /filename="?([^"]+)"?/.exec(disposition);
      return {
        blob: res.data as Blob,
        filename: match?.[1] ?? "attendance-summary.xlsx",
      };
    },

    /** OPTIONAL session photos — a feature-scoped Cloudinary upload signature +
     * add/remove by URL. Manager authority enforced server-side. */
    uploadSignature: async (slug: string): Promise<UploadSignatureResponse> => {
      const { data } = await http.post<UploadSignatureResponse>(
        `${API_PREFIX}/c/${slug}/attendance/uploads/signature`,
      );
      return data;
    },
    addSessionPhotos: async (
      slug: string,
      sessionId: string,
      photos: { url: string; caption?: string }[],
    ): Promise<AttendanceSession> => {
      const { data } = await http.post<AttendanceSession>(
        `${API_PREFIX}/c/${slug}/attendance/sessions/${sessionId}/photos`,
        { photos },
      );
      return data;
    },
    removeSessionPhoto: async (
      slug: string,
      sessionId: string,
      photoId: string,
    ): Promise<AttendanceSession> => {
      const { data } = await http.delete<AttendanceSession>(
        `${API_PREFIX}/c/${slug}/attendance/sessions/${sessionId}/photos/${photoId}`,
      );
      return data;
    },
  },

  /**
   * Coding profiles (Prompt 1). A student links their Codeforces / LeetCode /
   * CodeChef handles and sees the STORED per-platform stats (a scheduled worker
   * job refreshes them). Own-data-only; requires the `coding_profiles` feature.
   */
  codingProfiles: {
    getMine: async (slug: string): Promise<CodingProfileResponse> => {
      const { data } = await http.get<CodingProfileResponse>(
        `${API_PREFIX}/c/${slug}/coding-profiles/me`,
      );
      return data;
    },
    setHandles: async (
      slug: string,
      body: SetCodingHandlesInput,
    ): Promise<CodingProfileResponse> => {
      const { data } = await http.put<CodingProfileResponse>(
        `${API_PREFIX}/c/${slug}/coding-profiles/me/handles`,
        body,
      );
      return data;
    },
    refreshMine: async (slug: string): Promise<{ queued: boolean }> => {
      const { data } = await http.post<{ queued: boolean }>(
        `${API_PREFIX}/c/${slug}/coding-profiles/me/refresh`,
      );
      return data;
    },
    refreshStudent: async (
      slug: string,
      userId: string,
    ): Promise<{ queued: boolean }> => {
      const { data } = await http.post<{ queued: boolean }>(
        `${API_PREFIX}/c/${slug}/coding-profiles/students/${userId}/refresh`,
      );
      return data;
    },
  },

  /**
   * Coding leaderboard (Prompt 2). Admin/faculty read-only ranking over the
   * stored coding stats, filterable by platform+metric, org-unit, and attendance
   * group, with an .xlsx export. Requires the `coding_profiles` feature.
   */
  codingLeaderboard: {
    get: async (
      slug: string,
      params: {
        platform: CodingPlatform;
        metric: CodingMetric;
        unitId?: string;
        groupId?: string;
      },
    ): Promise<CodingLeaderboardResponse> => {
      const { data } = await http.get<CodingLeaderboardResponse>(
        `${API_PREFIX}/c/${slug}/coding-leaderboard`,
        { params },
      );
      return data;
    },
    /** Download the filtered leaderboard .xlsx. */
    report: async (
      slug: string,
      params: {
        platform: CodingPlatform;
        metric: CodingMetric;
        unitId?: string;
        groupId?: string;
      },
    ): Promise<{ blob: Blob; filename: string }> => {
      const res = await http.get(`${API_PREFIX}/c/${slug}/coding-leaderboard/report`, {
        params,
        responseType: "blob",
      });
      const disposition = String(res.headers["content-disposition"] ?? "");
      const match = /filename="?([^"]+)"?/.exec(disposition);
      return {
        blob: res.data as Blob,
        filename: match?.[1] ?? "coding-leaderboard.xlsx",
      };
    },
  },

  /**
   * Per-student AI credit distribution (Stage-1 pool → per-student allocations).
   * Admin: view/allocate/toggle + reuse the roll-number Excel preview/template.
   * Student: their OWN allocation. Requires the `ai` feature.
   */
  aiCreditDistribution: {
    get: async (slug: string): Promise<AiCreditDistributionResponse> => {
      const { data } = await http.get<AiCreditDistributionResponse>(
        `${API_PREFIX}/c/${slug}/ai-credits/distribution`,
      );
      return data;
    },
    setEnabled: async (
      slug: string,
      enabled: boolean,
    ): Promise<AiCreditDistributionResponse> => {
      const { data } = await http.put<AiCreditDistributionResponse>(
        `${API_PREFIX}/c/${slug}/ai-credits/distribution/settings`,
        { enabled },
      );
      return data;
    },
    allocate: async (
      slug: string,
      body: AllocateStudentCreditsInput,
    ): Promise<AiCreditDistributionResponse> => {
      const { data } = await http.post<AiCreditDistributionResponse>(
        `${API_PREFIX}/c/${slug}/ai-credits/distribution/allocate`,
        body,
      );
      return data;
    },
    importPreview: async (
      slug: string,
      fileBase64: string,
    ): Promise<AttendanceImportPreviewResponse> => {
      const { data } = await http.post<AttendanceImportPreviewResponse>(
        `${API_PREFIX}/c/${slug}/ai-credits/distribution/preview`,
        { fileBase64 },
      );
      return data;
    },
    template: async (slug: string): Promise<{ blob: Blob; filename: string }> => {
      const res = await http.get(
        `${API_PREFIX}/c/${slug}/ai-credits/distribution/template`,
        { responseType: "blob" },
      );
      const disposition = String(res.headers["content-disposition"] ?? "");
      const match = /filename="?([^"]+)"?/.exec(disposition);
      return {
        blob: res.data as Blob,
        filename: match?.[1] ?? "credit-roll-numbers-template.xlsx",
      };
    },
    /** The calling student's OWN allocation this period. */
    mine: async (slug: string): Promise<StudentOwnAiCredit> => {
      const { data } = await http.get<StudentOwnAiCredit>(
        `${API_PREFIX}/c/${slug}/student/ai-credits`,
      );
      return data;
    },
  },

  /**
   * College course assignment (Phase 4a). Assign the super-admin-granted courses
   * to college students (faculty scope enforced server-side); students then learn
   * them through the existing player. Requires the `courses` feature.
   */
  collegeCourses: {
    /** Granted courses + current assignment counts. */
    list: async (slug: string): Promise<CollegeCourseListResponse> => {
      const { data } = await http.get<CollegeCourseListResponse>(
        `${API_PREFIX}/c/${slug}/courses/catalog`,
      );
      return data;
    },
    /** The college students currently assigned a course. */
    assignedStudents: async (
      slug: string,
      courseId: string,
    ): Promise<CourseAssignedStudentsResponse> => {
      const { data } = await http.get<CourseAssignedStudentsResponse>(
        `${API_PREFIX}/c/${slug}/courses/${courseId}/students`,
      );
      return data;
    },
    assign: async (
      slug: string,
      courseId: string,
      studentIds: string[],
    ): Promise<CourseAssignResponse> => {
      const { data } = await http.post<CourseAssignResponse>(
        `${API_PREFIX}/c/${slug}/courses/${courseId}/assign`,
        { studentIds },
      );
      return data;
    },
    revoke: async (
      slug: string,
      courseId: string,
      studentIds: string[],
    ): Promise<CourseRevokeResponse> => {
      const { data } = await http.post<CourseRevokeResponse>(
        `${API_PREFIX}/c/${slug}/courses/${courseId}/revoke`,
        { studentIds },
      );
      return data;
    },
  },

  /**
   * College exams (Phase 4b-ii) — tenant-scoped authoring + results over the
   * REUSED exam engine. Mirrors `adminExams` for the shared authoring surface
   * (section/question/test-case/public-link CRUD, bulk-upload) so the same
   * editor components drive both; the college-specific bits are exam create/edit
   * with org-unit targeting + a draft→published lifecycle, and tenant-scoped
   * JSON results. Requires the `exams` feature (faculty scope enforced server-
   * side). The mutation shapes match `ExamAuthoringApi` so a slug-bound adapter
   * can back the reused dialogs (see lib/exam-authoring-api.ts).
   */
  collegeExams: {
    /** The college's exams (authoring list) — scope-filtered for faculty. */
    list: async (slug: string): Promise<CollegeExamListResponse> => {
      const { data } = await http.get<CollegeExamListResponse>(
        `${API_PREFIX}/c/${slug}/exams/manage`,
      );
      return data;
    },
    /** Create a standalone college exam shell (title + pass % + targeting). */
    create: async (
      slug: string,
      body: CreateCollegeExamInput,
    ): Promise<AdminExamDetail> => {
      const { data } = await http.post<AdminExamDetail>(
        `${API_PREFIX}/c/${slug}/exams`,
        body,
      );
      return data;
    },
    /** Full authored tree (sections → questions → test cases), incl. answers. */
    get: async (slug: string, examId: string): Promise<AdminExamDetail> => {
      const { data } = await http.get<AdminExamDetail>(
        `${API_PREFIX}/c/${slug}/exams/${examId}`,
      );
      return data;
    },
    update: async (
      slug: string,
      examId: string,
      body: UpdateCollegeExamInput,
    ): Promise<AdminExamDetail> => {
      const { data } = await http.patch<AdminExamDetail>(
        `${API_PREFIX}/c/${slug}/exams/${examId}`,
        body,
      );
      return data;
    },
    remove: async (slug: string, examId: string): Promise<{ deleted: true }> => {
      const { data } = await http.delete<{ deleted: true }>(
        `${API_PREFIX}/c/${slug}/exams/${examId}`,
      );
      return data;
    },
    /** Publish / unpublish (publish requires ≥1 question — server-enforced). */
    setPublished: async (
      slug: string,
      examId: string,
      isPublished: boolean,
    ): Promise<AdminExamDetail> => {
      const { data } = await http.post<AdminExamDetail>(
        `${API_PREFIX}/c/${slug}/exams/${examId}/publish`,
        { isPublished },
      );
      return data;
    },
    /** Duplicate the whole paper into a new unpublished draft under a new title. */
    duplicate: async (
      slug: string,
      examId: string,
      title: string,
    ): Promise<AdminExamDetail> => {
      const { data } = await http.post<AdminExamDetail>(
        `${API_PREFIX}/c/${slug}/exams/${examId}/duplicate`,
        { title },
      );
      return data;
    },
    /** Tenant-scoped per-student results (no xlsx — JSON table). */
    results: async (
      slug: string,
      examId: string,
    ): Promise<CollegeExamResultsResponse> => {
      const { data } = await http.get<CollegeExamResultsResponse>(
        `${API_PREFIX}/c/${slug}/exams/${examId}/results`,
      );
      return data;
    },
    /** Per-exam result ANALYSIS (Phase 5) — read-only rollups over graded attempts. */
    analysis: async (
      slug: string,
      examId: string,
    ): Promise<ExamAnalysisResponse> => {
      const { data } = await http.get<ExamAnalysisResponse>(
        `${API_PREFIX}/c/${slug}/exams/${examId}/analysis`,
      );
      return data;
    },
    /** Download the exam analysis .xlsx (Results + Distribution [+ Questions]). */
    analysisReport: async (
      slug: string,
      examId: string,
    ): Promise<{ blob: Blob; filename: string }> => {
      const res = await http.get(
        `${API_PREFIX}/c/${slug}/exams/${examId}/analysis/report`,
        { responseType: "blob" },
      );
      const disposition = String(res.headers["content-disposition"] ?? "");
      const match = /filename="?([^"]+)"?/.exec(disposition);
      return {
        blob: res.data as Blob,
        filename: match?.[1] ?? "exam-analysis.xlsx",
      };
    },
    // --- Student take surface (Phase 4b-ii-B) ---
    /**
     * The published, org-unit-targeted exams THIS student may take (same
     * ExamListItem shape as the individual `api.exams.list`, so the same list
     * cards + runner reuse it). Member + `exams` feature; the backend filters by
     * publish state + the student's cohort.
     */
    studentList: async (slug: string): Promise<ExamListResponse> => {
      const { data } = await http.get<ExamListResponse>(
        `${API_PREFIX}/c/${slug}/exams`,
      );
      return data;
    },
    /**
     * Start a college-exam attempt (tenant-scoped). Returns the SAME
     * StartAttemptResponse the individual start does, so the shared runner +
     * /attempts/* engine take over unchanged from here.
     */
    studentStart: async (
      slug: string,
      examId: string,
      accessCode?: string,
    ): Promise<StartAttemptResponse> => {
      const { data } = await http.post<StartAttemptResponse>(
        `${API_PREFIX}/c/${slug}/exams/${examId}/attempts`,
        accessCode ? { accessCode } : undefined,
      );
      return data;
    },
    /** Per-user attempt-counter reset (audited, tenant-scoped). */
    resetAttempts: async (
      slug: string,
      examId: string,
      body: AdminResetAttemptsRequest,
    ): Promise<{ attemptCount: number; maxAttempts: number }> => {
      const { data } = await http.post<{
        attemptCount: number;
        maxAttempts: number;
      }>(`${API_PREFIX}/c/${slug}/exams/${examId}/reset-attempts`, body);
      return data;
    },
    // --- Authoring CRUD (matches ExamAuthoringApi; delegates to the engine) ---
    createSection: async (
      slug: string,
      examId: string,
      body: AdminSectionUpsert,
    ): Promise<AdminExamDetail> => {
      const { data } = await http.post<AdminExamDetail>(
        `${API_PREFIX}/c/${slug}/exams/${examId}/sections`,
        body,
      );
      return data;
    },
    updateSection: async (
      slug: string,
      sectionId: string,
      body: AdminSectionUpsert,
    ): Promise<AdminExamDetail> => {
      const { data } = await http.patch<AdminExamDetail>(
        `${API_PREFIX}/c/${slug}/exam-sections/${sectionId}`,
        body,
      );
      return data;
    },
    deleteSection: async (slug: string, sectionId: string): Promise<void> => {
      await http.delete(`${API_PREFIX}/c/${slug}/exam-sections/${sectionId}`);
    },
    createQuestion: async (
      slug: string,
      body: AdminQuestionUpsert,
    ): Promise<{ id: string }> => {
      const { data } = await http.post<{ id: string }>(
        `${API_PREFIX}/c/${slug}/exam-questions`,
        body,
      );
      return data;
    },
    updateQuestion: async (
      slug: string,
      questionId: string,
      body: AdminQuestionUpsert,
    ): Promise<{ id: string }> => {
      const { data } = await http.patch<{ id: string }>(
        `${API_PREFIX}/c/${slug}/exam-questions/${questionId}`,
        body,
      );
      return data;
    },
    deleteQuestion: async (slug: string, questionId: string): Promise<void> => {
      await http.delete(`${API_PREFIX}/c/${slug}/exam-questions/${questionId}`);
    },
    addTestCase: async (
      slug: string,
      questionId: string,
      body: AdminTestCaseUpsert,
    ): Promise<{ id: string }> => {
      const { data } = await http.post<{ id: string }>(
        `${API_PREFIX}/c/${slug}/exam-questions/${questionId}/test-cases`,
        body,
      );
      return data;
    },
    updateTestCase: async (
      slug: string,
      testCaseId: string,
      body: AdminTestCaseUpsert,
    ): Promise<{ id: string }> => {
      const { data } = await http.patch<{ id: string }>(
        `${API_PREFIX}/c/${slug}/exam-test-cases/${testCaseId}`,
        body,
      );
      return data;
    },
    deleteTestCase: async (slug: string, testCaseId: string): Promise<void> => {
      await http.delete(`${API_PREFIX}/c/${slug}/exam-test-cases/${testCaseId}`);
    },
    bulkUpload: async (
      slug: string,
      examId: string,
      fileBase64: string,
      kind: ExamBulkUploadKind,
    ): Promise<ExcelUploadResponse> => {
      const { data } = await http.post<ExcelUploadResponse>(
        `${API_PREFIX}/c/${slug}/exams/${examId}/bulk-upload`,
        { fileBase64, kind },
      );
      return data;
    },
    /** Download the ready-to-fill MCQ or coding .xlsx template (tenant-gated). */
    bulkUploadTemplate: async (
      slug: string,
      kind: ExamBulkUploadKind,
    ): Promise<{ blob: Blob; filename: string }> => {
      const res = await http.get(
        `${API_PREFIX}/c/${slug}/exams/bulk-upload-template`,
        { params: { kind }, responseType: "blob" },
      );
      const disposition = String(res.headers["content-disposition"] ?? "");
      const match = /filename="?([^"]+)"?/.exec(disposition);
      return {
        blob: res.data as Blob,
        filename: match?.[1] ?? `${kind}-questions-template.xlsx`,
      };
    },
    createPublicLink: async (
      slug: string,
      examId: string,
      body: AdminPublicLinkUpsert,
    ): Promise<PublicLink> => {
      const { data } = await http.post<PublicLink>(
        `${API_PREFIX}/c/${slug}/exams/${examId}/public-links`,
        body,
      );
      return data;
    },
    updatePublicLink: async (
      slug: string,
      linkId: string,
      body: AdminPublicLinkUpsert,
    ): Promise<PublicLink> => {
      const { data } = await http.patch<PublicLink>(
        `${API_PREFIX}/c/${slug}/exam-public-links/${linkId}`,
        body,
      );
      return data;
    },
    deletePublicLink: async (slug: string, linkId: string): Promise<void> => {
      await http.delete(`${API_PREFIX}/c/${slug}/exam-public-links/${linkId}`);
    },
    exportPublicLinkResults: async (
      slug: string,
      linkId: string,
    ): Promise<{ blob: Blob; filename: string }> => {
      const res = await http.get(
        `${API_PREFIX}/c/${slug}/exam-public-links/${linkId}/results.xlsx`,
        { responseType: "blob" },
      );
      const disposition = String(res.headers["content-disposition"] ?? "");
      const match = /filename="?([^"]+)"?/.exec(disposition);
      return {
        blob: res.data as Blob,
        filename: match?.[1] ?? "results.xlsx",
      };
    },
  },

  /**
   * LLM gateway — SUPER-ADMIN provider management + live monitoring. Keys are
   * only WRITTEN (encrypted server-side) or PROBED; the API never returns the
   * key (responses carry `keySet` only).
   */
  adminAiProviders: {
    list: async (): Promise<AiProvidersListResponse> => {
      const { data } = await http.get<AiProvidersListResponse>(
        `${API_PREFIX}/admin/ai-providers`,
      );
      return data;
    },
    patch: async (id: string, body: AiProviderPatch): Promise<AiProviderAdmin> => {
      const { data } = await http.patch<AiProviderAdmin>(
        `${API_PREFIX}/admin/ai-providers/${id}`,
        body,
      );
      return data;
    },
    setKey: async (id: string, key: string): Promise<KeyStatusResponse> => {
      const { data } = await http.put<KeyStatusResponse>(
        `${API_PREFIX}/admin/ai-providers/${id}/key`,
        { key },
      );
      return data;
    },
    deleteKey: async (id: string): Promise<KeyStatusResponse> => {
      const { data } = await http.delete<KeyStatusResponse>(
        `${API_PREFIX}/admin/ai-providers/${id}/key`,
      );
      return data;
    },
    test: async (id: string): Promise<TestProviderKeyResponse> => {
      const { data } = await http.post<TestProviderKeyResponse>(
        `${API_PREFIX}/admin/ai-providers/${id}/test`,
      );
      return data;
    },
    usageTrends: async (days = 14): Promise<UsageTrendsResponse> => {
      const { data } = await http.get<UsageTrendsResponse>(
        `${API_PREFIX}/admin/ai-providers/usage-trends`,
        { params: { days } },
      );
      return data;
    },
    /** Stage-2 governor: config + live status (headroom, shedding, queue depth). */
    getGovernor: async (): Promise<AiGovernorView> => {
      const { data } = await http.get<AiGovernorView>(
        `${API_PREFIX}/admin/ai-governor`,
      );
      return data;
    },
    setGovernor: async (
      body: SetAiGovernorConfigInput,
    ): Promise<AiGovernorView> => {
      const { data } = await http.put<AiGovernorView>(
        `${API_PREFIX}/admin/ai-governor`,
        body,
      );
      return data;
    },
  },

  /**
   * Question bank — SUPER-ADMIN global banks (Standard = MCQ, Coding = CODE):
   * browse/curate + the categorized bulk importer. Wraps the Prompt-1 endpoints
   * under /admin/question-banks/... unchanged.
   */
  adminQuestionBanks: {
    list: async (query: BankBrowseQuery): Promise<BankListResponse> => {
      const { data } = await http.get<BankListResponse>(
        `${API_PREFIX}/admin/question-banks`,
        { params: query },
      );
      return data;
    },
    create: async (body: BankQuestionUpsert): Promise<BankQuestion> => {
      const { data } = await http.post<BankQuestion>(
        `${API_PREFIX}/admin/question-banks`,
        body,
      );
      return data;
    },
    update: async (
      id: string,
      body: BankQuestionUpsert,
    ): Promise<BankQuestion> => {
      const { data } = await http.patch<BankQuestion>(
        `${API_PREFIX}/admin/question-banks/${id}`,
        body,
      );
      return data;
    },
    remove: async (id: string): Promise<{ deleted: true }> => {
      const { data } = await http.delete<{ deleted: true }>(
        `${API_PREFIX}/admin/question-banks/${id}`,
      );
      return data;
    },
    /** Upload a categorized MCQ/coding workbook into the global bank. */
    import: async (
      fileBase64: string,
      kind: ExamBulkUploadKind,
    ): Promise<BankImportResponse> => {
      const { data } = await http.post<BankImportResponse>(
        `${API_PREFIX}/admin/question-banks/import`,
        { fileBase64, kind },
      );
      return data;
    },
    /** Download the ready-to-fill categorized bank template (?kind=mcq|coding). */
    template: async (
      kind: ExamBulkUploadKind,
    ): Promise<{ blob: Blob; filename: string }> => {
      const res = await http.get(`${API_PREFIX}/admin/question-banks/template`, {
        params: { kind },
        responseType: "blob",
      });
      const disposition = String(res.headers["content-disposition"] ?? "");
      const match = /filename="?([^"]+)"?/.exec(disposition);
      return {
        blob: res.data as Blob,
        filename: match?.[1] ?? `bank-${kind}-template.xlsx`,
      };
    },
  },

  /**
   * College question bank — browse the college's Self Bank (always) + the GLOBAL
   * banks (if granted the `question_banks` feature), and pull selected questions
   * INTO an exam section. Tenant + grant + scope enforced server-side.
   */
  collegeQuestionBanks: {
    browse: async (
      slug: string,
      query: BankBrowseQuery,
    ): Promise<BankListResponse> => {
      const { data } = await http.get<BankListResponse>(
        `${API_PREFIX}/c/${slug}/question-banks`,
        { params: query },
      );
      return data;
    },
    pullIntoExam: async (
      slug: string,
      body: BankPullIntoExamRequest,
    ): Promise<BankPullIntoExamResponse> => {
      const { data } = await http.post<BankPullIntoExamResponse>(
        `${API_PREFIX}/c/${slug}/question-banks/pull-into-exam`,
        body,
      );
      return data;
    },
    aiGenerate: async (
      slug: string,
      body: AiGenerateQuestionsRequest,
    ): Promise<AiGenerateQuestionsResponse> => {
      const { data } = await http.post<AiGenerateQuestionsResponse>(
        `${API_PREFIX}/c/${slug}/question-banks/ai-generate`,
        body,
      );
      return data;
    },
    aiGenerateExam: async (
      slug: string,
      body: AiGenerateExamRequest,
    ): Promise<AiGenerateExamResponse> => {
      const { data } = await http.post<AiGenerateExamResponse>(
        `${API_PREFIX}/c/${slug}/question-banks/ai-generate-exam`,
        body,
      );
      return data;
    },
  },

  /**
   * College essay AUTHORING (Phase 4c-ii) — tenant-scoped over the REUSED essay
   * engine. Mirrors `adminEssayTopics` for the shared authoring surface (topic
   * CRUD + keyword generation) so the same editor dialog drives both via an
   * injected adapter (see lib/essay-authoring-api.ts); the college-specific bits
   * are org-unit targeting + a draft→published lifecycle + tenant-scoped results.
   * Requires the `essays` feature (faculty scope enforced server-side).
   */
  collegeEssayTopics: {
    list: async (slug: string): Promise<CollegeEssayListResponse> => {
      const { data } = await http.get<CollegeEssayListResponse>(
        `${API_PREFIX}/c/${slug}/essay-topics`,
      );
      return data;
    },
    create: async (
      slug: string,
      body: CreateCollegeEssayInput,
    ): Promise<AdminEssayTopic> => {
      const { data } = await http.post<AdminEssayTopic>(
        `${API_PREFIX}/c/${slug}/essay-topics`,
        body,
      );
      return data;
    },
    get: async (slug: string, id: string): Promise<AdminEssayTopic> => {
      const { data } = await http.get<AdminEssayTopic>(
        `${API_PREFIX}/c/${slug}/essay-topics/${id}`,
      );
      return data;
    },
    update: async (
      slug: string,
      id: string,
      body: CreateCollegeEssayInput,
    ): Promise<AdminEssayTopic> => {
      const { data } = await http.patch<AdminEssayTopic>(
        `${API_PREFIX}/c/${slug}/essay-topics/${id}`,
        body,
      );
      return data;
    },
    setPublished: async (
      slug: string,
      id: string,
      isPublished: boolean,
    ): Promise<AdminEssayTopic> => {
      const { data } = await http.post<AdminEssayTopic>(
        `${API_PREFIX}/c/${slug}/essay-topics/${id}/publish`,
        { isPublished },
      );
      return data;
    },
    remove: async (slug: string, id: string): Promise<{ deleted: true }> => {
      const { data } = await http.delete<{ deleted: true }>(
        `${API_PREFIX}/c/${slug}/essay-topics/${id}`,
      );
      return data;
    },
    results: async (
      slug: string,
      id: string,
    ): Promise<CollegeEssayResultsResponse> => {
      const { data } = await http.get<CollegeEssayResultsResponse>(
        `${API_PREFIX}/c/${slug}/essay-topics/${id}/results`,
      );
      return data;
    },
    /** Faculty on-demand AI Scoring & Feedback for one attempt. */
    aiFeedback: async (
      slug: string,
      attemptId: string,
    ): Promise<EssayAiFeedbackResponse> => {
      const { data } = await http.post<EssayAiFeedbackResponse>(
        `${API_PREFIX}/c/${slug}/essays/${attemptId}/ai-feedback`,
      );
      return data;
    },
    generateKeywords: async (
      slug: string,
      body: GenerateKeywordsRequest,
    ): Promise<GenerateKeywordsResponse> => {
      const { data } = await http.post<GenerateKeywordsResponse>(
        `${API_PREFIX}/c/${slug}/essay-topics/generate-keywords`,
        body,
      );
      return data;
    },
  },

  /**
   * College essay WRITING (Phase 4c-ii) — the student surface. Same DTOs as the
   * individual `api.essays` (so the same list card + writer reuse it); only the
   * list/detail/draft/submit/submissions are tenant-scoped. The grading-status
   * POLL + analytics stay on the SHARED `api.essays` endpoints (authorized by
   * attempt ownership), so a college attempt rides them unchanged.
   */
  collegeEssays: {
    studentList: async (slug: string): Promise<EssayListResponse> => {
      const { data } = await http.get<EssayListResponse>(
        `${API_PREFIX}/c/${slug}/essays`,
      );
      return data;
    },
    detail: async (slug: string, id: string): Promise<EssayPromptDetail> => {
      const { data } = await http.get<EssayPromptDetail>(
        `${API_PREFIX}/c/${slug}/essays/${id}`,
      );
      return data;
    },
    draftGet: async (slug: string, id: string): Promise<EssayDraftResponse> => {
      const { data } = await http.get<EssayDraftResponse>(
        `${API_PREFIX}/c/${slug}/essays/${id}/draft`,
      );
      return data;
    },
    draftPut: async (
      slug: string,
      id: string,
      content: string,
    ): Promise<SaveEssayDraftResponse> => {
      const { data } = await http.put<SaveEssayDraftResponse>(
        `${API_PREFIX}/c/${slug}/essays/${id}/draft`,
        { content },
      );
      return data;
    },
    submit: async (
      slug: string,
      id: string,
      content: string,
      integrity?: EssayIntegrity,
    ): Promise<JobRef> => {
      const { data } = await http.post<JobRef>(
        `${API_PREFIX}/c/${slug}/essays/${id}/submit`,
        integrity ? { content, integrity } : { content },
      );
      return data;
    },
    submissions: async (
      slug: string,
      id: string,
    ): Promise<EssaySubmissionListResponse> => {
      const { data } = await http.get<EssaySubmissionListResponse>(
        `${API_PREFIX}/c/${slug}/essays/${id}/submissions`,
      );
      return data;
    },
  },

  /**
   * College challenges (Phase 4d) — a tenant-scoped LEADERBOARD over the shared
   * daily-challenge engine (no per-college authoring/assignment: the daily
   * challenge is global). Requires the `challenges` feature; an operator view of
   * the college's own students' standings.
   */
  collegeChallenges: {
    leaderboard: async (
      slug: string,
      query: { page?: number; pageSize?: number } = {},
    ): Promise<CollegeChallengeLeaderboardResponse> => {
      const { data } = await http.get<CollegeChallengeLeaderboardResponse>(
        `${API_PREFIX}/c/${slug}/challenges/leaderboard`,
        { params: query },
      );
      return data;
    },
  },

  /**
   * College analytics (Phase 5a-ii) — tenant + faculty-scoped READ-ONLY rollups
   * of student performance (exams/essays/courses/challenges) three ways. Requires
   * the `analytics` feature; the backend enforces faculty org-unit scope.
   */
  collegeAnalytics: {
    overview: async (slug: string): Promise<CollegeAnalyticsOverview> => {
      const { data } = await http.get<CollegeAnalyticsOverview>(
        `${API_PREFIX}/c/${slug}/analytics/overview`,
      );
      return data;
    },
    byOrgUnit: async (
      slug: string,
    ): Promise<CollegeAnalyticsByUnitResponse> => {
      const { data } = await http.get<CollegeAnalyticsByUnitResponse>(
        `${API_PREFIX}/c/${slug}/analytics/by-org-unit`,
      );
      return data;
    },
    student: async (
      slug: string,
      studentId: string,
    ): Promise<CollegeAnalyticsStudent> => {
      const { data } = await http.get<CollegeAnalyticsStudent>(
        `${API_PREFIX}/c/${slug}/analytics/students/${studentId}`,
      );
      return data;
    },
  },

  /**
   * College postings AUTHORING + the student browse/apply surface (Phase 5b) —
   * tenant-scoped over the REUSED careers engine. Mirrors `adminCareers` for the
   * shared authoring surface (posting CRUD + applications review) so the same
   * PostingEditorDialog drives both via an injected adapter (see
   * lib/careers-authoring-api.ts); the college-specific bits are org-unit
   * targeting + a draft→published lifecycle. Requires the `postings` feature
   * (faculty scope enforced server-side).
   */
  collegeCareers: {
    // --- Authoring (faculty/college_admin) ---
    list: async (slug: string): Promise<CollegePostingListResponse> => {
      const { data } = await http.get<CollegePostingListResponse>(
        `${API_PREFIX}/c/${slug}/postings`,
      );
      return data;
    },
    get: async (slug: string, id: string): Promise<AdminPosting> => {
      const { data } = await http.get<AdminPosting>(
        `${API_PREFIX}/c/${slug}/postings/${id}`,
      );
      return data;
    },
    create: async (
      slug: string,
      body: CreateCollegePostingInput,
    ): Promise<AdminPosting> => {
      const { data } = await http.post<AdminPosting>(
        `${API_PREFIX}/c/${slug}/postings`,
        body,
      );
      return data;
    },
    update: async (
      slug: string,
      id: string,
      body: CreateCollegePostingInput,
    ): Promise<AdminPosting> => {
      const { data } = await http.patch<AdminPosting>(
        `${API_PREFIX}/c/${slug}/postings/${id}`,
        body,
      );
      return data;
    },
    setPublished: async (
      slug: string,
      id: string,
      isPublished: boolean,
    ): Promise<CollegePostingSummary> => {
      const { data } = await http.post<CollegePostingSummary>(
        `${API_PREFIX}/c/${slug}/postings/${id}/publish`,
        { isPublished },
      );
      return data;
    },
    remove: async (slug: string, id: string): Promise<{ deleted: true }> => {
      const { data } = await http.delete<{ deleted: true }>(
        `${API_PREFIX}/c/${slug}/postings/${id}`,
      );
      return data;
    },
    applications: async (
      slug: string,
      id: string,
    ): Promise<AdminApplicationListResponse> => {
      const { data } = await http.get<AdminApplicationListResponse>(
        `${API_PREFIX}/c/${slug}/postings/${id}/applications`,
      );
      return data;
    },
    updateApplicationStatus: async (
      slug: string,
      appId: string,
      status: JobApplicationStatus,
    ): Promise<{ id: string; status: JobApplicationStatus }> => {
      const { data } = await http.patch<{
        id: string;
        status: JobApplicationStatus;
      }>(`${API_PREFIX}/c/${slug}/posting-applications/${appId}`, { status });
      return data;
    },
    // --- Student browse + apply (member; ?c=<slug> seam on the learner pages) ---
    studentList: async (
      slug: string,
    ): Promise<CollegeStudentPostingListResponse> => {
      const { data } = await http.get<CollegeStudentPostingListResponse>(
        `${API_PREFIX}/c/${slug}/careers`,
      );
      return data;
    },
    studentGet: async (slug: string, id: string): Promise<PostingDetail> => {
      const { data } = await http.get<PostingDetail>(
        `${API_PREFIX}/c/${slug}/careers/${id}`,
      );
      return data;
    },
    studentApply: async (
      slug: string,
      id: string,
      body: ApplyRequest,
    ): Promise<ApplicationResponse> => {
      const { data } = await http.post<ApplicationResponse>(
        `${API_PREFIX}/c/${slug}/careers/${id}/apply`,
        body,
      );
      return data;
    },
  },

  adminEssayTopics: {
    list: async (): Promise<AdminEssayTopicListResponse> => {
      const { data } = await http.get<AdminEssayTopicListResponse>(
        `${API_PREFIX}/admin/essay-topics`,
      );
      return data;
    },
    get: async (id: string): Promise<AdminEssayTopic> => {
      const { data } = await http.get<AdminEssayTopic>(
        `${API_PREFIX}/admin/essay-topics/${id}`,
      );
      return data;
    },
    create: async (body: AdminEssayTopicUpsert): Promise<AdminEssayTopic> => {
      const { data } = await http.post<AdminEssayTopic>(
        `${API_PREFIX}/admin/essay-topics`,
        body,
      );
      return data;
    },
    update: async (
      id: string,
      body: AdminEssayTopicUpsert,
    ): Promise<AdminEssayTopic> => {
      const { data } = await http.patch<AdminEssayTopic>(
        `${API_PREFIX}/admin/essay-topics/${id}`,
        body,
      );
      return data;
    },
    setActive: async (id: string, isActive: boolean): Promise<AdminEssayTopic> => {
      const { data } = await http.post<AdminEssayTopic>(
        `${API_PREFIX}/admin/essay-topics/${id}/active`,
        { isActive },
      );
      return data;
    },
    remove: async (id: string): Promise<{ deleted: true }> => {
      const { data } = await http.delete<{ deleted: true }>(
        `${API_PREFIX}/admin/essay-topics/${id}`,
      );
      return data;
    },
    /** Propose semantic keywords (LLM-assisted; deterministic fallback). */
    generateKeywords: async (
      body: GenerateKeywordsRequest,
    ): Promise<GenerateKeywordsResponse> => {
      const { data } = await http.post<GenerateKeywordsResponse>(
        `${API_PREFIX}/admin/essay-topics/generate-keywords`,
        body,
      );
      return data;
    },
  },

  adminChallenges: {
    list: async (): Promise<AdminChallengeListResponse> => {
      const { data } = await http.get<AdminChallengeListResponse>(
        `${API_PREFIX}/admin/challenges`,
      );
      return data;
    },
    get: async (id: string): Promise<AdminChallenge> => {
      const { data } = await http.get<AdminChallenge>(
        `${API_PREFIX}/admin/challenges/${id}`,
      );
      return data;
    },
    create: async (body: AdminChallengeUpsert): Promise<AdminChallenge> => {
      const { data } = await http.post<AdminChallenge>(
        `${API_PREFIX}/admin/challenges`,
        body,
      );
      return data;
    },
    update: async (
      id: string,
      body: AdminChallengeUpsert,
    ): Promise<AdminChallenge> => {
      const { data } = await http.patch<AdminChallenge>(
        `${API_PREFIX}/admin/challenges/${id}`,
        body,
      );
      return data;
    },
    remove: async (id: string): Promise<{ deleted: true }> => {
      const { data } = await http.delete<{ deleted: true }>(
        `${API_PREFIX}/admin/challenges/${id}`,
      );
      return data;
    },
    bulkImport: async (
      fileBase64: string,
      startDate?: string,
    ): Promise<AdminChallengeBulkImportResponse> => {
      const { data } = await http.post<AdminChallengeBulkImportResponse>(
        `${API_PREFIX}/admin/challenges/bulk-import`,
        { fileBase64, ...(startDate ? { startDate } : {}) },
      );
      return data;
    },
    /** Download the ready-to-fill daily-challenge .xlsx template. */
    bulkImportTemplate: async (): Promise<{ blob: Blob; filename: string }> => {
      const res = await http.get(
        `${API_PREFIX}/admin/challenges/bulk-import-template`,
        { responseType: "blob" },
      );
      const disposition = String(res.headers["content-disposition"] ?? "");
      const match = /filename="?([^"]+)"?/.exec(disposition);
      return {
        blob: res.data as Blob,
        filename: match?.[1] ?? "daily-challenges-template.xlsx",
      };
    },
    /**
     * Re-run the automatic generator for a day (optional oversight). Enqueues a
     * worker job (AI + validate-by-execution, else bank/curated fallback) and
     * returns 202; `force` (default true) replaces any existing challenge.
     */
    regenerate: async (
      releaseDate: string,
      force = true,
    ): Promise<RegenerateDailyChallengeResponse> => {
      const { data } = await http.post<RegenerateDailyChallengeResponse>(
        `${API_PREFIX}/admin/challenges/regenerate`,
        { releaseDate, force },
      );
      return data;
    },
    /** Draft a challenge (CODE or MCQ) with AI to pre-fill the editor. */
    aiBuild: async (
      topic?: string,
      questionType?: DailyQuestionType,
    ): Promise<AiBuildChallengeResponse> => {
      const { data } = await http.post<AiBuildChallengeResponse>(
        `${API_PREFIX}/admin/challenges/ai-build`,
        {
          ...(topic ? { topic } : {}),
          ...(questionType ? { questionType } : {}),
        },
      );
      return data;
    },
  },

  adminUsers: {
    list: async (
      params: Partial<AdminUserListQuery> = {},
    ): Promise<AdminUserListResponse> => {
      const { data } = await http.get<AdminUserListResponse>(
        `${API_PREFIX}/admin/users`,
        { params },
      );
      return data;
    },
    get: async (id: string): Promise<AdminUserDetail> => {
      const { data } = await http.get<AdminUserDetail>(
        `${API_PREFIX}/admin/users/${id}`,
      );
      return data;
    },
    setActive: async (
      id: string,
      isActive: boolean,
    ): Promise<AdminUserDetail> => {
      const { data } = await http.post<AdminUserDetail>(
        `${API_PREFIX}/admin/users/${id}/active`,
        { isActive },
      );
      return data;
    },
    setRole: async (id: string, role: Role): Promise<AdminUserDetail> => {
      const { data } = await http.post<AdminUserDetail>(
        `${API_PREFIX}/admin/users/${id}/role`,
        { role },
      );
      return data;
    },
    updateProfile: async (
      id: string,
      body: AdminUpdateProfile,
    ): Promise<AdminUserDetail> => {
      const { data } = await http.patch<AdminUserDetail>(
        `${API_PREFIX}/admin/users/${id}/profile`,
        body,
      );
      return data;
    },
    unenroll: async (
      id: string,
      enrollmentId: string,
    ): Promise<AdminUserDetail> => {
      const { data } = await http.delete<AdminUserDetail>(
        `${API_PREFIX}/admin/users/${id}/enrollments/${enrollmentId}`,
      );
      return data;
    },
    resetPassword: async (id: string): Promise<void> => {
      await http.post(`${API_PREFIX}/admin/users/${id}/reset-password`);
    },
    /** Download the per-college performance workbook as a blob (auth cookie rides along). */
    performanceBlob: async (): Promise<{ blob: Blob; filename: string }> => {
      const res = await http.get(
        `${API_PREFIX}/admin/users/college-performance.xlsx`,
        { responseType: "blob" },
      );
      const disposition = String(res.headers["content-disposition"] ?? "");
      const match = /filename="?([^"]+)"?/.exec(disposition);
      return {
        blob: res.data as Blob,
        filename: match?.[1] ?? "college-performance.xlsx",
      };
    },
  },

  adminEssayAnalytics: {
    list: async (
      params: Partial<AdminEssayAnalyticsListQuery> = {},
    ): Promise<AdminEssayAnalyticsListResponse> => {
      const { data } = await http.get<AdminEssayAnalyticsListResponse>(
        `${API_PREFIX}/admin/essay-analytics`,
        { params },
      );
      return data;
    },
    get: async (attemptId: string): Promise<AdminEssayAttemptAnalytics> => {
      const { data } = await http.get<AdminEssayAttemptAnalytics>(
        `${API_PREFIX}/admin/essay-analytics/${attemptId}`,
      );
      return data;
    },
  },

  adminOrders: {
    list: async (
      params: Partial<AdminOrderListQuery> = {},
    ): Promise<AdminOrderListResponse> => {
      const { data } = await http.get<AdminOrderListResponse>(
        `${API_PREFIX}/admin/orders`,
        { params },
      );
      return data;
    },
    get: async (id: string): Promise<AdminOrderDetail> => {
      const { data } = await http.get<AdminOrderDetail>(
        `${API_PREFIX}/admin/orders/${id}`,
      );
      return data;
    },
  },

  uploads: {
    /** Ask the API for a short-lived Cloudinary upload signature (admin-only). */
    signature: async (): Promise<UploadSignatureResponse> => {
      const { data } = await http.post<UploadSignatureResponse>(
        `${API_PREFIX}/admin/uploads/signature`,
      );
      return data;
    },
    /**
     * Tenant-scoped upload signature for college authoring surfaces (exam
     * question images, posting logos, …) — same signature, faculty/college_admin
     * guard instead of platform-admin.
     */
    collegeSignature: async (
      slug: string,
    ): Promise<UploadSignatureResponse> => {
      const { data } = await http.post<UploadSignatureResponse>(
        `${API_PREFIX}/c/${slug}/uploads/signature`,
      );
      return data;
    },
  },

  adminExams: {
    /** Every exam (regardless of enrollment) with cheap section/question counts. */
    list: async (): Promise<AdminExamListResponse> => {
      const { data } = await http.get<AdminExamListResponse>(
        `${API_PREFIX}/admin/exams`,
      );
      return data;
    },
    /** Full authored exam tree (sections → questions → test cases), incl. answers. */
    get: async (examId: string): Promise<AdminExamDetail> => {
      const { data } = await http.get<AdminExamDetail>(
        `${API_PREFIX}/admin/exams/${examId}`,
      );
      return data;
    },
    /** Create/update an exam (upsert, keyed by its Topic). Returns the tree. */
    upsert: async (body: AdminExamUpsert): Promise<AdminExamDetail> => {
      const { data } = await http.post<AdminExamDetail>(
        `${API_PREFIX}/admin/exams`,
        body,
      );
      return data;
    },
    deleteExam: async (examId: string): Promise<{ deleted: true }> => {
      const { data } = await http.delete<{ deleted: true }>(
        `${API_PREFIX}/admin/exams/${examId}`,
      );
      return data;
    },
    createSection: async (
      examId: string,
      body: AdminSectionUpsert,
    ): Promise<AdminExamDetail> => {
      const { data } = await http.post<AdminExamDetail>(
        `${API_PREFIX}/admin/exams/${examId}/sections`,
        body,
      );
      return data;
    },
    updateSection: async (
      sectionId: string,
      body: AdminSectionUpsert,
    ): Promise<AdminExamDetail> => {
      const { data } = await http.patch<AdminExamDetail>(
        `${API_PREFIX}/admin/sections/${sectionId}`,
        body,
      );
      return data;
    },
    deleteSection: async (sectionId: string): Promise<void> => {
      await http.delete(`${API_PREFIX}/admin/sections/${sectionId}`);
    },
    createQuestion: async (
      body: AdminQuestionUpsert,
    ): Promise<{ id: string }> => {
      const { data } = await http.post<{ id: string }>(
        `${API_PREFIX}/admin/exam-questions`,
        body,
      );
      return data;
    },
    updateQuestion: async (
      questionId: string,
      body: AdminQuestionUpsert,
    ): Promise<{ id: string }> => {
      const { data } = await http.patch<{ id: string }>(
        `${API_PREFIX}/admin/exam-questions/${questionId}`,
        body,
      );
      return data;
    },
    deleteQuestion: async (questionId: string): Promise<void> => {
      await http.delete(`${API_PREFIX}/admin/exam-questions/${questionId}`);
    },
    addTestCase: async (
      questionId: string,
      body: AdminTestCaseUpsert,
    ): Promise<{ id: string }> => {
      const { data } = await http.post<{ id: string }>(
        `${API_PREFIX}/admin/exam-questions/${questionId}/test-cases`,
        body,
      );
      return data;
    },
    updateTestCase: async (
      testCaseId: string,
      body: AdminTestCaseUpsert,
    ): Promise<{ id: string }> => {
      const { data } = await http.patch<{ id: string }>(
        `${API_PREFIX}/admin/test-cases/${testCaseId}`,
        body,
      );
      return data;
    },
    deleteTestCase: async (testCaseId: string): Promise<void> => {
      await http.delete(`${API_PREFIX}/admin/test-cases/${testCaseId}`);
    },
    // --- Power features (Step 2b) ---
    /** Bulk-upload MCQ or coding questions from a base64-encoded .xlsx workbook. */
    bulkUpload: async (
      examId: string,
      fileBase64: string,
      kind: ExamBulkUploadKind,
    ): Promise<ExcelUploadResponse> => {
      const { data } = await http.post<ExcelUploadResponse>(
        `${API_PREFIX}/admin/exams/${examId}/bulk-upload`,
        { fileBase64, kind },
      );
      return data;
    },
    /** Download the ready-to-fill MCQ or coding .xlsx template. */
    bulkUploadTemplate: async (
      kind: ExamBulkUploadKind,
    ): Promise<{ blob: Blob; filename: string }> => {
      const res = await http.get(
        `${API_PREFIX}/admin/exams/bulk-upload-template`,
        { params: { kind }, responseType: "blob" },
      );
      const disposition = String(res.headers["content-disposition"] ?? "");
      const match = /filename="?([^"]+)"?/.exec(disposition);
      return {
        blob: res.data as Blob,
        filename: match?.[1] ?? `${kind}-questions-template.xlsx`,
      };
    },
    createPublicLink: async (
      examId: string,
      body: AdminPublicLinkUpsert,
    ): Promise<PublicLink> => {
      const { data } = await http.post<PublicLink>(
        `${API_PREFIX}/admin/exams/${examId}/public-links`,
        body,
      );
      return data;
    },
    updatePublicLink: async (
      linkId: string,
      body: AdminPublicLinkUpsert,
    ): Promise<PublicLink> => {
      const { data } = await http.patch<PublicLink>(
        `${API_PREFIX}/admin/public-links/${linkId}`,
        body,
      );
      return data;
    },
    deletePublicLink: async (linkId: string): Promise<void> => {
      await http.delete(`${API_PREFIX}/admin/public-links/${linkId}`);
    },
    /** Download results for ONE public link (its anonymous takers only). */
    exportPublicLinkResults: async (
      linkId: string,
    ): Promise<{ blob: Blob; filename: string }> => {
      const res = await http.get(
        `${API_PREFIX}/admin/public-links/${linkId}/results.xlsx`,
        { responseType: "blob" },
      );
      const disposition = String(res.headers["content-disposition"] ?? "");
      const match = /filename="?([^"]+)"?/.exec(disposition);
      return {
        blob: res.data as Blob,
        filename: match?.[1] ?? "results.xlsx",
      };
    },
    /** Per-user attempt-counter reset (audited). Returns the reset counter. */
    resetAttempts: async (
      examId: string,
      body: AdminResetAttemptsRequest,
    ): Promise<{ attemptCount: number; maxAttempts: number }> => {
      const { data } = await http.post<{
        attemptCount: number;
        maxAttempts: number;
      }>(`${API_PREFIX}/admin/exams/${examId}/reset-attempts`, body);
      return data;
    },
    /** Attempt-management reads (item C4). */
    attemptCounters: async (
      examId: string,
    ): Promise<AdminExamAttemptCountersResponse> => {
      const { data } = await http.get<AdminExamAttemptCountersResponse>(
        `${API_PREFIX}/admin/exams/${examId}/attempt-counters`,
      );
      return data;
    },
    userAttempts: async (
      examId: string,
      userId: string,
    ): Promise<AdminUserExamAttemptsResponse> => {
      const { data } = await http.get<AdminUserExamAttemptsResponse>(
        `${API_PREFIX}/admin/exams/${examId}/users/${userId}/attempts`,
      );
      return data;
    },
    resetLog: async (examId: string): Promise<AdminExamResetLogResponse> => {
      const { data } = await http.get<AdminExamResetLogResponse>(
        `${API_PREFIX}/admin/exams/${examId}/reset-log`,
      );
      return data;
    },
    /** Download the results workbook as a blob (auth cookie rides along). */
    resultsBlob: async (
      examId: string,
    ): Promise<{ blob: Blob; filename: string }> => {
      const res = await http.get(
        `${API_PREFIX}/admin/exams/${examId}/results.xlsx`,
        { responseType: "blob" },
      );
      const disposition = String(res.headers["content-disposition"] ?? "");
      const match = /filename="?([^"]+)"?/.exec(disposition);
      return {
        blob: res.data as Blob,
        filename: match?.[1] ?? `results-${examId}.xlsx`,
      };
    },
  },

  adminCurriculum: {
    programs: {
      list: async (): Promise<AdminProgramListResponse> => {
        const { data } = await http.get<AdminProgramListResponse>(
          `${API_PREFIX}/admin/programs`,
        );
        return data;
      },
      get: async (id: string): Promise<AdminProgram> => {
        const { data } = await http.get<AdminProgram>(
          `${API_PREFIX}/admin/programs/${id}`,
        );
        return data;
      },
      create: async (body: AdminProgramUpsert): Promise<AdminProgram> => {
        const { data } = await http.post<AdminProgram>(
          `${API_PREFIX}/admin/programs`,
          body,
        );
        return data;
      },
      update: async (
        id: string,
        body: AdminProgramUpsert,
      ): Promise<AdminProgram> => {
        const { data } = await http.patch<AdminProgram>(
          `${API_PREFIX}/admin/programs/${id}`,
          body,
        );
        return data;
      },
      remove: async (id: string): Promise<{ deleted: true }> => {
        const { data } = await http.delete<{ deleted: true }>(
          `${API_PREFIX}/admin/programs/${id}`,
        );
        return data;
      },
      /** Reorder by supplying the full ordered id array (order = index). */
      reorder: async (ids: string[]): Promise<AdminProgramListResponse> => {
        const body: AdminReorder = { ids };
        const { data } = await http.post<AdminProgramListResponse>(
          `${API_PREFIX}/admin/programs/reorder`,
          body,
        );
        return data;
      },
    },
    subjects: {
      /** All subjects (admin projection); optionally filtered to one program. */
      list: async (programId?: string): Promise<AdminSubjectListResponse> => {
        const { data } = await http.get<AdminSubjectListResponse>(
          `${API_PREFIX}/admin/subjects`,
          { params: programId ? { programId } : {} },
        );
        return data;
      },
      get: async (id: string): Promise<AdminSubject> => {
        const { data } = await http.get<AdminSubject>(
          `${API_PREFIX}/admin/subjects/${id}`,
        );
        return data;
      },
      create: async (body: AdminSubjectUpsert): Promise<AdminSubject> => {
        const { data } = await http.post<AdminSubject>(
          `${API_PREFIX}/admin/subjects`,
          body,
        );
        return data;
      },
      update: async (
        id: string,
        body: AdminSubjectUpsert,
      ): Promise<AdminSubject> => {
        const { data } = await http.patch<AdminSubject>(
          `${API_PREFIX}/admin/subjects/${id}`,
          body,
        );
        return data;
      },
      remove: async (id: string): Promise<{ deleted: true }> => {
        const { data } = await http.delete<{ deleted: true }>(
          `${API_PREFIX}/admin/subjects/${id}`,
        );
        return data;
      },
      /** Recompute existing enrollments' expiry from this course's validity. */
      recomputeExpiry: async (
        id: string,
      ): Promise<RecomputeExpiryResponse> => {
        const { data } = await http.post<RecomputeExpiryResponse>(
          `${API_PREFIX}/admin/subjects/${id}/recompute-expiry`,
        );
        return data;
      },
    },
    modules: {
      /** Modules under a subject (ordered). */
      list: async (subjectId: string): Promise<AdminModuleListResponse> => {
        const { data } = await http.get<AdminModuleListResponse>(
          `${API_PREFIX}/admin/subjects/${subjectId}/modules`,
        );
        return data;
      },
      create: async (
        subjectId: string,
        body: AdminModuleUpsert,
      ): Promise<AdminModule> => {
        const { data } = await http.post<AdminModule>(
          `${API_PREFIX}/admin/subjects/${subjectId}/modules`,
          body,
        );
        return data;
      },
      update: async (
        moduleId: string,
        body: AdminModuleUpsert,
      ): Promise<AdminModule> => {
        const { data } = await http.patch<AdminModule>(
          `${API_PREFIX}/admin/modules/${moduleId}`,
          body,
        );
        return data;
      },
      remove: async (moduleId: string): Promise<{ deleted: true }> => {
        const { data } = await http.delete<{ deleted: true }>(
          `${API_PREFIX}/admin/modules/${moduleId}`,
        );
        return data;
      },
      /** Reorder a subject's modules by the full ordered id array. */
      reorder: async (
        subjectId: string,
        ids: string[],
      ): Promise<AdminModuleListResponse> => {
        const body: AdminReorder = { ids };
        const { data } = await http.post<AdminModuleListResponse>(
          `${API_PREFIX}/admin/subjects/${subjectId}/modules/reorder`,
          body,
        );
        return data;
      },
    },
    topics: {
      /** Topics under a module (ordered). */
      list: async (moduleId: string): Promise<AdminTopicListResponse> => {
        const { data } = await http.get<AdminTopicListResponse>(
          `${API_PREFIX}/admin/modules/${moduleId}/topics`,
        );
        return data;
      },
      get: async (topicId: string): Promise<AdminTopic> => {
        const { data } = await http.get<AdminTopic>(
          `${API_PREFIX}/admin/topics/${topicId}`,
        );
        return data;
      },
      create: async (
        moduleId: string,
        body: AdminTopicUpsert,
      ): Promise<AdminTopic> => {
        const { data } = await http.post<AdminTopic>(
          `${API_PREFIX}/admin/modules/${moduleId}/topics`,
          body,
        );
        return data;
      },
      update: async (
        topicId: string,
        body: AdminTopicUpsert,
      ): Promise<AdminTopic> => {
        const { data } = await http.patch<AdminTopic>(
          `${API_PREFIX}/admin/topics/${topicId}`,
          body,
        );
        return data;
      },
      remove: async (topicId: string): Promise<{ deleted: true }> => {
        const { data } = await http.delete<{ deleted: true }>(
          `${API_PREFIX}/admin/topics/${topicId}`,
        );
        return data;
      },
      /** Reorder a module's topics by the full ordered id array. */
      reorder: async (
        moduleId: string,
        ids: string[],
      ): Promise<AdminTopicListResponse> => {
        const body: AdminReorder = { ids };
        const { data } = await http.post<AdminTopicListResponse>(
          `${API_PREFIX}/admin/modules/${moduleId}/topics/reorder`,
          body,
        );
        return data;
      },
      /** Bulk-import text/video topics from a base64 .xlsx (per-row report). */
      bulkUpload: async (
        subjectId: string,
        fileBase64: string,
      ): Promise<TopicExcelUploadResponse> => {
        const { data } = await http.post<TopicExcelUploadResponse>(
          `${API_PREFIX}/admin/subjects/${subjectId}/topics/bulk-upload`,
          { fileBase64 },
        );
        return data;
      },
      /** Download the ready-to-fill topics .xlsx template. */
      bulkUploadTemplate: async (): Promise<{
        blob: Blob;
        filename: string;
      }> => {
        const res = await http.get(`${API_PREFIX}/admin/topics/import-template`, {
          responseType: "blob",
        });
        const disposition = String(res.headers["content-disposition"] ?? "");
        const match = /filename="?([^"]+)"?/.exec(disposition);
        return {
          blob: res.data as Blob,
          filename: match?.[1] ?? "topics-template.xlsx",
        };
      },
    },
    questions: {
      /** Quiz questions (with their choices) for a quiz-type topic. */
      list: async (
        topicId: string,
      ): Promise<AdminQuizQuestionListResponse> => {
        const { data } = await http.get<AdminQuizQuestionListResponse>(
          `${API_PREFIX}/admin/topics/${topicId}/questions`,
        );
        return data;
      },
      create: async (
        topicId: string,
        body: AdminQuizQuestionUpsert,
      ): Promise<AdminQuizQuestion> => {
        const { data } = await http.post<AdminQuizQuestion>(
          `${API_PREFIX}/admin/topics/${topicId}/questions`,
          body,
        );
        return data;
      },
      update: async (
        questionId: string,
        body: AdminQuizQuestionUpsert,
      ): Promise<AdminQuizQuestion> => {
        const { data } = await http.patch<AdminQuizQuestion>(
          `${API_PREFIX}/admin/questions/${questionId}`,
          body,
        );
        return data;
      },
      remove: async (questionId: string): Promise<{ deleted: true }> => {
        const { data } = await http.delete<{ deleted: true }>(
          `${API_PREFIX}/admin/questions/${questionId}`,
        );
        return data;
      },
    },
    /** Exam-type topics with Subject›Module›Topic labels — feeds the exam picker. */
    examTopics: {
      list: async (): Promise<AdminExamTopicListResponse> => {
        const { data } = await http.get<AdminExamTopicListResponse>(
          `${API_PREFIX}/admin/exam-topics`,
        );
        return data;
      },
    },
    enrollments: {
      /** Provision + enroll students from a base64 .xlsx roster (per-row report). */
      bulkUpload: async (
        subjectIds: string[],
        fileBase64: string,
      ): Promise<BulkEnrollResponse> => {
        const { data } = await http.post<BulkEnrollResponse>(
          `${API_PREFIX}/admin/enrollments/bulk-upload`,
          { subjectIds, fileBase64 },
        );
        return data;
      },
      /** Download the ready-to-fill bulk-enroll roster .xlsx template. */
      bulkUploadTemplate: async (): Promise<{
        blob: Blob;
        filename: string;
      }> => {
        const res = await http.get(
          `${API_PREFIX}/admin/enrollments/bulk-upload-template`,
          { responseType: "blob" },
        );
        const disposition = String(res.headers["content-disposition"] ?? "");
        const match = /filename="?([^"]+)"?/.exec(disposition);
        return {
          blob: res.data as Blob,
          filename: match?.[1] ?? "bulk-enroll-roster-template.xlsx",
        };
      },
      /** Paginated/filtered roster of a course's enrollments (admin). */
      list: async (
        subjectId: string,
        params: {
          q?: string;
          status?: "all" | "active" | "expired";
          college?: string;
          page?: number;
          pageSize?: number;
        },
      ): Promise<AdminEnrollmentListResponse> => {
        const { data } = await http.get<AdminEnrollmentListResponse>(
          `${API_PREFIX}/admin/subjects/${subjectId}/enrollments`,
          { params },
        );
        return data;
      },
      /** Distinct colleges present in this course's roster (filter options). */
      colleges: async (
        subjectId: string,
      ): Promise<AdminEnrollmentCollegesResponse> => {
        const { data } = await http.get<AdminEnrollmentCollegesResponse>(
          `${API_PREFIX}/admin/subjects/${subjectId}/enrollment-colleges`,
        );
        return data;
      },
      /** Enroll existing users (by id) into a course. */
      add: async (
        subjectId: string,
        userIds: string[],
      ): Promise<AdminEnrollmentAddResponse> => {
        const { data } = await http.post<AdminEnrollmentAddResponse>(
          `${API_PREFIX}/admin/subjects/${subjectId}/enrollments`,
          { userIds },
        );
        return data;
      },
      /** Remove enrollments (by user id) — college-assigned rows are protected. */
      remove: async (
        subjectId: string,
        userIds: string[],
      ): Promise<AdminEnrollmentRemoveResponse> => {
        const { data } = await http.delete<AdminEnrollmentRemoveResponse>(
          `${API_PREFIX}/admin/subjects/${subjectId}/enrollments`,
          { data: { userIds } },
        );
        return data;
      },
      /** Set/clear one enrollment's access expiry (null = lifetime). */
      setExpiry: async (
        subjectId: string,
        enrollmentId: string,
        expiresAt: string | null,
      ): Promise<{ updated: true }> => {
        const { data } = await http.patch<{ updated: true }>(
          `${API_PREFIX}/admin/subjects/${subjectId}/enrollments/${enrollmentId}`,
          { expiresAt },
        );
        return data;
      },
      /** Download the course's enrollment roster as .xlsx. */
      exportRoster: async (
        subjectId: string,
      ): Promise<{ blob: Blob; filename: string }> => {
        const res = await http.get(
          `${API_PREFIX}/admin/subjects/${subjectId}/enrollments/export.xlsx`,
          { responseType: "blob" },
        );
        const disposition = String(res.headers["content-disposition"] ?? "");
        const match = /filename="?([^"]+)"?/.exec(disposition);
        return {
          blob: res.data as Blob,
          filename: match?.[1] ?? "enrolments.xlsx",
        };
      },
    },
  },

  exams: {
    /** Exams the logged-in student can take. */
    list: async (): Promise<ExamListResponse> => {
      const { data } = await http.get<ExamListResponse>(`${API_PREFIX}/exams`);
      return data;
    },
    start: async (
      examId: string,
      accessCode?: string,
    ): Promise<StartAttemptResponse> => {
      const { data } = await http.post<StartAttemptResponse>(
        `${API_PREFIX}/exams/${examId}/attempts`,
        accessCode ? { accessCode } : undefined,
      );
      return data;
    },
    // --- Attempt engine. `token` (X-Attempt-Token) authorizes anonymous
    //     public takers; logged-in takers rely on the session cookie. ---
    section: async (
      attemptId: string,
      token?: string,
    ): Promise<AttemptSectionView> => {
      const { data } = await http.get<AttemptSectionView>(
        `${API_PREFIX}/attempts/${attemptId}/section`,
        attemptHeaders(token),
      );
      return data;
    },
    saveAnswers: async (
      attemptId: string,
      answers: AnswerInput[],
      token?: string,
      markedForReview?: string[],
    ): Promise<SaveSectionAnswersResponse> => {
      const { data } = await http.post<SaveSectionAnswersResponse>(
        `${API_PREFIX}/attempts/${attemptId}/section/answers`,
        markedForReview ? { answers, markedForReview } : { answers },
        attemptHeaders(token),
      );
      return data;
    },
    advance: async (
      attemptId: string,
      token?: string,
    ): Promise<AttemptSectionView> => {
      const { data } = await http.post<AttemptSectionView>(
        `${API_PREFIX}/attempts/${attemptId}/advance`,
        undefined,
        attemptHeaders(token),
      );
      return data;
    },
    submit: async (
      attemptId: string,
      auto: boolean,
      token?: string,
    ): Promise<ExamResult> => {
      const { data } = await http.post<ExamResult>(
        `${API_PREFIX}/attempts/${attemptId}/submit`,
        { auto },
        attemptHeaders(token),
      );
      return data;
    },
    finalize: async (
      attemptId: string,
      token?: string,
    ): Promise<ExamResult> => {
      const { data } = await http.post<ExamResult>(
        `${API_PREFIX}/attempts/${attemptId}/finalize`,
        undefined,
        attemptHeaders(token),
      );
      return data;
    },
    result: async (attemptId: string, token?: string): Promise<ExamResult> => {
      const { data } = await http.get<ExamResult>(
        `${API_PREFIX}/attempts/${attemptId}/result`,
        attemptHeaders(token),
      );
      return data;
    },
    warning: async (
      attemptId: string,
      token?: string,
    ): Promise<RecordWarningResponse> => {
      const { data } = await http.post<RecordWarningResponse>(
        `${API_PREFIX}/attempts/${attemptId}/warning`,
        undefined,
        attemptHeaders(token),
      );
      return data;
    },
    /** Record a play of the current section's comprehension audio stimulus. */
    stimulusPlay: async (
      attemptId: string,
      sectionId: string,
      token?: string,
    ): Promise<RecordStimulusPlayResponse> => {
      const { data } = await http.post<RecordStimulusPlayResponse>(
        `${API_PREFIX}/attempts/${attemptId}/sections/${sectionId}/stimulus-play`,
        undefined,
        attemptHeaders(token),
      );
      return data;
    },
    // --- Public (anonymous) ---
    publicAvailability: async (
      token: string,
    ): Promise<PublicExamAvailability> => {
      const { data } = await http.get<PublicExamAvailability>(
        `${API_PREFIX}/public/exams/${token}`,
      );
      return data;
    },
    publicStart: async (
      token: string,
      body: PublicStartRequest,
    ): Promise<StartAttemptResponse> => {
      const { data } = await http.post<StartAttemptResponse>(
        `${API_PREFIX}/public/exams/${token}/attempts`,
        body,
      );
      return data;
    },
  },

  /**
   * Gaming — course-attached discovery + the attempt lifecycle. The attempt
   * ENGINE (answer/advance/finish/explain/probe) is shared global regardless of
   * how the set was reached; only START differs (global for course-attached,
   * `collegeGames.start` for a tenant set). Mirrors the exam engine's shape.
   */
  games: {
    /** Course-attached sets reachable by the caller's enrollments (carry topicId). */
    list: async (): Promise<GamePlayListResponse> => {
      const { data } = await http.get<GamePlayListResponse>(
        `${API_PREFIX}/games`,
      );
      return data;
    },
    start: async (
      gameSetId: string,
      serve = true,
    ): Promise<StartGameSetResponse> => {
      const { data } = await http.post<StartGameSetResponse>(
        `${API_PREFIX}/game-sets/${gameSetId}/attempts`,
        { serve },
      );
      return data;
    },
    /** Serve the current game's first item + start its clock (deferred flow). */
    begin: async (
      attemptId: string,
      token?: string,
    ): Promise<BeginGameResponse> => {
      const { data } = await http.post<BeginGameResponse>(
        `${API_PREFIX}/game-attempts/${attemptId}/begin`,
        undefined,
        attemptHeaders(token),
      );
      return data;
    },
    /** Record a proctoring warning (may force-finish past the threshold). */
    warning: async (
      attemptId: string,
      token?: string,
    ): Promise<RecordGameWarningResponse> => {
      const { data } = await http.post<RecordGameWarningResponse>(
        `${API_PREFIX}/game-attempts/${attemptId}/warning`,
        undefined,
        attemptHeaders(token),
      );
      return data;
    },
    answer: async (
      attemptId: string,
      body: {
        itemIndex: number;
        action: "answer" | "skip" | "expire";
        submission?: unknown;
      },
      token?: string,
    ): Promise<AnswerGameItemResponse> => {
      const { data } = await http.post<AnswerGameItemResponse>(
        `${API_PREFIX}/game-attempts/${attemptId}/answer`,
        body,
        attemptHeaders(token),
      );
      return data;
    },
    advance: async (
      attemptId: string,
      token?: string,
      serve = true,
    ): Promise<AdvanceGameResponse> => {
      const { data } = await http.post<AdvanceGameResponse>(
        `${API_PREFIX}/game-attempts/${attemptId}/advance`,
        { serve },
        attemptHeaders(token),
      );
      return data;
    },
    finish: async (attemptId: string, token?: string): Promise<GameResult> => {
      const { data } = await http.post<GameResult>(
        `${API_PREFIX}/game-attempts/${attemptId}/finish`,
        undefined,
        attemptHeaders(token),
      );
      return data;
    },
    /** G3: re-read a finished attempt's result (composite + per-game breakdown). */
    result: async (attemptId: string, token?: string): Promise<GameResult> => {
      const { data } = await http.get<GameResult>(
        `${API_PREFIX}/game-attempts/${attemptId}/result`,
        attemptHeaders(token),
      );
      return data;
    },
    /** G3: the caller's OWN attempt history on a set (date, composite, status). */
    myAttempts: async (
      gameSetId: string,
    ): Promise<GameAttemptHistoryResponse> => {
      const { data } = await http.get<GameAttemptHistoryResponse>(
        `${API_PREFIX}/game-sets/${gameSetId}/attempts`,
      );
      return data;
    },
    explain: async (
      attemptId: string,
      itemIndex: number,
      token?: string,
    ): Promise<GameExplanationResponse> => {
      const { data } = await http.post<GameExplanationResponse>(
        `${API_PREFIX}/game-attempts/${attemptId}/explain`,
        { itemIndex },
        attemptHeaders(token),
      );
      return data;
    },
    /** Interactive move-by-move play (door_key; wired for 7c, unused by 7a). */
    probe: async (
      attemptId: string,
      body: { itemIndex: number; action: unknown },
      token?: string,
    ): Promise<ProbeGameItemResponse> => {
      const { data } = await http.post<ProbeGameItemResponse>(
        `${API_PREFIX}/game-attempts/${attemptId}/probe`,
        body,
        attemptHeaders(token),
      );
      return data;
    },
  },

  /** Tenant-scoped gaming: a college student's available published sets + the
   * tenant start (the shared engine above drives the rest). */
  collegeGames: {
    available: async (slug: string): Promise<GamePlayListResponse> => {
      const { data } = await http.get<GamePlayListResponse>(
        `${API_PREFIX}/c/${slug}/game-sets/available`,
      );
      return data;
    },
    start: async (
      slug: string,
      gameSetId: string,
      serve = true,
    ): Promise<StartGameSetResponse> => {
      const { data } = await http.post<StartGameSetResponse>(
        `${API_PREFIX}/c/${slug}/game-sets/${gameSetId}/attempts`,
        { serve },
      );
      return data;
    },
    // --- Authoring (faculty/college_admin + GAMING feature) ---
    list: async (slug: string): Promise<GameSetListResponse> => {
      const { data } = await http.get<GameSetListResponse>(
        `${API_PREFIX}/c/${slug}/game-sets`,
      );
      return data;
    },
    get: async (slug: string, id: string): Promise<GameSetDetail> => {
      const { data } = await http.get<GameSetDetail>(
        `${API_PREFIX}/c/${slug}/game-sets/${id}`,
      );
      return data;
    },
    create: async (slug: string, body: GameSetUpsert): Promise<GameSetDetail> => {
      const { data } = await http.post<GameSetDetail>(
        `${API_PREFIX}/c/${slug}/game-sets`,
        body,
      );
      return data;
    },
    update: async (
      slug: string,
      id: string,
      body: GameSetUpdate,
    ): Promise<GameSetDetail> => {
      const { data } = await http.patch<GameSetDetail>(
        `${API_PREFIX}/c/${slug}/game-sets/${id}`,
        body,
      );
      return data;
    },
    setPublished: async (
      slug: string,
      id: string,
      isPublished: boolean,
    ): Promise<GameSetDetail> => {
      const { data } = await http.post<GameSetDetail>(
        `${API_PREFIX}/c/${slug}/game-sets/${id}/publish`,
        { isPublished },
      );
      return data;
    },
    remove: async (slug: string, id: string): Promise<void> => {
      await http.delete(`${API_PREFIX}/c/${slug}/game-sets/${id}`);
    },
    templates: async (slug: string): Promise<GameSetListResponse> => {
      const { data } = await http.get<GameSetListResponse>(
        `${API_PREFIX}/c/${slug}/game-sets/templates`,
      );
      return data;
    },
    clone: async (
      slug: string,
      sourceId: string,
      title: string,
    ): Promise<GameSetDetail> => {
      const { data } = await http.post<GameSetDetail>(
        `${API_PREFIX}/c/${slug}/game-sets/${sourceId}/clone`,
        { title },
      );
      return data;
    },
    aiBuild: async (
      slug: string,
      body: AiBuildGameSetRequest,
    ): Promise<AiBuildGameSetResponse> => {
      const { data } = await http.post<AiBuildGameSetResponse>(
        `${API_PREFIX}/c/${slug}/game-sets/ai-build`,
        body,
      );
      return data;
    },
    // --- Operator visibility (Step 24 G2): attempt list + cohort + export ---
    attempts: async (
      slug: string,
      id: string,
    ): Promise<GameAttemptAdminList> => {
      const { data } = await http.get<GameAttemptAdminList>(
        `${API_PREFIX}/c/${slug}/game-sets/${id}/attempts`,
      );
      return data;
    },
    cohort: async (slug: string, id: string): Promise<GameCohortReport> => {
      const { data } = await http.get<GameCohortReport>(
        `${API_PREFIX}/c/${slug}/game-sets/${id}/cohort`,
      );
      return data;
    },
    exportCohort: async (
      slug: string,
      id: string,
    ): Promise<{ blob: Blob; filename: string }> => {
      const res = await http.get(
        `${API_PREFIX}/c/${slug}/game-sets/${id}/cohort/export`,
        { responseType: "blob" },
      );
      const disposition = String(res.headers["content-disposition"] ?? "");
      const match = /filename="?([^"]+)"?/.exec(disposition);
      return {
        blob: res.data as Blob,
        filename: match?.[1] ?? `gaming-${id}.xlsx`,
      };
    },
  },

  /**
   * Speaking (Communication A/B) — tenant-scoped. Student consumption (available
   * / start / submit-item / result) + college authoring (list/create/get/update/
   * publish/remove). Read-aloud only in Step 10.
   */
  collegeSpeaking: {
    available: async (slug: string): Promise<SpeakingPlayListResponse> => {
      const { data } = await http.get<SpeakingPlayListResponse>(
        `${API_PREFIX}/c/${slug}/speaking/available`,
      );
      return data;
    },
    /** Member-scoped Cloudinary signature for a student's recorded audio — the
     *  generic /uploads/signature route is faculty-only, so students 403 there. */
    uploadSignature: async (slug: string): Promise<UploadSignatureResponse> => {
      const { data } = await http.post<UploadSignatureResponse>(
        `${API_PREFIX}/c/${slug}/speaking/uploads/signature`,
      );
      return data;
    },
    start: async (
      slug: string,
      assessmentId: string,
    ): Promise<StartSpeakingResponse> => {
      const { data } = await http.post<StartSpeakingResponse>(
        `${API_PREFIX}/c/${slug}/speaking/${assessmentId}/attempts`,
      );
      return data;
    },
    submitItem: async (
      slug: string,
      attemptId: string,
      itemIndex: number,
      // Spoken items send { audioUrl }; dictation sends { text }; a silent/
      // skipped item sends { silent: true } so the server advances disclosure.
      payload: { audioUrl?: string; text?: string; silent?: boolean },
    ): Promise<SubmitSpeakingItemResponse> => {
      const { data } = await http.post<SubmitSpeakingItemResponse>(
        `${API_PREFIX}/c/${slug}/speaking/attempts/${attemptId}/items/${itemIndex}`,
        payload,
      );
      return data;
    },
    current: async (
      slug: string,
      attemptId: string,
    ): Promise<SpeakingCurrentResponse> => {
      const { data } = await http.get<SpeakingCurrentResponse>(
        `${API_PREFIX}/c/${slug}/speaking/attempts/${attemptId}/current`,
      );
      return data;
    },
    result: async (
      slug: string,
      attemptId: string,
    ): Promise<SpeakingAttemptResult> => {
      const { data } = await http.get<SpeakingAttemptResult>(
        `${API_PREFIX}/c/${slug}/speaking/attempts/${attemptId}/result`,
      );
      return data;
    },
    listAttempts: async (
      slug: string,
      assessmentId: string,
    ): Promise<SpeakingAttemptAdminList> => {
      const { data } = await http.get<SpeakingAttemptAdminList>(
        `${API_PREFIX}/c/${slug}/speaking/${assessmentId}/attempts`,
      );
      return data;
    },
    clearAttempt: async (
      slug: string,
      assessmentId: string,
      attemptId: string,
    ): Promise<void> => {
      await http.delete(
        `${API_PREFIX}/c/${slug}/speaking/${assessmentId}/attempts/${attemptId}`,
      );
    },
    // --- Authoring (faculty/college_admin + COMMUNICATION.speaking) ---
    list: async (slug: string): Promise<SpeakingAssessmentListResponse> => {
      const { data } = await http.get<SpeakingAssessmentListResponse>(
        `${API_PREFIX}/c/${slug}/speaking`,
      );
      return data;
    },
    get: async (
      slug: string,
      id: string,
    ): Promise<SpeakingAssessmentDetail> => {
      const { data } = await http.get<SpeakingAssessmentDetail>(
        `${API_PREFIX}/c/${slug}/speaking/${id}`,
      );
      return data;
    },
    create: async (
      slug: string,
      body: SpeakingAssessmentUpsert,
    ): Promise<SpeakingAssessmentDetail> => {
      const { data } = await http.post<SpeakingAssessmentDetail>(
        `${API_PREFIX}/c/${slug}/speaking`,
        body,
      );
      return data;
    },
    update: async (
      slug: string,
      id: string,
      body: SpeakingAssessmentUpsert,
    ): Promise<SpeakingAssessmentDetail> => {
      const { data } = await http.patch<SpeakingAssessmentDetail>(
        `${API_PREFIX}/c/${slug}/speaking/${id}`,
        body,
      );
      return data;
    },
    setPublished: async (
      slug: string,
      id: string,
      isPublished: boolean,
    ): Promise<SpeakingAssessmentDetail> => {
      const { data } = await http.post<SpeakingAssessmentDetail>(
        `${API_PREFIX}/c/${slug}/speaking/${id}/publish`,
        { isPublished },
      );
      return data;
    },
    remove: async (slug: string, id: string): Promise<void> => {
      await http.delete(`${API_PREFIX}/c/${slug}/speaking/${id}`);
    },
    /** Authoring-time TTS: render prompt TEXT to a hosted, fixed-voice clip. */
    generateTts: async (
      slug: string,
      text: string,
    ): Promise<SpeakingTtsResponse> => {
      const { data } = await http.post<SpeakingTtsResponse>(
        `${API_PREFIX}/c/${slug}/speaking/tts`,
        { text },
      );
      return data;
    },
  },

  /** Communication ASSESSMENT COMPOSITE (Step 21) — a container over existing
   *  exam/essay/speaking artifacts. Student consumption + college authoring. */
  collegeCommunication: {
    // --- Student consumption ---
    available: async (
      slug: string,
    ): Promise<CommunicationAvailableListResponse> => {
      const { data } = await http.get<CommunicationAvailableListResponse>(
        `${API_PREFIX}/c/${slug}/communication/assessments/available`,
      );
      return data;
    },
    student: async (
      slug: string,
      id: string,
    ): Promise<CommunicationStudentView> => {
      const { data } = await http.get<CommunicationStudentView>(
        `${API_PREFIX}/c/${slug}/communication/assessments/${id}/student`,
      );
      return data;
    },
    launchPart: async (
      slug: string,
      id: string,
      order: number,
    ): Promise<CommunicationLaunchResponse> => {
      const { data } = await http.post<CommunicationLaunchResponse>(
        `${API_PREFIX}/c/${slug}/communication/assessments/${id}/parts/${order}/launch`,
      );
      return data;
    },
    // --- Authoring (faculty/college_admin + COMMUNICATION.authoring) ---
    list: async (
      slug: string,
    ): Promise<CommunicationAssessmentListResponse> => {
      const { data } = await http.get<CommunicationAssessmentListResponse>(
        `${API_PREFIX}/c/${slug}/communication/assessments`,
      );
      return data;
    },
    get: async (
      slug: string,
      id: string,
    ): Promise<CommunicationAssessmentDetail> => {
      const { data } = await http.get<CommunicationAssessmentDetail>(
        `${API_PREFIX}/c/${slug}/communication/assessments/${id}`,
      );
      return data;
    },
    create: async (
      slug: string,
      body: CommunicationAssessmentUpsert,
    ): Promise<CommunicationAssessmentDetail> => {
      const { data } = await http.post<CommunicationAssessmentDetail>(
        `${API_PREFIX}/c/${slug}/communication/assessments`,
        body,
      );
      return data;
    },
    update: async (
      slug: string,
      id: string,
      body: CommunicationAssessmentUpsert,
    ): Promise<CommunicationAssessmentDetail> => {
      const { data } = await http.patch<CommunicationAssessmentDetail>(
        `${API_PREFIX}/c/${slug}/communication/assessments/${id}`,
        body,
      );
      return data;
    },
    setPublished: async (
      slug: string,
      id: string,
      isPublished: boolean,
    ): Promise<CommunicationAssessmentDetail> => {
      const { data } = await http.post<CommunicationAssessmentDetail>(
        `${API_PREFIX}/c/${slug}/communication/assessments/${id}/publish`,
        { isPublished },
      );
      return data;
    },
    remove: async (slug: string, id: string): Promise<void> => {
      await http.delete(
        `${API_PREFIX}/c/${slug}/communication/assessments/${id}`,
      );
    },
    cohort: async (
      slug: string,
      id: string,
    ): Promise<CommunicationCohortReport> => {
      const { data } = await http.get<CommunicationCohortReport>(
        `${API_PREFIX}/c/${slug}/communication/assessments/${id}/cohort`,
      );
      return data;
    },
    /** The ONE export — one row per student × parts × composite (auth header
     *  rides along via the http client; returns a blob to hand to a download). */
    exportCohort: async (
      slug: string,
      id: string,
    ): Promise<{ blob: Blob; filename: string }> => {
      const res = await http.get(
        `${API_PREFIX}/c/${slug}/communication/assessments/${id}/cohort/export`,
        { responseType: "blob" },
      );
      const disposition = String(res.headers["content-disposition"] ?? "");
      const match = /filename="?([^"]+)"?/.exec(disposition);
      return {
        blob: res.data as Blob,
        filename: match?.[1] ?? `communication-${id}.xlsx`,
      };
    },
  },

  /** Platform-admin GameSet authoring (college:null sets). */
  adminGameSets: {
    list: async (): Promise<GameSetListResponse> => {
      const { data } = await http.get<GameSetListResponse>(
        `${API_PREFIX}/admin/game-sets`,
      );
      return data;
    },
    get: async (id: string): Promise<GameSetDetail> => {
      const { data } = await http.get<GameSetDetail>(
        `${API_PREFIX}/admin/game-sets/${id}`,
      );
      return data;
    },
    create: async (body: GameSetUpsert): Promise<GameSetDetail> => {
      const { data } = await http.post<GameSetDetail>(
        `${API_PREFIX}/admin/game-sets`,
        body,
      );
      return data;
    },
    update: async (id: string, body: GameSetUpdate): Promise<GameSetDetail> => {
      const { data } = await http.patch<GameSetDetail>(
        `${API_PREFIX}/admin/game-sets/${id}`,
        body,
      );
      return data;
    },
    setPublished: async (
      id: string,
      isPublished: boolean,
    ): Promise<GameSetDetail> => {
      const { data } = await http.post<GameSetDetail>(
        `${API_PREFIX}/admin/game-sets/${id}/publish`,
        { isPublished },
      );
      return data;
    },
    remove: async (id: string): Promise<void> => {
      await http.delete(`${API_PREFIX}/admin/game-sets/${id}`);
    },
    aiBuild: async (
      body: AiBuildGameSetRequest,
    ): Promise<AiBuildGameSetResponse> => {
      const { data } = await http.post<AiBuildGameSetResponse>(
        `${API_PREFIX}/admin/game-sets/ai-build`,
        body,
      );
      return data;
    },
  },
};

/** Attach the X-Attempt-Token header for anonymous attempt authorization. */
function attemptHeaders(token?: string): { headers?: Record<string, string> } {
  return token ? { headers: { "X-Attempt-Token": token } } : {};
}
