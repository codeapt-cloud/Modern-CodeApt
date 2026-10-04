/**
 * THE ADMIN CAPABILITY MAP (Step 40) — the single source of truth the guide uses
 * to answer "how do I X": where to go, the exact control, what must exist first,
 * the gate, and the common failure modes. It is HAND-AUTHORED (UI labels, nav
 * paths and prerequisites span routes + controllers + services + pages and can't
 * be reduced to one derivable symbol), and it is the ONE file to update when an
 * admin surface changes. A test cross-checks the machine-checkable parts (keys are
 * unique; referenced error codes exist) so drift is caught in CI.
 *
 * MAINTENANCE: when you add/rename/move an admin action, update the matching entry
 * here. The capability_details tool reads ONLY this map, so the guide can never
 * invent a step the code doesn't support. Granularity: ONE entry per action or
 * tightly-related group; every distinct GATE, PREREQUISITE and FAILURE mode is
 * captured because those are what admins actually ask about. Derived 2026-10-04
 * from routes + controllers + services + page components.
 */
import { z } from "zod";

import type { RegisteredTool } from "./types.js";

export interface AdminCapability {
  /** Stable lookup key, e.g. "exam.publish". */
  key: string;
  action: string;
  surface: "platform" | "college";
  roles: string;
  /** SPA route path (with :params) the action lives on. */
  route: string;
  /** How to navigate there (nav item → page → tab/control). */
  navigate: string;
  /** The literal button/control label(s) as written in the component (human prose). */
  affordance: string;
  /** EXACT literal button labels that MUST appear verbatim in a web component — the
   *  machine-checked subset (a drift test greps the web src for each). Omit
   *  templated labels (e.g. `Add ${level}`) that aren't a literal string. */
  controls?: string[];
  prerequisites: string[];
  /** Feature flag / sub-capability / role gate, and what a lacking admin sees. */
  gates: string;
  /** Common failures + their cause (error code → why). */
  failureModes: string[];
  notes?: string;
}

export const ADMIN_CAPABILITIES: AdminCapability[] = [
  // ===================== PLATFORM (super admin) =====================
  {
    key: "college.create",
    action: "Create a college (tenant)",
    surface: "platform",
    roles: "super admin",
    route: "/admin/colleges",
    navigate: "Left nav → Colleges → New college",
    affordance: "New college",
    controls: ["New college"],
    prerequisites: [],
    gates: "super_admin only; the Colleges nav item is hidden for everyone else",
    failureModes: ["COLLEGE_SLUG_TAKEN — the slug is already in use"],
  },
  {
    key: "college.edit_basics",
    action: "Edit a college's basics / suspend or reactivate it",
    surface: "platform",
    roles: "super admin",
    route: "/admin/colleges/:collegeId",
    navigate: "Colleges → open the college (Manage) → Edit basics / Suspend / Reactivate",
    affordance: "Edit basics · Suspend · Reactivate",
    prerequisites: ["The college exists"],
    gates: "super_admin only",
    failureModes: ["COLLEGE_NOT_FOUND"],
  },
  {
    key: "college.entitlements",
    action: "Enable/disable a feature or sub-capability for a college",
    surface: "platform",
    roles: "super admin",
    route: "/admin/colleges/:collegeId",
    navigate:
      "Colleges → open the college → the 'Features & capabilities' card → toggle the switches",
    affordance: "per-feature and per-sub-capability switches (aria 'Toggle <feature>')",
    prerequisites: ["The parent FEATURE must be ON before its sub-capability switch is enabled"],
    gates: "super_admin only",
    failureModes: [
      "An unknown sub-capability key is rejected (must be in the catalog)",
      "A sub-capability has no effect while its parent feature is OFF (its switch is disabled)",
    ],
    notes:
      "Sub-capabilities are 'feature.subcap' — e.g. ai.admin_assistant, exams.public_links, gaming.authoring, communication.speaking, interview.interview.",
  },
  {
    key: "college.credits",
    action: "Set a college's AI credits (tier/override) and interview credits",
    surface: "platform",
    roles: "super admin",
    route: "/admin/colleges/:collegeId",
    navigate: "Colleges → open the college → the AI Credits card (and Interview credits card)",
    affordance: "Credits card (tier / monthly override / reset) · Interview credits (one-time total)",
    prerequisites: ["The college exists; the AI feature for AI credits to be usable"],
    gates: "super_admin only",
    failureModes: ["1 interview credit = 1 interview started; when exhausted students hit NO_CREDITS"],
  },
  {
    key: "college.create_admin",
    action: "Create a college administrator",
    surface: "platform",
    roles: "super admin",
    route: "/admin/colleges/:collegeId",
    navigate: "Colleges → open the college → 'College admins' card → Add college admin",
    affordance: "Add college admin",
    controls: ["Add college admin"],
    prerequisites: ["The college exists"],
    gates: "super_admin only",
    failureModes: ["EMAIL_TAKEN", "USERNAME_TAKEN"],
    notes: "The new admin gets a temporary password and is forced to change it on first login.",
  },
  {
    key: "college.grant_courses",
    action: "Grant / revoke B2C courses for a college",
    surface: "platform",
    roles: "super admin",
    route: "/admin/colleges/:collegeId",
    navigate: "Colleges → open the college → 'Granted courses' card → toggle a course switch",
    affordance: "per-course switch (aria 'Grant <name>')",
    prerequisites: ["The course (subject) exists in the curriculum"],
    gates: "super_admin only",
    failureModes: ["Unknown/invalid course id is rejected"],
    notes:
      "Granting a course makes it available for a college to assign to students, and unlocks the Standard/Coding question banks for that college.",
  },
  {
    key: "curriculum.program_subject_module",
    action: "Create/edit programs, courses (subjects) and modules",
    surface: "platform",
    roles: "super admin",
    route: "/admin/curriculum",
    navigate: "Left nav → Manage curriculum → New program / New course; open a course → modules",
    affordance: "New program · New course · (in the subject editor) Add module",
    controls: ["New program", "New course"],
    prerequisites: ["A Program holds Subjects; a Subject holds Modules; a Module holds Topics"],
    gates: "super_admin only",
    failureModes: [
      "SLUG_TAKEN — duplicate program/course slug",
      "DELETE_BLOCKED — remove dependents first (a program/course/module with children)",
      "PROGRAM_NOT_FOUND / SUBJECT_NOT_FOUND / MODULE_NOT_FOUND",
    ],
  },
  {
    key: "curriculum.create_topic",
    action:
      "Create a course topic (EXAM / GAME / SPEAKING / COMMUNICATION / MOCK_INTERVIEW / ESSAY / QUIZ)",
    surface: "platform",
    roles: "super admin",
    route: "/admin/curriculum/subjects/:subjectId",
    navigate:
      "Manage curriculum → open the Course → open a Module → New topic → choose the topic TYPE from the dropdown",
    affordance: "New topic (then a Type dropdown offering Text / Video / Quiz / Exam / Game / Speaking / Communication / Mock interview / Essay)",
    controls: ["New topic"],
    prerequisites: [
      "A Program → Course → Module must exist to hold the topic",
      "The topic TYPE must match the content you'll attach (GAME topic for a game set; SPEAKING for speaking; COMMUNICATION for a composite; MOCK_INTERVIEW for an interview)",
    ],
    gates: "super_admin only",
    failureModes: [
      "TOPIC_TYPE_IMMUTABLE — a topic's type cannot change once created",
      "DELETE_BLOCKED — a topic with an attached assessment or learner progress; detach/clear first",
    ],
    notes:
      "THIS IS THE PREREQUISITE behind most 'attach to a course' questions — the correctly-typed topic must exist FIRST.",
  },
  {
    key: "curriculum.enroll",
    action: "Bulk-enroll learners / manage a course's roster",
    surface: "platform",
    roles: "super admin",
    route: "/admin/curriculum/subjects/:subjectId",
    navigate:
      "Manage curriculum → open the Course → Enrollments (add / remove / set expiry / bulk upload / export)",
    affordance: "Bulk upload · Add enrollment · export.xlsx",
    prerequisites: ["The course (subject) exists"],
    gates: "super_admin only",
    failureModes: ["SUBJECT_NOT_FOUND"],
  },
  {
    key: "exam.platform_author",
    action: "Author a platform/B2C exam (bound to a course topic)",
    surface: "platform",
    roles: "super admin",
    route: "/admin/exams/:examId",
    navigate:
      "Left nav → Manage exams → Open exam → the editor (sections, questions, test cases, public links, bulk upload)",
    affordance: "Open exam · Add section · Publish/Unpublish · Bulk upload · Delete exam",
    controls: ["Open exam"],
    prerequisites: ["An EXAM-type course topic to bind to", "At least one question before publishing"],
    gates: "super_admin only",
    failureModes: [
      "Publishing an exam with no questions is refused — add a question first",
      "DELETE_BLOCKED — the exam has recorded attempts (delete an unattempted one instead)",
      "LINK_UNAVAILABLE — a public link is inactive/outside its window",
    ],
  },
  {
    key: "gameset.platform_create",
    action: "Create a platform game set and attach it to a course",
    surface: "platform",
    roles: "super admin",
    route: "/admin/game-sets",
    navigate:
      "Left nav → Manage game sets → New set (or 'draft one with AI'); set its course topic in the editor",
    affordance: "New set · Draft with AI · Publish/Unpublish",
    controls: ["New set"],
    prerequisites: [
      "A GAME-type curriculum topic must already exist (see curriculum.create_topic)",
      "At least one game in the set; for random_n_of_pool, pickCount ≤ number of games",
    ],
    gates: "super_admin only (course-attached game sets are a PLATFORM surface)",
    failureModes: [
      "TOPIC_NOT_FOUND — the topic id doesn't exist",
      "TOPIC_NOT_GAME — the chosen topic is not a GAME topic",
      "TOPIC_ALREADY_ATTACHED — another game set already uses that topic (1:1)",
      "GAME_SET_NOT_PUBLISHABLE — no games, or pickCount exceeds the pool",
    ],
    notes:
      "THE PREREQUISITE IS THE ANSWER for 'attach a game set to a course': a game set only reaches a course through a GAME topic, and only PLATFORM game sets are course-attached. College game sets are org-unit targeted (see gameset.college). Note: there is NO platform game-set cohort/attempts PAGE in the UI — per-set cohort reporting exists only on the COLLEGE surface (gameset.college).",
  },
  {
    key: "essaytopic.manage",
    action: "Create/manage essay prompts (topics)",
    surface: "platform",
    roles: "super admin",
    route: "/admin/essay-topics",
    navigate: "Left nav → Manage essay prompts → New prompt",
    affordance: "New prompt · (in the editor) Generate keywords · row Active switch · Delete prompt",
    controls: ["New prompt"],
    prerequisites: [],
    gates: "super_admin only",
    failureModes: ["DELETE_BLOCKED — the prompt has student attempts (deactivate it instead)"],
  },
  {
    key: "speaking.platform",
    action: "Author a platform speaking assessment",
    surface: "platform",
    roles: "super admin",
    route: "/admin/speaking",
    navigate: "Left nav → Manage speaking → New assessment",
    affordance:
      "New assessment · Publish/Unpublish · Delete (unpublished only) · default speech-engine select",
    prerequisites: ["At least one item", "Every listen-based item has its audio (Generate audio or upload)"],
    gates: "super_admin only",
    failureModes: [
      "NOT_PUBLISHABLE — no items, or a listen-based item is missing its audio prompt",
      "NOT_DELETABLE — published, or has non-expired attempts (unpublish first)",
      "TTS_UNAVAILABLE — the Piper/Cloudinary TTS backend is down",
    ],
  },
  {
    key: "communication.platform",
    action: "Author a platform communication (composite) assessment",
    surface: "platform",
    roles: "super admin",
    route: "/admin/communication",
    navigate: "Left nav → Manage communication → New composite",
    affordance: "New composite · Publish/Unpublish · Delete (unpublished only)",
    controls: ["New composite"],
    prerequisites: ["At least one part", "EVERY referenced part is itself published"],
    gates: "super_admin only",
    failureModes: [
      "NOT_PUBLISHABLE — a part is unpublished or no longer resolves (the error names the part); publish each part first",
      "NOT_DELETABLE — the composite is published (unpublish first)",
    ],
    notes:
      "There is NO platform-wide composite cohort/results page — cohort reporting exists only on the COLLEGE surface (composite.college). Don't send a platform admin to a cohort view for a platform composite; it doesn't exist.",
  },
  {
    key: "interview.platform",
    action: "Author a platform mock interview",
    surface: "platform",
    roles: "super admin",
    route: "/admin/interviews",
    navigate: "Left nav → Manage interviews → New interview",
    affordance: "New interview · Publish/Unpublish · Delete (unpublished only)",
    controls: ["New interview"],
    prerequisites: ["At least one question (a plan count or a seed question)"],
    gates: "super_admin only",
    failureModes: ["NOT_PUBLISHABLE — no questions", "NOT_DELETABLE — published or has attempts"],
  },
  {
    key: "challenges.manage",
    action: "Schedule / import / regenerate daily coding challenges",
    surface: "platform",
    roles: "super admin",
    route: "/admin/challenges",
    navigate:
      "Left nav → Manage challenges → Schedule challenge / Bulk import / per-row Regenerate / AI build",
    affordance: "Schedule challenge · Bulk import · Regenerate · Edit/Delete challenge",
    controls: ["Schedule challenge"],
    prerequisites: ["One challenge per calendar day"],
    gates: "super_admin only",
    failureModes: [
      "DATE_TAKEN — a challenge already exists for that day",
      "DELETE_BLOCKED — the challenge has scored submissions (reschedule instead)",
    ],
  },
  {
    key: "question_banks.platform",
    action: "Manage the global question bank",
    surface: "platform",
    roles: "super admin",
    route: "/admin/question-banks",
    navigate: "Left nav → Question banks → New question / Import (tabs: All · Standard (MCQ) · Coding)",
    affordance: "New question · Import · Edit/Delete question",
    controls: ["New question"],
    prerequisites: [],
    gates: "super_admin only",
    failureModes: [],
    notes: "Questions already pulled into an exam are unaffected by edits/deletes here.",
  },
  {
    key: "ai_providers.manage",
    action: "Manage LLM providers, keys and the pool governor",
    surface: "platform",
    roles: "super admin",
    route: "/admin/ai-providers",
    navigate:
      "Left nav → AI providers → per-provider Add key / Test / Enabled switch / Edit model; Governor panel",
    affordance: "Add key · Replace key · Test · Enabled / Trains-on-data switches · Save governor",
    controls: ["Test"],
    prerequisites: ["Server ENCRYPTION_KEY must be set to store/decrypt keys"],
    gates: "super_admin only",
    failureModes: [
      "Key input is disabled with a warning if ENCRYPTION_KEY is not configured",
      "If keys were encrypted under a DIFFERENT ENCRYPTION_KEY they fail to decrypt and every provider is skipped — re-enter the keys, or restore the original ENCRYPTION_KEY",
      "Test shows '✓ Key works' or the provider's HTTP status (404 = wrong model id, 402 = billing, 429 = rate limit)",
    ],
  },
  {
    key: "coupons.manage",
    action: "Create/manage discount coupons",
    surface: "platform",
    roles: "super admin",
    route: "/admin/coupons",
    navigate: "Left nav → Manage coupons → New coupon",
    affordance: "New coupon · row Active switch · Edit/Delete coupon",
    controls: ["New coupon"],
    prerequisites: [],
    gates: "super_admin only",
    failureModes: ["CODE_TAKEN", "DELETE_BLOCKED — orders reference it (deactivate instead)"],
  },
  {
    key: "users.manage",
    action: "Manage users (activate, role, reset password, unenroll)",
    surface: "platform",
    roles: "super admin",
    route: "/admin/users",
    navigate: "Left nav → Users → search → open a user (detail dialog)",
    affordance: "Activate/Deactivate · Set role · Reset password · Unenroll · Export per-college performance",
    prerequisites: [],
    gates: "super_admin only; config-only (password hashes are never set directly)",
    failureModes: [
      "SELF_ACTION_FORBIDDEN — you can't deactivate/demote yourself",
      "LAST_ADMIN — can't remove the last admin",
      "ROLL_TAKEN",
    ],
  },
  {
    key: "careers.platform",
    action: "Manage job postings and applications",
    surface: "platform",
    roles: "super admin",
    route: "/admin/careers",
    navigate: "Left nav → Manage postings → New posting; open a posting's applications",
    affordance: "New posting · Publish · Close · Edit/Delete posting · (applications) update status",
    controls: ["New posting"],
    prerequisites: [],
    gates: "super_admin only",
    failureModes: ["DELETE_BLOCKED — the posting has applications (close it instead)"],
  },
  {
    key: "platform.read_only",
    action: "Read-only admin views (orders ledger, essay analytics)",
    surface: "platform",
    roles: "super admin",
    route: "/admin/orders",
    navigate: "Left nav → Orders (ledger) / Essay analytics",
    affordance: "(read-only — the payment gateway owns the order lifecycle)",
    prerequisites: [],
    gates: "super_admin only",
    failureModes: ["ORDER_NOT_FOUND"],
  },

  // ===================== COLLEGE (college_admin / faculty) =====================
  {
    key: "orgunit.create",
    action: "Create the academic structure (departments / years / sections)",
    surface: "college",
    roles: "college_admin (faculty read-only)",
    route: "/c/:slug/structure",
    navigate: "College nav → Academics → Academic structure → Add <level>",
    affordance: "Add department / Add year / Add section (and a paste-to-bulk-create box)",
    prerequisites: ["A parent unit for any child level"],
    gates: "college_admin to write; the page is open to faculty read-only (no feature flag)",
    failureModes: [
      "ORG_UNIT_NAME_TAKEN — sibling units need unique names",
      "ORG_UNIT_HAS_CHILDREN / ORG_UNIT_HAS_STUDENTS — can't delete a unit with children or students assigned",
    ],
  },
  {
    key: "faculty.manage",
    action: "Invite faculty and set their org-unit scope",
    surface: "college",
    roles: "college_admin",
    route: "/c/:slug/faculty",
    navigate: "College nav → Academics → Faculty → Invite faculty",
    affordance: "Invite faculty · (per row) Edit scope",
    controls: ["Invite faculty"],
    prerequisites: ["Org units exist to assign as the faculty member's scope"],
    gates: "FACULTY_MANAGEMENT feature + college_admin; without the feature the nav shows 'Not enabled'",
    failureModes: [
      "FACULTY_SCOPE_INVALID — an assigned unit is unknown or outside the college",
      "EMAIL_TAKEN / USERNAME_TAKEN",
    ],
    notes: "A faculty member's scope bounds everything they can later author or see.",
  },
  {
    key: "student.add",
    action: "Add students (single) or import in bulk",
    surface: "college",
    roles: "college_admin / faculty (faculty limited to their scope)",
    route: "/c/:slug/students",
    navigate: "College nav → People → Student registry → Add student (or Import students)",
    affordance:
      "Add student · Import students (Paste / Upload file → Download template → Preview → Import N valid students)",
    prerequisites: ["An org unit to place the student in", "Import requires the BULK_IMPORT feature"],
    gates: "college membership to add; BULK_IMPORT feature for import (the Import button 403s without it)",
    failureModes: [
      "ROLL_NUMBER_TAKEN / EMAIL_TAKEN / USERNAME_TAKEN",
      "ORG_UNIT_OUT_OF_SCOPE — a faculty targeted a unit outside their scope",
    ],
    notes: "New accounts get a temp password and are forced to change it on first login.",
  },
  {
    key: "course.assign",
    action: "Assign a granted course to students",
    surface: "college",
    roles: "college_admin / faculty",
    route: "/c/:slug/courses",
    navigate: "College nav → Learning → Courses → (per course) Assign students",
    affordance: "Assign students",
    controls: ["Assign students"],
    prerequisites: ["A super admin must have GRANTED the course to the college (else it isn't in the catalog)"],
    gates: "COURSES feature + requireFaculty",
    failureModes: ["Only in-scope students can be assigned (faculty scope)"],
  },
  {
    key: "exam.create",
    action: "Create a college exam",
    surface: "college",
    roles: "college_admin / faculty",
    route: "/c/:slug/exams",
    navigate: "College nav → Learning → Exams → New exam",
    affordance: "New exam",
    controls: ["New exam"],
    prerequisites: ["Faculty must target ≥1 org unit in their scope; a college admin may leave it college-wide"],
    gates: "EXAMS feature + requireFaculty; without the feature the nav shows 'Not enabled'",
    failureModes: ["ORG_UNIT_OUT_OF_SCOPE — a faculty targeted a unit outside their scope"],
  },
  {
    key: "exam.author",
    action: "Add sections, questions, test cases + bulk upload / AI build / question banks",
    surface: "college",
    roles: "college_admin / faculty",
    route: "/c/:slug/exams/:examId",
    navigate:
      "College nav → Exams → open the exam → Add section; per section: Standard/Coding/Self Bank, Section AI Build; Bulk upload; Full Exam AI Build",
    affordance: "Add section · Standard Bank · Coding Bank · Self Bank · Bulk upload · Full Exam AI Build",
    controls: ["Add section"],
    prerequisites: [
      "Standard/Coding bank need the question_banks grant (the buttons read 'Ask your CodeApt admin to enable Question Banks' without it); Self Bank always works",
      "AI build needs the EXAMS feature + the ai.question_generation sub-capability",
    ],
    gates: "EXAMS feature + requireFaculty",
    failureModes: ["AI build is unavailable if no AI provider is configured"],
  },
  {
    key: "exam.publish",
    action: "Publish an exam",
    surface: "college",
    roles: "college_admin / faculty",
    route: "/c/:slug/exams/:examId",
    navigate: "College nav → Exams → open the exam → Publish",
    affordance: "Publish / Unpublish",
    prerequisites: [
      "At least one question (the Publish button is disabled until then, with the hint 'Add at least one question to publish.')",
    ],
    gates: "EXAMS feature + requireFaculty (faculty limited to their org units)",
    failureModes: ["Publishing with no questions is refused"],
  },
  {
    key: "exam.public_link",
    action: "Attach a public share link to an exam",
    surface: "college",
    roles: "college_admin / faculty",
    route: "/c/:slug/exams/:examId",
    navigate: "College nav → Exams → open the exam → Public links → New link",
    affordance: "Public links → New link → Create link (Copy URL)",
    prerequisites: ["The exam exists"],
    gates: "EXAMS feature + exams.public_links sub-capability",
    failureModes: [
      "If a link's access code is enabled it must be ≥4 characters",
      "LINK_UNAVAILABLE outside its active window",
    ],
  },
  {
    key: "exam.duplicate_reset",
    action: "Duplicate an exam / reset a student's attempts",
    surface: "college",
    roles: "college_admin / faculty",
    route: "/c/:slug/exams",
    navigate:
      "Exams list → row → Duplicate exam; or open the exam → Results → (per attempt) Reset",
    affordance: "Duplicate exam → Duplicate · (Results) Reset → Reset attempts",
    prerequisites: [],
    gates: "EXAMS feature + requireFaculty",
    failureModes: [
      "DELETE_BLOCKED when deleting an exam with recorded attempts (delete an unattempted one instead)",
    ],
  },
  {
    key: "gameset.college",
    action: "Create / clone / AI-build a college game set (org-unit targeted)",
    surface: "college",
    roles: "college_admin / faculty",
    route: "/c/:slug/gaming/:gameSetId",
    navigate: "College nav → Learning → Games → New set (or Clone a template, or Draft with AI)",
    affordance: "New set · Clone · Draft with AI · Publish/Unpublish · Results",
    controls: ["New set"],
    prerequisites: ["At least one game; for random_n_of_pool, pickCount ≤ games"],
    gates: "GAMING feature + gaming.authoring; AI build also needs gaming.ai_build",
    failureModes: [
      "GAME_SET_NOT_PUBLISHABLE — no games or pickCount exceeds the pool",
      "INVALID_GAME_SET_SHAPE — a COLLEGE game set may NOT be course-attached (no topic field); it targets org units",
      "ORG_UNIT_OUT_OF_SCOPE",
    ],
    notes:
      "To put a game on a COURSE, a super admin must use a PLATFORM game set + a GAME topic (see gameset.platform_create) — college sets can't attach to courses.",
  },
  {
    key: "speaking.college",
    action: "Author + publish a college speaking assessment",
    surface: "college",
    roles: "college_admin / faculty",
    route: "/c/:slug/speaking/manage",
    navigate:
      "College nav → Learning → Communication → Speaking → New assessment (or load a preset: CTS/Accenture/Versant/SVAR)",
    affordance: "New assessment · Add item · (per item) Generate audio / upload · Publish/Unpublish",
    controls: ["Add item"],
    prerequisites: [
      "At least one item",
      "Every listen/stimulus-based item has its audio (Generate audio or upload a clip)",
    ],
    gates: "COMMUNICATION feature + communication.speaking sub-capability + requireFaculty",
    failureModes: [
      "NOT_PUBLISHABLE — no items, or a listen-based item missing its audio prompt",
      "NOT_DELETABLE — published, or has non-expired attempts (unpublish first)",
      "TTS_UNAVAILABLE",
    ],
  },
  {
    key: "composite.college",
    action: "Author + publish a college communication (composite) assessment",
    surface: "college",
    roles: "college_admin / faculty",
    route: "/c/:slug/communication/assessments/manage",
    navigate:
      "College nav → Learning → Communication → New assessment → Add part (reference existing exam/essay/speaking artifacts)",
    affordance: "New assessment · Add part · Publish/Unpublish",
    controls: ["Add part"],
    prerequisites: [
      "At least one part",
      "EVERY referenced artifact (exam/essay/speaking) is itself PUBLISHED before the composite can publish",
    ],
    gates: "COMMUNICATION feature + communication.authoring sub-capability + requireFaculty",
    failureModes: [
      "NOT_PUBLISHABLE — a part is unpublished or no longer resolves (the error names the offending part); publish each component FIRST",
      "INVALID_PART_REF — a part references a missing/unpublished/wrong-type artifact",
      "PART_LOCKED — a part's gate (requires-previous / available-from) isn't satisfied",
      "NOT_DELETABLE — the composite is published",
    ],
    notes: "Publishing order matters: publish each component exam/essay/speaking, THEN the composite.",
  },
  {
    key: "interview.college",
    action: "Author + publish a college mock interview",
    surface: "college",
    roles: "college_admin / faculty",
    route: "/c/:slug/interviews/manage",
    navigate: "College nav → Learning → Mock interviews → New interview",
    affordance: "New interview · Publish/Unpublish · Delete (drafts only)",
    controls: ["New interview"],
    prerequisites: [
      "At least one question (a plan count or a seed question)",
      "Interview credits for students to start",
    ],
    gates: "INTERVIEW feature + interview sub-capability + requireFaculty",
    failureModes: [
      "NOT_PUBLISHABLE — no questions",
      "NO_CREDITS (when a student starts) — the college's interview-credit quota is exhausted (a super admin tops it up on the Manage-college page)",
      "NOT_DELETABLE — published or has attempts",
    ],
  },
  {
    key: "attendance.manage",
    action: "Run attendance (groups, sessions, marking, reports)",
    surface: "college",
    roles: "faculty to run; college_admin for settings",
    route: "/c/:slug/attendance",
    navigate:
      "College nav → People → Attendance → New group; open a session → mark; Insights → Attendance reports",
    affordance: "New group → Create group · Add members · (session) Mark all present / Save · Export reports",
    prerequisites: ["Org units / students to build a group from", "ATTENDANCE feature"],
    gates: "ATTENDANCE feature + requireFaculty; who-may-take-attendance settings are college_admin only",
    failureModes: ["GROUP_NAME_TAKEN", "OUT_OF_SCOPE — a faculty acting outside their units"],
  },
  {
    key: "coding_profiles",
    action: "Coding profiles + leaderboard",
    surface: "college",
    roles: "students set handles; faculty view leaderboard; college_admin refresh a student",
    route: "/c/:slug/coding-leaderboard",
    navigate:
      "College nav → Insights → Coding leaderboard (students: Coding profile page to set handles)",
    affordance: "Save handles · Refresh now · (leaderboard) Export",
    prerequisites: ["CODING_PROFILES feature; students must set Codeforces/LeetCode/CodeChef handles"],
    gates: "CODING_PROFILES feature; refresh-a-student is college_admin",
    failureModes: ["Stats appear only after the worker's next fetch; refresh is rate-limited"],
  },
  {
    key: "ai_credits.distribute",
    action: "Distribute the college's AI credit pool to students",
    surface: "college",
    roles: "college_admin",
    route: "/c/:slug/ai-credits",
    navigate: "College nav → People → AI credits → Allocate credits",
    affordance: "Allocate credits → Allocate to N (Excel preview/template available)",
    controls: ["Allocate credits"],
    prerequisites: ["AI feature enabled + a Stage-1 credit pool for the college"],
    gates: "AI feature + college_admin (faculty/students can't manage distribution)",
    failureModes: [
      "OVER_ALLOCATION — allocating more than the pool",
      "Credits reset monthly; unused don't roll over",
    ],
  },
  {
    key: "analytics.read",
    action: "View college analytics",
    surface: "college",
    roles: "college_admin / faculty (read-only)",
    route: "/c/:slug/analytics",
    navigate: "College nav → Insights → Analytics (overview / by org-unit / per student)",
    affordance: "(read-only dashboards; no actions)",
    prerequisites: ["Students with activity (exams/essays/challenge) to populate it"],
    gates: "ANALYTICS feature + requireFaculty (faculty scoped to their units)",
    failureModes: [],
  },
];

// --- route validation (Step 41: a guide step may only deep-link to a map route) --

/** Collapse route params so a step's route compares equal regardless of :param
 *  spelling. Mirrors the normaliser in the capability-map integrity test. */
function normalizeRoute(p: string): string {
  return p.replace(/:[^/]+/g, ":p").replace(/\/+$/, "") || "/";
}
const KNOWN_ROUTES = new Set(ADMIN_CAPABILITIES.map((c) => normalizeRoute(c.route)));

/** True when `route` matches a capability-map route (which the Step-40 test asserts
 *  exists in App.tsx). A guide step whose route fails this has its link stripped. */
export function isKnownRoute(route: string): boolean {
  return KNOWN_ROUTES.has(normalizeRoute(route));
}

// --- lookup + the read tool that exposes the map to the guide ----------------

const capabilityQuerySchema = z.object({
  query: z.string().trim().max(200).optional(),
});

function score(cap: AdminCapability, terms: string[]): number {
  const hay = [
    cap.key,
    cap.action,
    cap.surface,
    ...cap.prerequisites,
    ...cap.failureModes,
    cap.notes ?? "",
  ]
    .join(" ")
    .toLowerCase();
  return terms.reduce((s, t) => (hay.includes(t) ? s + 1 : s), 0);
}

/** No query → a compact index; a query → the best-matching FULL entries (or an
 *  empty list, which the guide reads as "the product can't do this"). */
export function lookupCapabilities(query?: string): unknown {
  const q = (query ?? "").trim().toLowerCase();
  if (!q) {
    return {
      index: ADMIN_CAPABILITIES.map((c) => ({
        key: c.key,
        action: c.action,
        surface: c.surface,
      })),
    };
  }
  const terms = q.split(/\s+/).filter((t) => t.length > 2);
  const matches = ADMIN_CAPABILITIES.map((c) => ({ c, s: score(c, terms) }))
    .filter((r) => r.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, 5)
    .map((r) => r.c);
  return { matches };
}

export const capabilityTool: RegisteredTool = {
  name: "capability_details",
  kind: "read",
  access: "both",
  needsCollege: false,
  description:
    "Look up how an admin performs an action: route, navigation, the exact button, prerequisites, gate, and common failure modes. Call this FIRST for any 'how do I…' question. Pass keywords (e.g. 'publish composite', 'attach game set course', 'create topic'). An empty matches list means the product has no such action.",
  argHint: "{ query?: string } — keywords; omit to list all action keys",
  parse: (raw) => capabilityQuerySchema.parse(raw),
  run: async (_ctx, args) =>
    lookupCapabilities((args as { query?: string }).query),
};
