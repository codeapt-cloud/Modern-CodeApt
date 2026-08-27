import { Role, isCollegeOperator, isCollegeStudent } from "@codeapt/shared";
import { Suspense, lazy, type ComponentType } from "react";
import { Navigate, Route, Routes } from "react-router-dom";

import { Spinner } from "./components/ui/spinner.js";
import { PublicLayout } from "./components/layout/PublicLayout.js";
import { AppLayout } from "./pages/AppLayout.js";
import { NotFoundPage } from "./pages/NotFoundPage.js";
import { api } from "./lib/api-client.js";
import { homePathForUser } from "./lib/home-nav.js";
import { useQuery } from "./lib/use-query.js";
import { useAuth } from "./providers/AuthProvider.js";
import { useCollege } from "./pages/colleges/college-context.js";
import { NoCollegeHome } from "./routes/NoCollegeHome.js";
import {
  ForcedPasswordChangeRoute,
  GuestOnlyRoute,
  ProtectedRoute,
  RequireAdmin,
  RequireCollegeMember,
} from "./routes/guards.js";

// Route-level code-splitting: each feature page is its own chunk, so the
// initial bundle stays small and grows lazily as the app expands.
const named = <T,>(load: () => Promise<Record<string, T>>, key: string) =>
  lazy(async () => {
    const mod = await load();
    return { default: mod[key] as ComponentType };
  });

const LoginPage = named(() => import("./pages/auth/LoginPage.js"), "LoginPage");
const BrandedLoginPage = named(
  () => import("./pages/auth/BrandedLoginPage.js"),
  "BrandedLoginPage",
);
const RegisterPage = named(
  () => import("./pages/auth/RegisterPage.js"),
  "RegisterPage",
);
const ForcedPasswordChangePage = named(
  () => import("./pages/auth/ForcedPasswordChangePage.js"),
  "ForcedPasswordChangePage",
);
const DashboardPage = named(
  () => import("./pages/DashboardPage.js"),
  "DashboardPage",
);
const HistoryPage = named(() => import("./pages/HistoryPage.js"), "HistoryPage");
const ChangePasswordPage = named(
  () => import("./pages/ChangePasswordPage.js"),
  "ChangePasswordPage",
);
const CatalogPage = named(
  () => import("./pages/CatalogPage.js"),
  "CatalogPage",
);
const CourseDetailPage = named(
  () => import("./pages/CourseDetailPage.js"),
  "CourseDetailPage",
);
const PlaygroundPage = named(
  () => import("./pages/PlaygroundPage.js"),
  "PlaygroundPage",
);
const DailyChallengePage = named(
  () => import("./pages/DailyChallengePage.js"),
  "DailyChallengePage",
);
const LeaderboardPage = named(
  () => import("./pages/LeaderboardPage.js"),
  "LeaderboardPage",
);
const PlayerPage = named(
  () => import("./pages/player/PlayerPage.js"),
  "PlayerPage",
);
const ExamsPage = named(() => import("./pages/exam/ExamsPage.js"), "ExamsPage");
const EssaysPage = named(
  () => import("./pages/essay/EssaysPage.js"),
  "EssaysPage",
);
const EssayWriterPage = named(
  () => import("./pages/essay/EssayWriterPage.js"),
  "EssayWriterPage",
);
const CheckoutPage = named(
  () => import("./pages/payments/CheckoutPage.js"),
  "CheckoutPage",
);
const PaymentReturnPage = named(
  () => import("./pages/payments/PaymentReturnPage.js"),
  "PaymentReturnPage",
);
const OrdersPage = named(
  () => import("./pages/payments/OrdersPage.js"),
  "OrdersPage",
);
const ExamRunnerPage = named(
  () => import("./pages/exam/ExamRunnerPage.js"),
  "ExamRunnerPage",
);
const GamesPage = named(() => import("./pages/game/GamesPage.js"), "GamesPage");
const GamePlayPage = named(
  () => import("./pages/game/GamePlayPage.js"),
  "GamePlayPage",
);
const PublicExamPage = named(
  () => import("./pages/exam/PublicExamPage.js"),
  "PublicExamPage",
);
const CareersPage = named(
  () => import("./pages/careers/CareersPage.js"),
  "CareersPage",
);
const PostingDetailPage = named(
  () => import("./pages/careers/PostingDetailPage.js"),
  "PostingDetailPage",
);
const MyApplicationsPage = named(
  () => import("./pages/careers/MyApplicationsPage.js"),
  "MyApplicationsPage",
);
const AdminCareersPage = named(
  () => import("./pages/careers/admin/AdminCareersPage.js"),
  "AdminCareersPage",
);
const AdminApplicationsPage = named(
  () => import("./pages/careers/admin/AdminApplicationsPage.js"),
  "AdminApplicationsPage",
);
const AdminExamsPage = named(
  () => import("./pages/exam/admin/AdminExamsPage.js"),
  "AdminExamsPage",
);
const AdminExamEditorPage = named(
  () => import("./pages/exam/admin/AdminExamEditorPage.js"),
  "AdminExamEditorPage",
);
const AdminGameSetsPage = named(
  () => import("./pages/game/admin/AdminGameSetsPage.js"),
  "AdminGameSetsPage",
);
const AdminGameSetEditorPage = named(
  () => import("./pages/game/admin/AdminGameSetEditorPage.js"),
  "AdminGameSetEditorPage",
);
const AdminSpeakingPage = named(
  () => import("./pages/speaking/admin/AdminSpeakingPage.js"),
  "AdminSpeakingPage",
);
const AdminCommunicationPage = named(
  () => import("./pages/communication/admin/AdminCommunicationPage.js"),
  "AdminCommunicationPage",
);
const AdminInterviewPage = named(
  () => import("./pages/interview/admin/AdminInterviewPage.js"),
  "AdminInterviewPage",
);
const InterviewRunnerPage = named(
  () => import("./pages/interview/InterviewRunnerPage.js"),
  "InterviewRunnerPage",
);
const SpeakingRunnerPage = named(
  () => import("./pages/speaking/SpeakingRunnerPage.js"),
  "SpeakingRunnerPage",
);
const CommunicationRunnerPage = named(
  () => import("./pages/communication/CommunicationRunnerPage.js"),
  "CommunicationRunnerPage",
);
const AdminCurriculumPage = named(
  () => import("./pages/curriculum/admin/AdminCurriculumPage.js"),
  "AdminCurriculumPage",
);
const AdminCouponsPage = named(
  () => import("./pages/coupons/admin/AdminCouponsPage.js"),
  "AdminCouponsPage",
);
const AdminEssayTopicsPage = named(
  () => import("./pages/essays/admin/AdminEssayTopicsPage.js"),
  "AdminEssayTopicsPage",
);
const AdminChallengesPage = named(
  () => import("./pages/challenges/admin/AdminChallengesPage.js"),
  "AdminChallengesPage",
);
const AdminUsersPage = named(
  () => import("./pages/users/admin/AdminUsersPage.js"),
  "AdminUsersPage",
);
const AdminQuestionBanksPage = named(
  () => import("./pages/question-banks/admin/AdminQuestionBanksPage.js"),
  "AdminQuestionBanksPage",
);
const AdminAiProvidersPage = named(
  () => import("./pages/ai-providers/AdminAiProvidersPage.js"),
  "AdminAiProvidersPage",
);
const AdminEssayAnalyticsPage = named(
  () => import("./pages/essays/admin/AdminEssayAnalyticsPage.js"),
  "AdminEssayAnalyticsPage",
);
const AdminOrdersPage = named(
  () => import("./pages/orders/admin/AdminOrdersPage.js"),
  "AdminOrdersPage",
);
const AdminCollegesPage = named(
  () => import("./pages/colleges/admin/AdminCollegesPage.js"),
  "AdminCollegesPage",
);
const CollegeManagePage = named(
  () => import("./pages/colleges/admin/CollegeManagePage.js"),
  "CollegeManagePage",
);
const AdminSubjectEditorPage = named(
  () => import("./pages/curriculum/admin/AdminSubjectEditorPage.js"),
  "AdminSubjectEditorPage",
);

// College workspace (Phase 2b) — the college_admin/faculty tenant space.
const CollegeLayout = named(
  () => import("./pages/colleges/CollegeLayout.js"),
  "CollegeLayout",
);
const CollegeDashboardPage = named(
  () => import("./pages/colleges/CollegeDashboardPage.js"),
  "CollegeDashboardPage",
);
const CollegeStudentDashboardPage = named(
  () => import("./pages/colleges/CollegeStudentDashboardPage.js"),
  "CollegeStudentDashboardPage",
);
const CollegeStudentCoursesPage = named(
  () => import("./pages/colleges/CollegeStudentCoursesPage.js"),
  "CollegeStudentCoursesPage",
);
const CollegeStudentExamsPage = named(
  () => import("./pages/colleges/CollegeStudentExamsPage.js"),
  "CollegeStudentExamsPage",
);
const CollegeStudentEssaysPage = named(
  () => import("./pages/colleges/CollegeStudentEssaysPage.js"),
  "CollegeStudentEssaysPage",
);
const CollegeStudentPlacementsPage = named(
  () => import("./pages/colleges/CollegeStudentPlacementsPage.js"),
  "CollegeStudentPlacementsPage",
);
const CollegeStudentResultsPage = named(
  () => import("./pages/colleges/CollegeStudentResultsPage.js"),
  "CollegeStudentResultsPage",
);
const CollegeStructurePage = named(
  () => import("./pages/colleges/CollegeStructurePage.js"),
  "CollegeStructurePage",
);
const CollegeFacultyPage = named(
  () => import("./pages/colleges/CollegeFacultyPage.js"),
  "CollegeFacultyPage",
);
const CollegeStudentsPage = named(
  () => import("./pages/colleges/CollegeStudentsPage.js"),
  "CollegeStudentsPage",
);
const CollegeAttendancePage = named(
  () => import("./pages/colleges/CollegeAttendancePage.js"),
  "CollegeAttendancePage",
);
const CollegeAttendanceGroupPage = named(
  () => import("./pages/colleges/CollegeAttendanceGroupPage.js"),
  "CollegeAttendanceGroupPage",
);
const CollegeTakeAttendancePage = named(
  () => import("./pages/colleges/CollegeTakeAttendancePage.js"),
  "CollegeTakeAttendancePage",
);
const CollegeAttendanceAnalyticsPage = named(
  () => import("./pages/colleges/CollegeAttendanceAnalyticsPage.js"),
  "CollegeAttendanceAnalyticsPage",
);
const CollegeStudentAttendancePage = named(
  () => import("./pages/colleges/CollegeStudentAttendancePage.js"),
  "CollegeStudentAttendancePage",
);
const CollegeCodingProfilePage = named(
  () => import("./pages/colleges/CollegeCodingProfilePage.js"),
  "CollegeCodingProfilePage",
);
const CollegeCodingLeaderboardPage = named(
  () => import("./pages/colleges/CollegeCodingLeaderboardPage.js"),
  "CollegeCodingLeaderboardPage",
);
const CollegeAiCreditsPage = named(
  () => import("./pages/colleges/CollegeAiCreditsPage.js"),
  "CollegeAiCreditsPage",
);
const CollegeStudentAiCreditsPage = named(
  () => import("./pages/colleges/CollegeStudentAiCreditsPage.js"),
  "CollegeStudentAiCreditsPage",
);
const CollegeCoursesPage = named(
  () => import("./pages/colleges/CollegeCoursesPage.js"),
  "CollegeCoursesPage",
);
const CollegeExamsPage = named(
  () => import("./pages/colleges/CollegeExamsPage.js"),
  "CollegeExamsPage",
);
const CollegeGamingPage = named(
  () => import("./pages/colleges/CollegeGamingPage.js"),
  "CollegeGamingPage",
);
const CollegeGameSetsPage = named(
  () => import("./pages/colleges/CollegeGameSetsPage.js"),
  "CollegeGameSetsPage",
);
const CollegeCommunicationPage = named(
  () => import("./pages/colleges/CollegeCommunicationPage.js"),
  "CollegeCommunicationPage",
);
const CollegeSpeakingPage = named(
  () => import("./pages/colleges/CollegeSpeakingPage.js"),
  "CollegeSpeakingPage",
);
const CollegeSpeakingEditorPage = named(
  () => import("./pages/colleges/CollegeSpeakingEditorPage.js"),
  "CollegeSpeakingEditorPage",
);
const CollegeCommunicationAssessmentsPage = named(
  () => import("./pages/colleges/CollegeCommunicationAssessmentsPage.js"),
  "CollegeCommunicationAssessmentsPage",
);
const CollegeCommunicationEditorPage = named(
  () => import("./pages/colleges/CollegeCommunicationEditorPage.js"),
  "CollegeCommunicationEditorPage",
);
const CollegeCommunicationRunnerPage = named(
  () => import("./pages/colleges/CollegeCommunicationRunnerPage.js"),
  "CollegeCommunicationRunnerPage",
);
const CollegeInterviewPage = named(
  () => import("./pages/colleges/CollegeInterviewPage.js"),
  "CollegeInterviewPage",
);
const CollegeInterviewEditorPage = named(
  () => import("./pages/colleges/CollegeInterviewEditorPage.js"),
  "CollegeInterviewEditorPage",
);
const CollegeInterviewCohortPage = named(
  () => import("./pages/colleges/CollegeInterviewCohortPage.js"),
  "CollegeInterviewCohortPage",
);
const CollegeCommunicationCohortPage = named(
  () => import("./pages/colleges/CollegeCommunicationCohortPage.js"),
  "CollegeCommunicationCohortPage",
);
const CollegeGameSetEditorPage = named(
  () => import("./pages/colleges/CollegeGameSetEditorPage.js"),
  "CollegeGameSetEditorPage",
);
const CollegeGameCohortPage = named(
  () => import("./pages/colleges/CollegeGameCohortPage.js"),
  "CollegeGameCohortPage",
);
const CollegeExamEditorPage = named(
  () => import("./pages/colleges/CollegeExamEditorPage.js"),
  "CollegeExamEditorPage",
);
const CollegeExamResultsPage = named(
  () => import("./pages/colleges/CollegeExamResultsPage.js"),
  "CollegeExamResultsPage",
);
const CollegeExamAnalysisPage = named(
  () => import("./pages/colleges/CollegeExamAnalysisPage.js"),
  "CollegeExamAnalysisPage",
);
const CollegeEssaysPage = named(
  () => import("./pages/colleges/CollegeEssaysPage.js"),
  "CollegeEssaysPage",
);
const CollegeEssayResultsPage = named(
  () => import("./pages/colleges/CollegeEssayResultsPage.js"),
  "CollegeEssayResultsPage",
);
const CollegeChallengesPage = named(
  () => import("./pages/colleges/CollegeChallengesPage.js"),
  "CollegeChallengesPage",
);
const CollegeAnalyticsPage = named(
  () => import("./pages/colleges/CollegeAnalyticsPage.js"),
  "CollegeAnalyticsPage",
);
const CollegeCareersPage = named(
  () => import("./pages/colleges/CollegeCareersPage.js"),
  "CollegeCareersPage",
);
const UiGalleryPage = named(
  () => import("./pages/dev/UiGalleryPage.js"),
  "UiGalleryPage",
);

// Public marketing landing (the site root for logged-out visitors).
const LandingPage = named(
  () => import("./pages/landing/LandingPage.js"),
  "LandingPage",
);

// Public informational / legal pages (reachable logged-out and logged-in).
const AboutPage = named(() => import("./pages/static/AboutPage.js"), "AboutPage");
const ContactPage = named(
  () => import("./pages/static/ContactPage.js"),
  "ContactPage",
);
const TrainingPage = named(
  () => import("./pages/static/TrainingPage.js"),
  "TrainingPage",
);
const PlacementsPage = named(
  () => import("./pages/static/PlacementsPage.js"),
  "PlacementsPage",
);
const TermsPage = named(() => import("./pages/static/TermsPage.js"), "TermsPage");
const PrivacyPage = named(
  () => import("./pages/static/PrivacyPage.js"),
  "PrivacyPage",
);
const RefundPolicyPage = named(
  () => import("./pages/static/RefundPolicyPage.js"),
  "RefundPolicyPage",
);

function RouteFallback() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <Spinner size="lg" />
    </div>
  );
}

/**
 * The site root + post-auth HOME decision. Logged-out visitors get the marketing
 * landing page. Authenticated visitors are routed to their home:
 *   - a college OPERATOR (college_admin/faculty) → their /c/:slug workspace.
 *   - a college STUDENT (role=student, userType=college) → their student space
 *     at /c/:slug/home (both resolved via /me/college).
 *   - everyone else (individual learners, platform admins) → the learner app at
 *     /app (unchanged — no extra call, since userType tells them apart).
 * Forced password change is handled FIRST (below), so a fresh college student
 * changes their password and only THEN lands in their college home — no loop.
 * This is the ONLY place the landing branches, so /app itself stays reachable
 * (the "switch to personal" target). While the session or the college lookup
 * resolves we show the neutral loader, never a flash of the wrong shell.
 */
function RootRoute() {
  const { status, user, mustChangePassword } = useAuth();
  // A college MEMBER (operator or student) resolves their own /c/:slug space.
  // Individual learners / platform admins never hit the network here.
  const collegeMember =
    !!user &&
    (isCollegeOperator(user.role) ||
      isCollegeStudent(user.role, user.userType));
  const { data: myCollege, loading: collegeLoading } = useQuery(
    () =>
      collegeMember
        ? api.me.college()
        : Promise.resolve({ college: null } as Awaited<
            ReturnType<typeof api.me.college>
          >),
    [status, user?.id, collegeMember],
  );

  if (status === "loading") return <RouteFallback />;
  if (status === "unauthenticated") return <LandingPage />;
  if (mustChangePassword) {
    return <Navigate to="/forced-password-change" replace />;
  }
  if (!user) return <RouteFallback />;

  if (collegeMember) {
    if (collegeLoading) return <RouteFallback />;
    const slug = myCollege?.college?.slug ?? null;
    if (!slug) {
      // Shouldn't happen for a real member. Operators keep the dedicated
      // no-college state; a student falls back cleanly to the learner app.
      return isCollegeOperator(user.role) ? (
        <NoCollegeHome />
      ) : (
        <Navigate to="/app" replace />
      );
    }
    return (
      <Navigate to={homePathForUser(user.role, user.userType, slug)} replace />
    );
  }
  return <Navigate to="/app" replace />;
}

/**
 * The /c/:slug index — inside CollegeLayout, so the tenant context is resolved.
 * A college student sees their consumption dashboard; an operator (or platform
 * admin) sees the workspace dashboard. Keeps a student off the operator-only
 * summary read even if they land on the bare index.
 */
function CollegeIndexRoute() {
  const { context } = useCollege();
  return context.membership.role === Role.STUDENT ? (
    <CollegeStudentDashboardPage />
  ) : (
    <CollegeDashboardPage />
  );
}

/**
 * The sections a student and an operator share a URL for (courses/exams/essays)
 * branch by role: a student sees their consume view, an operator the manage
 * page. Keeps a student off operator-only reads even on a direct URL visit, and
 * leaves operators byte-for-byte unchanged (non-students always get the manage
 * page). Placements + results are student-only paths (operators use `postings`).
 */
function CollegeCoursesRoute() {
  const { context } = useCollege();
  return context.membership.role === Role.STUDENT ? (
    <CollegeStudentCoursesPage />
  ) : (
    <CollegeCoursesPage />
  );
}
function CollegeExamsRoute() {
  const { context } = useCollege();
  return context.membership.role === Role.STUDENT ? (
    <CollegeStudentExamsPage />
  ) : (
    <CollegeExamsPage />
  );
}
function CollegeGamingRoute() {
  const { context } = useCollege();
  // Students play (available list); operators author (manage list).
  return context.membership.role === Role.STUDENT ? (
    <CollegeGamingPage />
  ) : (
    <CollegeGameSetsPage />
  );
}
function CollegeEssaysRoute() {
  const { context } = useCollege();
  return context.membership.role === Role.STUDENT ? (
    <CollegeStudentEssaysPage />
  ) : (
    <CollegeEssaysPage />
  );
}
function CollegeAttendanceRoute() {
  const { context } = useCollege();
  return context.membership.role === Role.STUDENT ? (
    <CollegeStudentAttendancePage />
  ) : (
    <CollegeAttendancePage />
  );
}
function CollegeAiCreditsRoute() {
  const { context } = useCollege();
  return context.membership.role === Role.STUDENT ? (
    <CollegeStudentAiCreditsPage />
  ) : (
    <CollegeAiCreditsPage />
  );
}

export function App() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        {/* Guest-only auth screens */}
        <Route element={<GuestOnlyRoute />}>
          <Route path="/login" element={<LoginPage />} />
          {/* Per-college branded login — same auth, college-skinned chrome. */}
          <Route path="/c/:collegeSlug/login" element={<BrandedLoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
        </Route>

        {/* Forced password change (authenticated, blocking) */}
        <Route element={<ForcedPasswordChangeRoute />}>
          <Route
            path="/forced-password-change"
            element={<ForcedPasswordChangePage />}
          />
        </Route>

        {/* Protected app (inside the shell) */}
        <Route element={<ProtectedRoute />}>
          <Route element={<AppLayout />}>
            <Route path="/app" element={<DashboardPage />} />
            <Route path="/history" element={<HistoryPage />} />
            <Route path="/playground" element={<PlaygroundPage />} />
            <Route path="/challenge" element={<DailyChallengePage />} />
            <Route path="/leaderboard" element={<LeaderboardPage />} />
            <Route path="/exams" element={<ExamsPage />} />
            <Route path="/games" element={<GamesPage />} />
            <Route path="/essays" element={<EssaysPage />} />
            <Route path="/essays/:id" element={<EssayWriterPage />} />
            {/* B2C / global course-attached speaking + composite runners (S30) */}
            <Route path="/speaking/:assessmentId" element={<SpeakingRunnerPage />} />
            <Route path="/interviews/:assessmentId" element={<InterviewRunnerPage />} />
            <Route
              path="/communication/:assessmentId"
              element={<CommunicationRunnerPage />}
            />
            <Route path="/checkout/:slug" element={<CheckoutPage />} />
            <Route path="/payments/return" element={<PaymentReturnPage />} />
            <Route path="/orders" element={<OrdersPage />} />
            <Route path="/careers" element={<CareersPage />} />
            <Route
              path="/careers/applications"
              element={<MyApplicationsPage />}
            />
            <Route path="/careers/:id" element={<PostingDetailPage />} />
            <Route path="/change-password" element={<ChangePasswordPage />} />

            {/* Admin-only careers management */}
            <Route element={<RequireAdmin />}>
              <Route path="/admin/careers" element={<AdminCareersPage />} />
              <Route
                path="/admin/careers/:id/applications"
                element={<AdminApplicationsPage />}
              />
              <Route path="/admin/exams" element={<AdminExamsPage />} />
              <Route
                path="/admin/exams/:examId"
                element={<AdminExamEditorPage />}
              />
              <Route path="/admin/game-sets" element={<AdminGameSetsPage />} />
              <Route
                path="/admin/game-sets/:gameSetId"
                element={<AdminGameSetEditorPage />}
              />
              <Route path="/admin/speaking" element={<AdminSpeakingPage />} />
              <Route path="/admin/interviews" element={<AdminInterviewPage />} />
              <Route
                path="/admin/communication"
                element={<AdminCommunicationPage />}
              />
              <Route
                path="/admin/curriculum"
                element={<AdminCurriculumPage />}
              />
              <Route
                path="/admin/curriculum/subjects/:subjectId"
                element={<AdminSubjectEditorPage />}
              />
              <Route path="/admin/coupons" element={<AdminCouponsPage />} />
              <Route
                path="/admin/essay-topics"
                element={<AdminEssayTopicsPage />}
              />
              <Route
                path="/admin/challenges"
                element={<AdminChallengesPage />}
              />
              <Route path="/admin/users" element={<AdminUsersPage />} />
              <Route
                path="/admin/question-banks"
                element={<AdminQuestionBanksPage />}
              />
              <Route
                path="/admin/ai-providers"
                element={<AdminAiProvidersPage />}
              />
              <Route path="/admin/orders" element={<AdminOrdersPage />} />
              <Route path="/admin/colleges" element={<AdminCollegesPage />} />
              <Route
                path="/admin/colleges/:collegeId"
                element={<CollegeManagePage />}
              />
              <Route
                path="/admin/essay-analytics"
                element={<AdminEssayAnalyticsPage />}
              />
            </Route>
          </Route>

          {/* Course player — distraction-reduced, outside the AppShell */}
          <Route path="/learn/:slug" element={<PlayerPage />} />
          <Route path="/learn/:slug/:topicId" element={<PlayerPage />} />

          {/* Fullscreen exam runner — outside the AppShell */}
          <Route path="/exam/:examId" element={<ExamRunnerPage />} />

          {/* Fullscreen game runner — outside the AppShell */}
          <Route path="/play/game/:gameSetId" element={<GamePlayPage />} />
        </Route>

        {/* College workspace — its OWN TOP-LEVEL full-page layout, a sibling of
            the main app routes (NOT a child of the AppLayout shell). CollegeLayout
            is the ONLY shell here, so /c/:slug/* fills the viewport (no nested
            chrome, no cramped column). RequireCollegeMember is the coarse client
            gate; the real boundary is server-side (resolveTenant) via the layout's
            context fetch. */}
        <Route element={<ProtectedRoute />}>
          <Route element={<RequireCollegeMember />}>
            <Route path="/c/:collegeSlug" element={<CollegeLayout />}>
              <Route index element={<CollegeIndexRoute />} />
              <Route path="dashboard" element={<CollegeDashboardPage />} />
              {/* College STUDENT space home (part i). */}
              <Route path="home" element={<CollegeStudentDashboardPage />} />
              {/* Student-only section views (part ii) — reuse the existing deep
                  flows via the ?c seam. `placements`/`results` are student-only;
                  courses/exams/essays are shared URLs that branch by role. */}
              <Route
                path="placements"
                element={<CollegeStudentPlacementsPage />}
              />
              <Route path="results" element={<CollegeStudentResultsPage />} />
              <Route path="structure" element={<CollegeStructurePage />} />
              <Route path="students" element={<CollegeStudentsPage />} />
              <Route path="attendance" element={<CollegeAttendanceRoute />} />
              <Route
                path="attendance/analytics"
                element={<CollegeAttendanceAnalyticsPage />}
              />
              <Route
                path="attendance/groups/:groupId"
                element={<CollegeAttendanceGroupPage />}
              />
              <Route
                path="attendance/sessions/:sessionId"
                element={<CollegeTakeAttendancePage />}
              />
              <Route path="coding" element={<CollegeCodingProfilePage />} />
              <Route
                path="coding-leaderboard"
                element={<CollegeCodingLeaderboardPage />}
              />
              <Route path="ai-credits" element={<CollegeAiCreditsRoute />} />
              <Route path="courses" element={<CollegeCoursesRoute />} />
              <Route path="exams" element={<CollegeExamsRoute />} />
              <Route
                path="exams/:examId"
                element={<CollegeExamEditorPage />}
              />
              <Route
                path="exams/:examId/results"
                element={<CollegeExamResultsPage />}
              />
              <Route
                path="exams/:examId/analysis"
                element={<CollegeExamAnalysisPage />}
              />
              <Route path="gaming" element={<CollegeGamingRoute />} />
              <Route
                path="gaming/:gameSetId/cohort"
                element={<CollegeGameCohortPage />}
              />
              <Route
                path="gaming/:gameSetId"
                element={<CollegeGameSetEditorPage />}
              />
              <Route path="essays" element={<CollegeEssaysRoute />} />
              <Route
                path="essays/:essayTopicId/results"
                element={<CollegeEssayResultsPage />}
              />
              <Route
                path="communication"
                element={<CollegeCommunicationPage />}
              />
              <Route path="speaking" element={<CollegeSpeakingPage />} />
              <Route path="speaking/manage" element={<CollegeSpeakingEditorPage />} />
              <Route path="interviews" element={<CollegeInterviewPage />} />
              <Route path="interviews/manage" element={<CollegeInterviewEditorPage />} />
              <Route
                path="interviews/:assessmentId/cohort"
                element={<CollegeInterviewCohortPage />}
              />
              <Route
                path="communication/assessments"
                element={<CollegeCommunicationAssessmentsPage />}
              />
              <Route
                path="communication/assessments/manage"
                element={<CollegeCommunicationEditorPage />}
              />
              <Route
                path="communication/assessments/:assessmentId/cohort"
                element={<CollegeCommunicationCohortPage />}
              />
              <Route
                path="communication/assessments/:assessmentId"
                element={<CollegeCommunicationRunnerPage />}
              />
              <Route path="challenges" element={<CollegeChallengesPage />} />
              <Route path="analytics" element={<CollegeAnalyticsPage />} />
              <Route path="postings" element={<CollegeCareersPage />} />
              <Route path="faculty" element={<CollegeFacultyPage />} />
            </Route>
          </Route>
        </Route>

        {/* Public anonymous exam — no auth, reachable only by token */}
        <Route path="/public/exam/:token" element={<PublicExamPage />} />

        {/* Public informational + legal pages (logged-out and logged-in) */}
        <Route element={<PublicLayout />}>
          <Route path="/courses" element={<CatalogPage />} />
          <Route path="/courses/:slug" element={<CourseDetailPage />} />
          <Route path="/about" element={<AboutPage />} />
          <Route path="/contact" element={<ContactPage />} />
          <Route path="/training" element={<TrainingPage />} />
          <Route path="/placements" element={<PlacementsPage />} />
          <Route path="/terms" element={<TermsPage />} />
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="/refund-policy" element={<RefundPolicyPage />} />
        </Route>

        {/* Dev-only component gallery (excluded from production build) */}
        {import.meta.env.DEV ? (
          <Route path="/dev/ui" element={<UiGalleryPage />} />
        ) : null}

        <Route path="/" element={<RootRoute />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  );
}
