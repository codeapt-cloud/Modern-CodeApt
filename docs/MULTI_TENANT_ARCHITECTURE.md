# CodeApt Multi-Tenant (College) Architecture

**Status:** authoritative design. Phase 0 (this document + the foundation code)
is built. Later phases MUST conform to this spec; if a later need contradicts
it, update this doc first.

This turns CodeApt from a B2C product (individual learners) into a **B2B2C**
platform: CodeApt (a super admin) provisions **colleges** (tenants), grants each
a controlled subset of features + courses, and each college's admins/faculty
operate their own **tenant-isolated** space — without disturbing the existing
individual-learner product.

---

## 1. Core model: role × userType × tenant

Three orthogonal axes live on the `User`:

| Axis | Field | Values | Meaning |
|---|---|---|---|
| **Authority** | `role` | `super_admin`, `college_admin`, `faculty`, `student`, `admin`*(legacy)* | What the user may do. |
| **Population** | `userType` | `individual`, `college` | Which world the user lives in. |
| **Tenant** | `college` | `ObjectId` \| `null` | The college a user belongs to (null for individual users + super admins). |

- **`admin` (legacy)** is retained so all existing B2C data, flows and tests
  validate unchanged. It denotes the original platform administrator and has the
  **same authority as `super_admin`**. The tenancy backfill maps existing
  `admin` → `super_admin`; guards treat the two identically.
- **`userType` defaults to `individual`** so every pre-existing user (and every
  future individual signup) stays in the untouched B2C world.
- **`college` is null** for individual users and for super admins (platform
  owners are not tenant-scoped).

### Authority hierarchy

Higher tiers are supersets of lower ones (source of truth:
`@codeapt/shared` → `PLATFORM_ADMIN_ROLES ⊃ COLLEGE_ADMIN_ROLES ⊃ FACULTY_ROLES`):

```
super_admin / admin(legacy)  ⊃  college_admin  ⊃  faculty  ⊃  student
```

So a `super_admin` passes every college guard, a `college_admin` passes the
faculty guard, and so on.

### Permission matrix

| Capability | super_admin / admin | college_admin | faculty | student (college) | individual |
|---|---|---|---|---|---|
| Provision colleges, set entitlements, grant courses | ✅ (all) | ❌ | ❌ | ❌ | ❌ |
| Manage the master catalog (existing B2C admin surface) | ✅ | ❌ | ❌ | ❌ | ❌ |
| Resolve `/c/:slug` tenant context | ✅ (any college) | ✅ (own) | ✅ (own) | ✅ (own) | ❌ |
| Administer a college (org-units, faculty, students — later phases) | ✅ (any) | ✅ (own) | ❌ | ❌ | ❌ |
| Faculty actions within managed org-units (later phases) | ✅ | ✅ (own) | ✅ (own scope) | ❌ | ❌ |
| Consume college features (exams/essays/… — later phases) | ✅ (bypass entitlements) | ✅* | ✅* | ✅* | ❌ |
| Existing B2C flows (courses, exams, essays, careers as an individual) | ✅ | — | — | — | ✅ |

`*` = subject to the college's **entitlements** (feature/sub-capability/course
grants). Platform admins **bypass** entitlement checks (they own and grant them).

### Guard mapping (apps/api/src/middleware/require-role.ts)

| Guard | Accepts | Notes |
|---|---|---|
| `requireSuperAdmin` | super_admin, admin | Platform owner. Provisions colleges. |
| `requireCollegeAdmin` | + college_admin | Super admins supersede. |
| `requireFaculty` | + faculty | College admins & super admins supersede. |
| `requireAdmin` *(legacy, retained)* | super_admin, admin | **Behaviourally unchanged** for the existing B2C admin routes — a legacy `admin` still passes, and migrated `super_admin`s do too. |

---

## 2. Data model

### College (tenant) — built in Phase 0 (`apps/api/src/models/college.model.ts`)

| Field | Type | Notes |
|---|---|---|
| `name` | string | Display name. |
| `slug` | string, **unique** | Stable URL key for `/c/:slug`. Immutable after creation. |
| `status` | `active` \| `suspended` | Suspended blocks college users (not platform admins). |
| `contactEmail`, `contactPhone` | string | Contact info. |
| `createdBy` | ObjectId → User | The provisioning super_admin. |
| `entitlements` | sub-document | See §3. |
| `createdAt`, `updatedAt` | Date | Timestamps. |

### User — extended ADDITIVELY in Phase 0 (`user.model.ts`)

Added: `userType` (default `individual`), `college` (default `null`),
`facultyScope` (`{ orgUnits: [ObjectId → OrgUnit] }`, default empty). Existing
fields, indexes (`username` unique, partial-unique `email`, partial-unique
Profile `rollNumber`) and flows are untouched. New index: `{ college, role }`
for tenant membership lookups.

- **`facultyScope`** is modelled now, populated in Phase 2 — it records which
  org-units a faculty member manages.

### Org-units — BUILT in Phase 2a (`apps/api/src/models/org-unit.model.ts`)

A single `OrgUnit` collection models the college's academic structure as a tree,
tenant-scoped by `college`:

| Field | Type | Notes |
|---|---|---|
| `college` | ObjectId → College, **required** | Tenant scope (always present). |
| `type` | `department` \| `year` \| `section` \| `semester` | `OrgUnitType` enum (extensible). |
| `name` | string | e.g. "CSE", "2026", "A", "Sem 5". |
| `parent` | ObjectId → OrgUnit \| null | `null` = root-level unit. |
| `order` | number | Stable display order among siblings. |

**Indexes:** `{ college, parent, type }` (tree reads) and a tenant-scoped unique
`{ college, parent, name }` — a name is unique among its siblings (same college
+ parent). Additive; touches no global index.

**Nesting rule (flexible, lenient).** A root unit (`parent = null`) may be ANY
type. Nesting under a parent must satisfy `canNestUnder(parentType, childType)`
(`@codeapt/shared`), backed by `ORG_UNIT_ALLOWED_CHILDREN`:
`department → {year, section, semester}`, `year → {section, semester}`,
`section → {semester}`, `semester → {}`. This allows the full chain and common
shortcuts while rejecting nonsense and same-type nesting. Because the type graph
is acyclic, well-typed trees can't cycle; re-parenting is additionally
cycle-checked (self / descendant → `ORG_UNIT_CYCLE`) as a hard guard.

**Delete guard.** Deleting a unit with child units is blocked
(`ORG_UNIT_HAS_CHILDREN`). *Phase 3 seam:* delete must ALSO block a unit that
has students assigned (`student.orgUnit`) — noted in the service, built in
Phase 3.

**Writes** are `requireCollegeAdmin`; the **tree read** is allowed to
`requireFaculty` (faculty may view their structure). All routes are tenant-scoped
at `/c/:collegeSlug/org-units` and go through `createTenantScope`.

### Faculty (BUILT in Phase 2a)

A faculty member is a **college User**: `role = faculty`, `userType = college`,
`college` = the tenant, `forcePasswordChange = true` at creation (they set their
own password on first login — reuses the existing forced-change flow), and a
validated `facultyScope.orgUnits` set. Every assigned org-unit is verified to
belong to THIS college (a foreign/unknown id → `FACULTY_SCOPE_INVALID`).
Creation reuses the existing secure conventions (argon2 `hashPassword`,
username/email uniqueness, User+Profile with rollback; faculty get a per-user
placeholder `rollNumber` `STAFF-<id>` to satisfy the required+partial-unique
Profile index). Deactivation is a **soft** status flip (`isActive = false` +
`tokenVersion` bump to kill sessions), preserving records.

Faculty routes are at `/c/:collegeSlug/faculty`, gated by `requireCollegeAdmin`
**plus** the `faculty_management` FEATURE entitlement (platform admins bypass
the entitlement; college_admins are subject to it).

### College students + bulk import (BUILT in Phase 3a)

A college student is a **User**: `role = student`, `userType = college`,
`college` = the tenant, `orgUnit` = the single assigned OrgUnit, and
`rollNumber` stored **on the User** (not Profile). They are created with the
shared temp password (`env.BULK_ENROLL_DEFAULT_PASSWORD`) + `forcePasswordChange`
so the student sets their own password on first login. Their **login handle
(`username`) is their email** (globally unique; roll numbers can't be, since they
repeat across colleges). The Profile carries a per-user placeholder roll
(`STU-<id>`) so the legacy required + global-unique `Profile.rollNumber` index is
satisfied without colliding across colleges — mirroring faculty's `STAFF-<id>`.
Individual (B2C) students are a **separate population** and are untouched.

**Per-college roll uniqueness** is a new ADDITIVE compound partial index on
`User`: `{ college: 1, rollNumber: 1 }`, unique, with
`partialFilterExpression: { college: { $type: "objectId" }, rollNumber: { $gt: "" } }`
— so it applies ONLY to college students (both fields present). Individual users
(`college: null`) and faculty (no `User.rollNumber`) are excluded, so **two
colleges may reuse the same roll number**, and the existing global
`Profile.rollNumber` index is left exactly as-is. A `{ college: 1, orgUnit: 1 }`
listing index is also added.

**Scope.** A `college_admin` (or platform admin) is UNRESTRICTED across the
tenant. A `faculty` member may only add/see/manage students within their assigned
org-units **and all descendants** — computed by the pure, tested
`collectDescendantUnitIds` (`@codeapt/shared`) over the tenant's parent-pointer
refs. Every student query runs through `createTenantScope`, so it can never cross
a tenant boundary.

**Import pipeline (validate → preview → commit) is PARSE-AGNOSTIC.** The core
consumes an array of raw `{ fullName, email, rollNumber, orgUnit }` rows; the UI
(Phase 3b) produces those from an uploaded file OR a pasted table, so the backend
never parses a file format. `orgUnit` is a human key — a slash-separated PATH
("CSE / 2026 / A") or a unique bare name — matched via `normalizeUnitKey` against
the college's tree. One shared `evaluateRows` pass (used by BOTH preview and
commit, so verdicts always agree) runs pure field validation, resolves +
scope-checks the org-unit, and flags duplicates within the batch AND against
existing college students (per-college roll, global email):

- **`preview`** returns a per-row verdict (`ok` = will create / `error` with
  reasons) + a summary `{ total, ok, errors }`, and **writes nothing** — the
  safety net.
- **`commit`** creates the `ok` rows with per-row rollback safety (no
  standalone-Mongo transactions), reporting `created` / `skipped` (invalid or
  duplicate — so re-committing is **idempotent-ish**) / `failed` (unexpected).

Both are gated by the **`bulk_import`** FEATURE entitlement and faculty scope.
A **downloadable template** (`GET .../students/import/template`) returns a sample
CSV whose headers exactly match the parser (`fullName,email,rollNumber,orgUnit`).

**Routes** (full tenant stack) at `/c/:collegeSlug/students/...`:
`GET`/`POST .../students` (list + single-add; `requireFaculty`, scope enforced in
the service), `POST .../students/import/preview|commit` and
`GET .../students/import/template` (+ `requireFeature('bulk_import')`), and
`DELETE .../students/:id` (soft-deactivate). `deleteOrgUnit` now ALSO blocks a
unit with students assigned (**`ORG_UNIT_HAS_STUDENTS`**), completing the Phase 2a
seam.

### College courses (BUILT in Phase 4a)

Establishes the Phase-4 pattern: **reuse the existing engine, tenant-scoped,
feature-gated** — no forking. A college assigns the super-admin-GRANTED courses
to its students; students learn them through the SAME course player.

- **Assignment model = the existing `Enrollment` record, additively.** A college
  assignment is an `Enrollment { user: student, subject: course, source:
  "college", college: <tenant> }`. Because the whole access/player/progress engine
  keys off `Enrollment(user, subject)`, an assigned student's course "just works"
  through the existing player with **zero forking**. Individual (B2C) enrollments
  (`college: null`, source `order`/`manual`) are untouched; the unique
  `(user, subject)` index is unchanged (college students are a separate user
  population). Additive `{ college: 1, subject: 1 }` index for assignment reads.
  *Why reuse vs a new record:* a separate assignment record would force the
  player's access check to learn about it (a fork); reusing `Enrollment` means the
  access path is literally unchanged.
- **Gating.** The `courses` FEATURE (route guard) **and** the course being in
  `College.grantedCourses` (`isCourseGranted`) — a college can only assign what it
  was granted. Faculty may only assign to students within their org-unit scope
  (`resolveActorScope`, shared with the student service); college_admin/platform
  admin are unrestricted.
- **Student access path (reuses the player).** A college student's assigned
  course is an enrollment, so it appears on their normal dashboard via
  `/me/enrollments` and opens in the existing `/learn/:slug` player — no
  college-specific student UI. College students **cannot self-enroll** from the
  public catalog (the enroll endpoint 403s `userType === "college"`), so their
  access is exactly the set of courses assigned to them. Access is inherently
  tenant-safe: an assignment is tied to one student user, and that student can
  only ever hold enrollments their own college created.
- **Deactivate/revoke consistency.** Revoke deletes the college enrollment
  (access lost immediately); a deactivated student can't authenticate at all
  (`isActive:false` + `tokenVersion` bump), so neither retains access. No cascade
  needed. `deleteOrgUnit` already blocks units with students, so assignments are
  never orphaned by structure deletes.

**Routes** (full tenant stack + `requireFeature('courses')` + `requireFaculty`)
at `/c/:collegeSlug/courses/...`: `GET .../courses/catalog` (granted courses +
assignment counts), `GET .../courses/:courseId/students` (assigned, scope-
filtered), `POST .../courses/:courseId/assign|revoke` `{ studentIds }`
(idempotent; faculty-scope enforced). The bare `GET /c/:slug/courses` (granted-
course spine) is unchanged; the management API uses distinct sub-paths. UI: a
`courses`-gated **Courses** entry in the college nav → a page listing granted
courses with an **Assign students** dialog (roster + org-unit filter, per-student
toggle + bulk "assign all shown").

### College exams (BUILT in Phase 4b-i — backend)

The same **reuse-tenant-scoped-feature-gated** pattern applied to the exam engine.
A college exam is the SAME engine (sections, MCQ/CODE questions, per-section
server timers, attempts, code execution, proportional grading, public links,
bulk upload, results, attempt-limit resets) — nothing is forked.

- **The one structural friction + its additive resolution.** Individual exams
  are **1:1 with a curriculum `Topic`** (`Exam.topic` was `required + unique`) and
  have no tenant/visibility state; availability is derived purely from enrollment
  in the topic's subject. A college exam must NOT hang off a shared master-topic
  (that topic — and thus the exam — is visible to every college granted the
  course, breaking isolation). So a college exam is **standalone**: `topic` is
  ABSENT. This required making `Exam.topic` **optional**, with its 1:1 guarantee
  preserved for individual exams by a **partial unique index** (`unique` only over
  docs whose `topic` is an ObjectId) — the exact pattern already used for
  per-college roll numbers (Phase 3). Individual exams (always topic-bearing) keep
  their identical uniqueness + behavior; this is proven by the existing exam suite
  staying green.
- **Additive model fields.** `Exam += { college (null=individual/global),
  orgUnits (target cohort; empty = college-wide), isPublished (draft→published;
  ignored for individual exams) }`; partial-unique `{topic}` + new `{college}`
  index. `StudentExamAttempt += { college }`, **auto-stamped from the exam** in
  the shared `createAttempt` (individual attempts get `null` = the default, so the
  path is unchanged) → a college's attempt/result data is tenant-isolated; new
  `{college, exam}` index. No existing required field or index behavior changes
  for individual exams.
- **Authoring (`requireFaculty` + `requireFeature('exams')`, tenant + scope).**
  A dedicated `createCollegeExam` tenant-tags the exam via `createTenantScope`;
  **every other authoring op reuses `exam-admin.service` unchanged** through thin
  wrappers that first resolve the target's owning exam and assert it belongs to
  this tenant (`scope.filter` → cross-tenant simply 404s) and is within the
  actor's org-unit scope (faculty may only manage exams targeted within their
  scope; college_admin/platform admin unrestricted). Sections/questions/test-
  cases/public-links/bulk-upload/delete/reset-attempts all delegate to the
  existing service — one engine, tenant-gated.
- **Taking (reuses the attempt engine wholesale).** A college student lists their
  college's PUBLISHED exams (org-unit-target-filtered) and starts via
  `POST /c/:slug/exams/:examId/attempts`, which validates tenant + publish +
  cohort, then delegates to the engine's `startAttempt`. The attempt LIFECYCLE
  (section view / save / advance / submit / finalize / result / warning) is the
  **shared `/attempts/*` engine**, authorized by attempt ownership — a college
  student rides it unchanged (no duplicated engine, no new take endpoints beyond
  list + start).
- **Results (tenant-scoped read).** `GET /c/:slug/exams/:examId/results` returns
  only THIS college's attempts (`scope.filter({exam})` over the tenant-tagged
  attempts). Basic per-exam results here; **the rich dept/section/individual
  analytics is the Phase 5 seam** (the `{college, exam}` + `orgUnits` data model
  already supports the roll-up).
- **Isolation (the hard boundary, proven by tests).** College A's exam is
  invisible/untakeable to College B (cross-tenant author/read → `resolveTenant`
  403 or tenant-scoped 404) and to individual users (non-members → 403). Feature
  off → 403; faculty out-of-scope → 403. Individual/global exams are unaffected
  (they never carry `college`, are never surfaced by the tenant routes, and the
  full existing exam suite stays green).

**Routes** at `/c/:collegeSlug/exams/...` (full tenant stack + `requireFeature('exams')`;
authoring adds `requireFaculty`): student `GET /exams` + `POST /exams/:id/attempts`;
authoring `GET /exams/manage`, `POST /exams`, `GET|PATCH|DELETE /exams/:id`,
`POST /exams/:id/publish|reset-attempts|bulk-upload|sections|public-links`,
`GET /exams/:id/results`, and the flat `PATCH|DELETE /exam-sections|exam-questions|
exam-test-cases|exam-public-links/:id` + `POST /exam-questions[/:id/test-cases]`.

### Campus Assessments UI (BUILT in Phase 4b-ii-A — authoring/management)

The college-operator authoring surface, in the workspace shell, over the 4b-i API
— **reusing the platform-admin exam editor, not forking it**:
- **Reuse via an injected api layer.** The admin editor components
  (`SectionEditorDialog`, `QuestionEditorDialog`, `TestCaseEditor`,
  `BulkUploadDialog`, `PublicLinksDialog`, and the extracted `ExamSectionCard`)
  take an optional `authApi: ExamAuthoringApi` prop that defaults to
  `api.adminExams` — so the admin editor is behaviourally unchanged. The college
  editor injects `collegeExamAuthoringApi(slug)` (a slug-bound adapter over
  `api.collegeExams`, satisfying the same interface), so the SAME components drive
  both surfaces. `ExamSectionCard` was extracted verbatim from
  `AdminExamEditorPage` so both editors render sections identically.
- **College-specific (thin variants, not forks).** Exam create/settings is a plain
  form with **org-unit targeting** (`CollegeExamSettingsDialog` +
  `OrgUnitTargetPicker`) — no curriculum-topic picker, since college exams are
  standalone. The **draft→published** lifecycle (publish disabled until ≥1
  question; the server still 400s `EXAM_NOT_PUBLISHABLE`). **Results** is a
  tenant-scoped JSON table (`CollegeExamResultsPage`) with per-row audited
  attempt reset — not the admin xlsx export (the college backend has no
  `results.xlsx` / attempt-counter/audit-log reads; those admin-only reads make
  `AttemptManagementDialog` unreusable here, so reset is surfaced per results row
  instead). Targeting is enforced server-side (faculty ≥1 in-scope unit); the
  client shows the full tree and surfaces the 403 inline, since the tenant context
  doesn't expose a faculty member's unit scope.
- **Pages** (`/c/:slug/exams`, `/c/:slug/exams/:id`, `/c/:slug/exams/:id/results`)
  live in `CollegeLayout`; the `exams` nav section flipped from `coming_soon` to a
  real route (still `exams`-feature-gated → "Not enabled" when off), so the
  dashboard tile + Learning ▸ Exams nav light up automatically (catalog-driven).
- **Pure helpers, unit-tested:** `exam-targeting` (empty = college-wide; faculty
  ≥1; id→path chips) and the `collegeExamAuthoringApi` slug-binding adapter.

### Student take surface (BUILT in Phase 4b-ii-B)

A college student takes their exams through the **existing learner runner, not a
fork** — completing college exams end-to-end (author → publish → take → results):
- **Where they reach it.** _(Superseded by the college student space, Phase 5c-i —
  a college student now lands in their own `/c/:slug/home`, see below. The learner
  surfaces described here remain fully reachable via **Switch to personal
  account**, and part ii re-homes them into the student space.)_ Their college
  exams surface in the learner **Mock Exams** page (`/exams`) they
  already have — the least-surprising place. `ExamsPage` fetches the individual
  list (`api.exams.list`) AND, via `api.me.college`, the student's college exams
  (`GET /c/:slug/exams`), and `mergeStudentExams` shows college exams first. An
  individual user (no college) sees exactly the previous flat list. The college
  fetch degrades to empty on error (e.g. `exams` feature off) so the page never
  breaks.
- **Only list + start are tenant-scoped.** The shared `/attempts/*` lifecycle is
  authorized by attempt ownership, so once an attempt exists the SAME
  `<ExamRunner>` (ReadyScreen → sections → timer → MCQ + CODE execution →
  submit → finalize → result) drives it unchanged. The seam is a `?c=<slug>` query
  param: `ExamStatusCard` appends it for college exams, and `ExamRunnerPage` reads
  it to pick the tenant list + start (`api.collegeExams.studentList/studentStart`)
  vs the individual ones. No `?c` → the individual take flow is byte-for-byte
  unchanged. Pure `mergeStudentExams` is unit-tested.
- **Enforcement.** The backend returns only published, in-cohort exams and 403s a
  non-member / off-feature / out-of-cohort start — the UI just reflects it; no
  cross-tenant leakage.

College exams are now **complete end-to-end**.

### College essays (BUILT in Phase 4c-i — backend)

The same **reuse-tenant-scoped-feature-gated** pattern applied to the essay engine.
A college essay is the SAME engine — the prompt/keywords/config, the writer +
autosave drafts, the per-topic attempt cap, and the whole async grading pipeline
(deterministic 7-dimension weights + optional LLM blend + advisory risk scoring) —
nothing is forked.

- **No structural friction (unlike exams).** Essay topics are already
  **standalone** (`EssayTopic` has no curriculum coupling and no unique index tying
  it to anything), so tenant-scoping is purely additive — no partial-index dance.
- **Additive fields.** `EssayTopic` gains optional `college` (ref, default null),
  `orgUnits` (`[]`), `isPublished` (`false`) + a `{ college: 1 }` index.
  `EssayAttempt` gains `college` (default null), auto-stamped at submit from
  `topic.college` (null for individual essays) + a `{ college: 1, essayTopic: 1 }`
  index. Existing required fields/indexes are untouched.
- **Why individual essays are unaffected.** An individual essay has `college=null`
  and is surfaced ONLY through the enrollment browse path
  (`enrolledEssayTopicIds` → curriculum `Topic.essayTopic`), which college topics
  (no curriculum link) never enter — so `isPublished`/`orgUnits` are simply unused
  on that path and `requireAccessibleTopic` never sees a college topic. Conversely
  every college query goes through `createTenantScope`, so an individual/global
  topic (college:null) never matches. Isolation holds both ways.
- **Delegate, don't fork.** The submit/draft/history logic was refactored into
  `*ForTopic` **cores** in `essay.service.ts` that take an already-access-checked
  topic (`submitEssayForTopic` / `saveDraftForTopic` / `getLatestDraftForTopic` /
  `listSubmissionsForTopic`); the individual public functions are now thin
  `requireAccessibleTopic → core` wrappers (behavior identical). `college-essay.service`
  runs its OWN tenant + org-target access check, then calls the same cores — so the
  grading pipeline and attempt-cap/word-bounds logic are shared verbatim. Authoring
  delegates to `essay-topic-admin.service` (topic CRUD, the reference-safe delete,
  the LLM keyword generator) tenant-tagged via `scope.attach`.
- **Grading-status poll + analytics are shared.** `getGradingResult` /
  `recordAnalytics` authorize by attempt **ownership** (not topic access), so a
  college student polls `GET /essays/submissions/:jobId` and posts analytics on the
  existing global endpoints unchanged — not duplicated (mirrors exams' shared
  `/attempts/*`).
- **Authoring** is college_admin (any in-tenant) / faculty (only topics targeted
  within their org-unit scope, `facultyScope.orgUnits`); **publishing** requires a
  real prompt (non-empty description or instructions → else `400
  ESSAY_NOT_PUBLISHABLE`, mirroring the exam publish guard). **Writing** is by that
  college's students whose org-unit is in the topic's target (empty = college-wide),
  graded by the reused pipeline. **Results** are tenant-scoped reads (who in this
  college wrote it + scores); **rich dept/section analytics is the Phase 5 seam**
  (the `{college, essayTopic}` + `orgUnits` model already supports the roll-up).
- **Isolation (proven by tests).** College A's topic is invisible/inaccessible to
  College B (tenant-scoped 404) and to individual users (never in the enrollment
  list, 404 on the individual endpoint); feature off → 403; faculty out-of-scope
  target → 403; unpublished/not-targeted → not listed + not writable. Individual
  essays are unaffected (the full existing essay suite stays green).

**Routes** — authoring at `/c/:collegeSlug/essay-topics/...` (mirrors the admin
`/admin/essay-topics`; full tenant stack + `requireFeature('essays')` +
`requireFaculty`): `GET|POST /essay-topics`, `POST /essay-topics/generate-keywords`,
`GET|PATCH|DELETE /essay-topics/:id`, `POST /essay-topics/:id/publish`,
`GET /essay-topics/:id/results`. Writing at `/c/:collegeSlug/essays/...` (member +
`essays`): `GET /essays`, `GET /essays/:id`, `GET|PUT /essays/:id/draft`,
`POST /essays/:id/submit`, `GET /essays/:id/submissions`. The two prefixes never
collide on `/:id`.

### College essay UI (BUILT in Phase 4c-ii)

The authoring + writing UI, over 4c-i — **reusing the platform-admin essay editor
and the student essay writer, not forking either** (mirrors 4b-ii's two seams):
- **Authoring — injected `authApi`.** The admin `EssayTopicEditorDialog` (topic
  form + AI keyword generation) took an optional `authApi: EssayAuthoringApi`
  (default `api.adminEssayTopics`) + an optional `targeting` prop. The college
  authoring page (`CollegeEssaysPage` at `/c/:slug/essays`) injects
  `collegeEssayAuthoringApi(slug)` and passes `targeting` (the reused
  `OrgUnitTargetPicker`) — so the SAME dialog authors both, with org-unit
  targeting + a draft→published lifecycle (publish disabled until a prompt exists;
  `ESSAY_NOT_PUBLISHABLE` still enforced server-side). Results is a tenant-scoped
  table (`CollegeEssayResultsPage`). The essay editor is a dialog (not a page, since
  a topic is single-object), opened from the list. The admin essay UI is
  behaviourally unchanged (default authApi, no targeting).
- **Writing — `?c=<slug>` + injected `writerApi`.** College students land in the
  learner app (like exams), so their essays surface in the learner **Essays** page
  (`/essays`), merged in front of individual essays (`mergeStudentEssays`).
  Opening a college essay carries `?c=<slug>`; `EssayWriterPage` builds a
  `collegeEssayWriterApi(slug)` and threads it through the reused writer + its two
  hooks (`useEssayGrading`, `useEssayDraft`) + `EssayComposer`. Only
  list/detail/draft/submit/submissions are tenant-scoped; the grading **poll +
  analytics** fall through to the SHARED ownership-authorized `/essays/submissions/:jobId`
  endpoints — so the compose→autosave→submit→grade→result flow (and the grading
  pipeline) is reused verbatim. No `?c` → the individual writer is byte-for-byte
  unchanged.
- The `essays` nav section flipped from `coming_soon` to a live, entitlement-gated
  route, so the dashboard tile + Learning ▸ Essays light up automatically.
- **Pure helpers, unit-tested:** `mergeStudentEssays` + the `collegeEssayAuthoringApi`
  slug-binding adapter.

College essays are now **complete end-to-end** (author → publish → write → grade →
results), UI included.

### College challenges (BUILT in Phase 4d)

Challenges did **not** fit the exam/essay authoring pattern, so the scope was
chosen from the engine, not assumed. The engine is a **daily challenge**: ONE
global problem per IST day (`DailyQuestion.releaseDate` unique **globally**), no
access gate (`getToday` serves every authenticated user the same problem), a
**global** leaderboard + per-user streaks (`UserStreak`), authored only by the
super-admin. So:
- **Rejected (A) authoring** — per-college daily problems collide with the global
  `releaseDate`-unique model and would fork the leaderboard + streaks per tenant.
- **Rejected (B) assignment** — there is no reusable challenge *bank* to assign;
  challenges are date-bound daily questions.
- **Built (C→D) a tenant-scoped LEADERBOARD** — the college-specific artifact the
  sub-capability catalog already earmarked (`SUB_CAPABILITY_CATALOG[challenges] =
  ["leaderboard"]`). The daily challenge stays the shared global experience every
  student solves in the learner app (**unchanged**); the college gets a view of
  **its own students'** standings.

**Design.** `GET /c/:slug/challenges/leaderboard` (tenant stack + `requireFeature('challenges')`
+ `requireFaculty` — an operator insight) → `college-challenge.service` reuses the
same `UserStreak` the global board sorts, scoped to the college's members.
`UserStreak` has **no `college` field** (streaks are per-user + global), so the
tenant boundary is applied via the **User set** — `createTenantScope` over
`UserModel` (which carries `college`) yields the member ids, and the streak query
filters to them. **No model/engine change at all** — the daily challenge + all
individual flows are literally untouched (strongest possible "byte-for-byte",
proven by the existing challenge suites staying green). Ranking/hydration mirror
the global leaderboard; rows add the per-college `rollNumber`. Rich
per-department/section analytics is the Phase 5 seam.

**UI.** `CollegeChallengesPage` (`/c/:slug/challenges`) renders the leaderboard
(rank/student/roll/score/streak/best), feature-gated with an honest "not enabled"
state, and notes that students solve the daily challenge in their learner app. A
new `challenges` section was **added** to the nav catalog (Learning group,
`CollegeFeature.CHALLENGES`), so the dashboard tile + Learning ▸ Challenges
auto-light. The student daily-challenge experience is the **existing global** one
(no `?c` learner surface needed — the daily problem is identical for everyone), so
the learner app is unchanged.

College challenges are **complete** within the recommended scope.

### College analytics (BUILT in Phase 5a-i — backend)

A tenant + faculty-scoped **READ-ONLY aggregation** over the Phase 4 data — no
engine/model/write-path change (proven by every existing suite staying green). It
rolls the real data up three ways behind the `analytics` feature (+ `requireFaculty`):

- **Data sources (all tenant-scoped).** exams → `StudentExamAttempt {college,user,score,passed}`;
  essays → `EssayAttempt {college,user,finalScore,gradingStatus}`; courses →
  `Enrollment {college,source:'college',user}`; challenges → `UserStreak`
  (no `college` field → scoped via the college's **User set**, as in 4d). The
  student population is the actor's scope, reusing `listCollegeStudents` +
  `resolveActorScope` (college_admin = whole college; faculty = their org-units +
  descendants) — so faculty scope is enforced exactly once, the same way as the
  roster.
- **Three levels.** OVERVIEW (`GET /c/:slug/analytics/overview`) — headline
  metrics over the scope. BY ORG-UNIT (`.../by-org-unit`) — per-unit rollups for
  every unit the actor may see, each aggregating the students in its **subtree**
  (`collectDescendantUnitIds`), returned flat with `parentId`+`type` so the UI
  nests dept→section. INDIVIDUAL (`.../students/:id`) — one student's cross-artifact
  profile, tenant-checked (cross-tenant → 404) + faculty-scope-checked
  (out-of-scope → 403).
- **Honest metrics only.** exams → attempts / distinct students / mean raw score /
  pass-rate%; essays → submissions / graded / mean final score (graded only);
  courses → **assignment counts only** (the enrollment engine tracks no
  per-enrollment progress — no fabricated completion %); challenges → participants
  / avg score / avg current streak. Rich per-artifact / time-series analytics is a
  later Phase 5 step.
- **Design.** `college-analytics.service` fetches the four sources in a batched,
  tenant-filtered pass (no N+1), then all avg/pass-rate/distinct math lives in the
  pure, unit-tested `lib/analytics-rollup` (`mean`/`pct`/`aggregateExams|Essays|Courses|Challenges`).
  Read-only; UI is Phase 5a-ii.
- **Isolation (proven by tests).** College A's numbers exclude College B; a
  cross-tenant student profile 404s; feature off → 403; a section-A faculty sees
  only A's students in overview + rollups + individual, and is denied a section-B
  student's profile.

### College analytics UI (BUILT in Phase 5a-ii)

The analytics dashboard in the college shell (`CollegeAnalyticsPage` at
`/c/:slug/analytics`), over the 5a-i endpoints — feature-gated with an honest
"not enabled" state, and **carrying the 5a-i honesty into the UI**. Three tabs
(Radix `Tabs`):
- **Overview** — headline `StatCard`s (students, exam attempts, avg exam score,
  exam pass-rate %, essay submissions, avg essay score, **course assignments** —
  labelled "progress not tracked", never a fake bar — and challenge participants)
  reusing the dashboard's card + spring count-up, plus a dependency-free
  participation comparison (CSS bars). Honest empty state when there are no
  students.
- **By department** — a department picker → its sections rendered as a comparison
  table + "avg exam score by unit" bars; a faculty scoped below the department
  level (no departments in scope) gets a flat comparison of the units they can
  see. Reflects faculty scope (the endpoint only returns in-scope units).
- **Students** — a scope-aware searchable picker (the roster is already
  faculty-scoped) → a per-student profile card (exams attempts/avg/passed, essays
  submissions/graded/avg, course **assignments count**, challenge score/streak or
  "No activity"). An out-of-scope/cross-tenant profile surfaces the server's
  denial via the error state.
- **Reuse:** the dashboard's `StatCard` was extracted to
  `components/colleges/StatCard` (given an optional `decimals` prop) and is now
  shared by the dashboard + analytics — same card/motion language, no divergence.
  **No charting dependency was added** (none exists); charts are lightweight CSS
  bars from the pure, unit-tested `lib/analytics-view` (`departments`/`childrenOf`/
  `barPercent`/`maxOf`). The `analytics` nav section flipped from `coming_soon` to
  a live, entitlement-gated route, so the dashboard tile + Insights ▸ Analytics
  auto-light. Nothing backend or in the dashboard's behaviour changed.

### College postings / placements (BUILT in Phase 5b — the final feature)

Tenant-scoped placement postings over the REUSED careers engine — the LAST
feature; **the multi-tenant spec is now complete**.

- **Model (additive).** `Job` gains optional `college` (default `null`),
  `orgUnits` (`[]`), and `isPublished` (`false`) + index `{college:1,
  isPublished:1}`. `JobApplication` is **unchanged** — an application resolves
  tenancy through its parent posting, so no `college` field or write-path change.
  A college posting is a `Job` with `college` set, targeted at the whole college
  or specific org-units, with a draft→published lifecycle; `isActive` keeps its
  "open for applications" meaning.
- **Isolation.** The individual/global feed is hard-scoped to `college:null`
  (which also matches pre-tenancy docs with no field) in `careers.service`
  `listPostings`/`requirePublishedPosting`, so a college posting NEVER leaks into
  `/careers`, and an individual can't open/apply to one by id. Every college
  query routes through `createTenantScope`; cross-tenant reads 404. Individual
  careers stay byte-for-byte unchanged (proven by the existing `careers.test.ts`
  suite staying green).
- **Backend** (`college-careers.service.ts`, mirrors `college-exam.service`):
  authoring lifecycle (`createCollegePosting`/`list`/`get`/`update`/
  `setCollegePostingPublished`/`removeCollegePosting`) delegates to `careers-admin`
  (shared `postingUpsertFields`, reference-safe `deletePosting`, `listApplications`,
  `updateApplicationStatus`) after a tenant + faculty-scope check
  (`forManage` + `validateTargetUnits`/`assertPostingManageable`); the student
  flow (`listStudentCollegePostings`/`getStudentCollegePosting`/
  `applyToStudentCollegePosting`) verifies published + in-target + tenant, then
  reuses the engine's application model + apply-once unique index. Routes:
  `/c/:slug/postings/*` (authoring, `requireFaculty`) + `/c/:slug/careers/*`
  (student, member), both behind `requireFeature(postings)`; application status
  on `/c/:slug/posting-applications/:appId`.
- **UI reuse.** Authoring (`CollegeCareersPage` at `/c/:slug/postings`) reuses the
  platform-admin `PostingEditorDialog` via an injected `authApi`
  (`collegeCareersAuthoringApi(slug)`, `api.adminCareers` default) + org-unit
  `targeting` (the shared `OrgUnitTargetPicker`) + a draft→publish toggle;
  applicants are reviewed in `CollegeApplicationsDialog` (status dropdowns).
  Students see their published, in-target college postings **merged in front of**
  the global feed on the learner `/careers` page (`mergeStudentPostings`), each
  card tagged "Your college" and linking with a `?c=<slug>` seam so
  `PostingDetailPage` + `ApplyDialog` resolve/apply through the tenant endpoints —
  the reused detail + apply UI is otherwise identical. No forked editor/writer;
  the admin careers UI + individual browse/apply are byte-for-byte unchanged. The
  `postings` nav/tile flipped from `coming_soon` to a live entitlement-gated route,
  so Placement ▸ Placements + the dashboard tile auto-light. **Every catalogued
  nav section is now built — no `coming_soon` remains.**

### College workspace UI (BUILT in Phase 2b; reshelled + dashboard in Phase 4b)

The college_admin's tenant-scoped workspace lives at `/c/:collegeSlug/...` in the
web app, wrapped by `CollegeLayout`. The layout fetches `GET /c/:slug/context` —
the **real** boundary: a non-member or a suspended college 403s and the layout
renders an access state instead of the workspace. A coarse client guard
(`RequireCollegeMember`, from `FACULTY_ROLES`) keeps individual learners out
entirely.

**Shell — `CollegeTopNav` (Phase 4b).** The workspace uses a product-style **top
navigation** (not the learner sidebar): the college brand on the left, grouped
feature **dropdowns** in the middle (Academics / People / Learning / Placement /
Insights), and the account menu on the right (with the **Switch to personal
account** action). The nav model is pure and **catalog-driven +
entitlement-aware** (`apps/web/src/lib/college-nav.ts`, unit-tested): each section
maps to a real `CollegeFeature` and resolves to `available` (links), `locked`
("Not enabled" — shown, never a broken link) or `coming_soon` (roadmap features
with no UI yet: Exams, Essays, Placements, Analytics). Responsive: the dropdowns
collapse into a hamburger drawer below `lg`.

The college routes mount as their **own TOP-LEVEL route group** (a sibling of the
main app routes, NOT a child of the `AppLayout` shell), so `CollegeLayout` is the
ONLY shell and `/c/:slug/*` renders full-width. **Super-admin entry:** the console
(`AdminCollegesPage` rows + `CollegeManagePage` header) has an **Open workspace**
action → `/c/:slug`; since a platform admin passes `RequireCollegeMember` and
`resolveTenant`, they can enter and operate any college's space directly.
**Designating a college_admin:** `CollegeManagePage` has a **College admins** card
(list + *Add college admin*) backed by super-admin endpoints `GET`/`POST
/api/admin/colleges/:id/admins` (`createCollegeAdmin`/`listCollegeAdmins` — a User
with role=college_admin, userType=college, college=this, forcePasswordChange,
reusing the faculty creation conventions). That admin logs in, changes their
password, and (via the post-auth landing decision, `homePathForUser`) lands on
their workspace **dashboard**.

- **Dashboard** (`/c/:slug` and `/c/:slug/dashboard`, Phase 4b) — the landing an
  operator sees first. A header band (college identity + role), a row of live
  **stat cards** (students, faculty, org-units, course assignments, features
  enabled `N/9`), an **Admin utilities** tile grid (the same entitlement-aware
  catalog as the nav — available tiles link, locked/coming-soon tiles are honest
  and non-navigable), and honest panels (recently added students; enabled
  features). All counts come from ONE read: **`GET /api/c/:slug/summary`**
  (`getCollegeSummary`) — tenant-scoped, operators-only (`requireFaculty`), with
  the student total + recent list **faculty-scope-aware** (reuses
  `listCollegeStudents`); the other counts are tenant-wide facts. No feature-gated
  fan-out; the UI decides what to surface from entitlements.
- **Structure builder** (`/c/:slug/structure`) — a visual tree of the org-units.
  Low-friction creation is the priority: an inline creator on every node (and at
  root) offering **only valid child types** (driven by the shared `canNestUnder`
  rule via `validChildTypes`, never a hardcoded list), with a **Single** mode
  (name + enter) and a **Paste many** mode (comma/newline/tab separated →
  `POST .../org-units/bulk`, showing created vs skipped). Inline rename, and
  delete with the has-children block both pre-empted client-side and surfaced from
  the server. college_admins get write actions; faculty see a read-only tree.
- **Faculty** (`/c/:slug/faculty`) — gated by the `faculty_management` feature
  (a clear "not enabled" state when off, rather than a dead-end). Lists faculty
  with scope shown as **readable unit chips** (resolved from the tree, not raw
  ids); invite (basics + org-unit multi-select), edit-scope, and deactivate/
  reactivate.

**Routing spine — `GET /api/me/college`** (additive Phase-0 spine completion):
the `/me` shape did not carry the caller's college, so a college user had no way
to discover their `/c/:slug`. This endpoint returns `{ college: {id,name,slug,
status} | null }` (null for individuals) and drives the post-auth landing
decision + the "Back to college" account action in the learner app. Pure UI logic
(`validChildTypes`, `parsePastedNames`, `flattenTree`) lives in
`apps/web/src/lib/org-structure-ui.ts`; the nav/tile model
(`buildCollegeNav`, `resolveSections`, `sectionStatus`) lives in
`apps/web/src/lib/college-nav.ts`. Both are unit-tested.

### College STUDENT space (BUILT in Phase 5c-i — routing + shell + dashboard + switch)

A college student (role=student, **userType=college**) now gets their OWN space at
`/c/:slug/`, mirroring the operator home+switch **exactly but as a consumer** (not
a manager). Individual (B2C) learners, super_admin, and operators are unchanged.

- **Telling a college student apart.** `PublicUser` now carries **`userType`**
  (additive; individuals default to `individual`), so the web distinguishes a
  college student from an individual learner (both role=student) with **no extra
  network call for individuals**. The pure helper `isCollegeStudent(role, userType)`
  (shared `tenancy.ts`, sibling of `isCollegeOperator`) encodes this.
- **Landing (`homePathForUser(role, userType, slug)`).** Operator + college →
  `/c/:slug` (workspace); **college student + college → `/c/:slug/home`** (a
  DISTINCT student path); everyone else → `/app` (unchanged). `RootRoute` resolves
  the college via `/me/college` for **any** college member (operator or student),
  and only for them. **Forced password change runs FIRST**: `RootRoute` returns the
  forced-change gate before any home redirect, and the gate navigates to `/` on
  success → `RootRoute` re-decides → student home. **No loop**; `/app` stays
  reachable (the "switch" target). A student with no resolvable college falls back
  cleanly to `/app` (operators keep the dedicated no-college state).
- **Shell branches by role.** `RequireCollegeMember` already admits students
  (`FACULTY_ROLES` is the coarse gate; `resolveTenant` is the real boundary and is
  role-agnostic for membership). `CollegeTopNav` renders the **student consume nav**
  when `role=student` (`buildStudentCollegeNav`) and the operator manage nav
  otherwise; the student's brand/Dashboard link points to `/c/:slug/home`. The
  student catalog (`STUDENT_COLLEGE_SECTIONS`: My courses / My exams / My essays /
  My results / Placements) is the SAME `CollegeSection`/`sectionStatus`/`sectionHref`
  machinery, so it's identically **entitlement-gated** (feature-off → "Not enabled")
  and unit-tested — a student **never** sees operator sections (Structure, Faculty,
  Student registry, Bulk import, Analytics).
- **Dashboard (`/c/:slug/home`, also the `/c/:slug` index for a student via
  `CollegeIndexRoute`).** Reuses the operator dashboard's motion language (aurora
  hero, count-up stat cards, tilt tiles) but consume-flavored: a header with the
  student's name/role + college, one **stat card per ENTITLED feature** with REAL
  counts, and "Your sections" tiles. All counts come from ONE read
  **`GET /api/c/:slug/student/summary`** (`getCollegeStudentSummary`) — the plain
  tenant stack (**no operator gate**, so students reach it), computed for the
  calling user and reusing the existing tenant/cohort-scoped student services
  (`listStudentCollegeExams` / `Essays` / `Postings`) + a college-enrollment count;
  an off feature returns 0. Honest: only real numbers, cross-tenant denied.
- **Switch (reused mechanism).** The student account menu keeps **Switch to
  personal account** → `/app`; the learner shell's **Back to college** action now
  appears for college students too (extended in `AppLayout` via the same
  `/me/college` + `homePathForUser`), returning them to `/c/:slug/home`.
- **Part (ii) — deep surfaces re-homed (BUILT).** The placeholder routes are gone;
  each student section is now a REAL list/landing inside the student space that
  REUSES the existing taking/writing/applying/player flows unchanged:
  - **My courses** (`/c/:slug/courses`) — the student's assigned college courses
    from `GET /c/:slug/student/courses` (`getMyCollegeEnrollments`: tenant-scoped +
    `source=college`, same DTO/shaping as `/me/enrollments`, never their individual
    enrollments). Opens the EXISTING player at `/learn/:slug?c=<slug>`.
  - **My exams** (`/c/:slug/exams`) — the tenant student exam list, reusing
    `ExamStatusCard` → the EXISTING runner at `/exam/:id?c=<slug>` (shared
    `/attempts/*` engine untouched).
  - **My essays** (`/c/:slug/essays`) — the tenant student essay list, reusing
    `EssayStatusCard` → the EXISTING writer at `/essays/:id?c=<slug>`.
  - **Placements** (`/c/:slug/placements`) — the tenant student posting list →
    the EXISTING detail + apply flow at `/careers/:id?c=<slug>`.
  - **My results** (`/c/:slug/results`) — the student's own graded exams + scored
    essays, DERIVED on the client (`buildStudentResults`) from the two student
    lists (no new endpoint); essay rows link back into the writer's history view.

  **Reuse mechanism (decision).** The deep flows keep living at their learner
  routes and are opened with the `?c=<slug>` seam (option a — the proven path),
  NOT re-mounted under `/c/:slug`. The ONLY change to those flows is their
  return-target: each reads `?c` and, when present, sends back-nav to
  `/c/:slug/<section>` (and the player preserves `?c` across topic navigation) so a
  student stays in their space — the engines/writers/apply internals are byte-for-
  byte unchanged, as is every individual (no-`?c`) path. **Shared URLs branch by
  role:** `courses`/`exams`/`essays` render the student view for `role=student`
  and the operator manage page otherwise (`CollegeCoursesRoute` etc., mirroring
  `CollegeIndexRoute`); `placements`/`results` are student-only paths (operators
  use `postings`). Every section is entitlement-gated + tenant-isolated server-side.

---

## 3. Entitlement catalog (max super-admin control)

Stored on `college.entitlements`; add/removable anytime by super_admin; checked
everywhere via the ONE pure function `checkEntitlement` (`@codeapt/shared`).

### FEATURE entitlements (on/off) — `CollegeFeature`

`exams`, `essays`, `challenges`, `courses`, `careers`, `analytics`,
`bulk_import`, `faculty_management`, `postings`, `question_banks`.

Stored as a Map `feature → boolean` (absent/false = OFF).

### SUB-CAPABILITY entitlements — `SUB_CAPABILITY_CATALOG`

Finer toggles under a feature, keyed `"<feature>.<subCapability>"` in the API +
shared logic. A sub-capability is granted only when **both** its feature and the
sub-capability are on.

| Feature | Sub-capabilities |
|---|---|
| `exams` | `public_links`, `bulk_upload`, `proctoring` |
| `essays` | `ai_grading` |
| `challenges` | `leaderboard` |
| `courses` | `progress_tracking` |
| `analytics` | `export` |
| `postings` | `external_apply` |
| *(others)* | *(none yet — the catalog is extensible; add keys here)* |

> **Storage note:** Mongoose Maps forbid `.` in keys, so sub-capabilities are
> stored under a `::` delimiter (`exams::public_links`) and translated back to
> the dotted API form on read. Purely an internal storage detail.

### RESOURCE grants

`entitlements.grantedCourses`: specific master-catalog course (**`Subject`**) ids
granted to the college. Checked via `isCourseGranted`.

### The one check

```ts
checkEntitlement(entitlements, feature)                 // feature on?
checkEntitlement(entitlements, feature, subCapability)  // feature AND sub-cap on?
isCourseGranted(entitlements, courseId)                 // course granted?
```

Enforced in Express via `requireFeature(feature, subCapability?)` and
`requireCourseGranted(param)` (`middleware/require-entitlement.ts`). Denials
return a typed 403 (`TenantErrorCode`). **Platform admins bypass** all
entitlement checks.

---

## 4. Tenancy rules (the isolation guarantee)

**Shared database, tenant reference per document.** College-scoped documents
carry a `college` ObjectId; isolation is enforced by a mandatory scoping layer.

1. **Path-based context.** A college is addressed at `/c/:collegeSlug/...`. The
   `resolveTenant` middleware (`middleware/resolve-tenant.ts`):
   - looks up the college by slug (404 if unknown),
   - blocks suspended colleges for non-platform users (403),
   - **validates membership** — a college user may act ONLY on their own
     college; a platform admin may act on any (cross-tenant otherwise → **403
     `CROSS_TENANT_DENIED`**),
   - attaches the validated `req.tenant` (identity + entitlements + role).
   Never trust a college id from the client without a passing `resolveTenant`.

2. **Every college-scoped query goes through the tenant-scope helper**
   (`lib/tenant-scope.ts`). `createTenantScope(collegeId)` returns
   `filter(extra)` / `attach(doc)` that inject `college: <id>`, and it **throws
   `TENANT_CONTEXT_REQUIRED` if the id is missing** — so a college query can
   never silently run unscoped (which would leak across tenants). Later phases
   MUST use this for all college-scoped models.

3. **Isolation guarantee.** Given the above, a query for College A
   (`scopeA.filter(...)`) can never return College B's rows, and a college user
   can never resolve another college's context. Proven by
   `tests/tenancy.test.ts` (HTTP) + `tests/tenant-scope.test.ts` (DB-level).

4. **Individual (B2C) data is NEVER tenant-scoped.** The original models
   (courses, exams, essays, careers, orders, …) have no `college` field and do
   not go through the tenant layer. Individual users have `college: null` and are
   denied `/c/:slug` context by design. Tenancy is purely additive.

---

## 5. Backfill (existing data → tenancy-aware, safely)

`apps/api/src/scripts/backfill-tenancy.ts` — **additive + idempotent**:

1. Every user predating the tenancy fields gets `userType=individual`,
   `college=null`, `facultyScope={orgUnits:[]}` (only docs missing `userType`
   are touched → a second run is a no-op).
2. Legacy `admin` users → `super_admin` (equivalent authority). Students stay
   students. No other collection or field is read or written.

Run:

```
pnpm --filter @codeapt/api backfill:tenancy
```

Safe to re-run. Proven by `tests/tenancy-backfill.test.ts` (correct mapping,
idempotency, no collateral writes).

---

## 6. Phase plan

| Phase | Delivers |
|---|---|
| **0 — Foundation** *(this doc + built)* | College model; additive User extensions; entitlement catalog + pure logic; tenant resolution/validation; tenant-scope helper; entitlement + role guards; super_admin college provisioning API; `/c/:slug/context` + `/courses` spine; safe idempotent backfill; full tests. **No feature UI.** |
| **1 — Super-admin console** | Web UI for provisioning colleges, toggling entitlements, granting courses (drives the Phase-0 API). |
| **2a — Org structure + faculty (backend)** ✅ | `OrgUnit` tree model + nesting rule + delete guard; faculty management (create/list/update/deactivate) with validated `facultyScope`; tenant-scoped routes; `faculty_management` gating. Built + tested. |
| **2b — Org/faculty UI** ✅ | College-admin workspace at `/c/:slug/...`: visual org-structure tree builder (inline add-valid-child + paste-to-bulk-create, rename, delete-with-guard) and faculty management (invite/scope/deactivate), feature-gated. Plus the `GET /api/me/college` routing spine + college nav entry. Built + tested. |
| **3a — College students + import (backend)** ✅ | College-student model (User: role=student/userType=college/college/orgUnit, per-college roll uniqueness); single-add; the parse-agnostic validate→preview→commit bulk-import pipeline (faculty-scoped, `bulk_import`-gated, dup/error-aware, no writes on preview); downloadable template; scope-aware list; `deleteOrgUnit` student-guard. Built + tested. |
| **3b — College students + import (UI)** | College-admin/faculty screens: student list (scope-aware), single-add, and the import flow (file upload OR paste → preview verdicts → commit) driving the 3a API. |
| **4a — College courses** ✅ | Assign super-admin-granted courses to (in-scope) college students + revoke; students learn via the EXISTING player. Reuses the `Enrollment` engine, tenant-scoped, `courses`-feature + grant-gated, faculty-scoped. College students can't self-enroll. Built + tested. |
| **4b — Workspace shell + dashboard** ✅ | The college workspace reshelled from a sidebar to a product-style **top nav** (`CollegeTopNav`, catalog-driven + entitlement-aware groups with honest locked/coming-soon states) + a landing **dashboard** (`/c/:slug`) with live stat cards, admin-utility tiles, and recent-students/feature-access panels. One additive read-only endpoint `GET /c/:slug/summary` (operators-only, scope-aware counts). Presentation only — no tenancy/entitlement changes. Built + tested. |
| **4b-i — College exams (backend)** ✅ | Tenant-scoped exam authoring + taking over the REUSED exam engine. Additive: `Exam` gets optional `college`/`orgUnits`/`isPublished` with `topic` made optional (partial-unique preserves the individual 1:1); `StudentExamAttempt` gets `college` (auto-stamped). Authoring delegates to `exam-admin.service` behind tenant + `exams` feature + faculty scope; students take via the shared `/attempts/*` engine; tenant-scoped results. Hard per-college isolation. Individual exams byte-for-byte unchanged. Built + tested. |
| **4b-ii-A — Campus Assessments (authoring UI)** ✅ | College_admin/faculty exam list + full editor (sections, MCQ + CODE questions, test cases, timing, marks) + org-unit **targeting** + draft→published lifecycle + bulk-upload + public links + tenant-scoped results with audited attempt reset — in the workspace shell, over the 4b-i API. **Reuses the platform-admin editor components** via an injected `authApi` (`api.adminExams` default; `collegeExamAuthoringApi(slug)` for the tenant) — no forked editor; the admin exam UI + individual flows are untouched. The `exams` nav/tile flipped from coming-soon to a live, entitlement-gated route. Built + tested. |
| **4b-ii-B — College exams (student take surface)** ✅ | College students take their published, cohort-targeted college exams via the **existing learner runner** — surfaced in the learner Mock Exams page (`/exams`, where they already land), merged in front of individual exams (`mergeStudentExams`). Only list + start are tenant-scoped (`api.collegeExams.studentList/studentStart`); a `?c=<slug>` seam on `/exam/:id` swaps them while the shared `/attempts/*` runner (sections/timer/MCQ + CODE exec/submit/result) stays identical. Individual take flow byte-for-byte unchanged. College exams now work author→publish→take→results. Built + tested. |
| **4c-i — College essays (backend)** ✅ | Tenant-scoped essay authoring + writing over the REUSED essay engine (prompt/keywords/config, writer + drafts, attempt cap, and the grading pipeline — weights + LLM blend + risk — all unchanged). Additive: `EssayTopic` gets optional `college`/`orgUnits`/`isPublished` (topics were already standalone → no index friction); `EssayAttempt` gets `college` (auto-stamped). `essay.service` refactored into `*ForTopic` cores reused by both the individual wrappers (unchanged) and `college-essay.service`; authoring delegates to `essay-topic-admin.service`; grading poll/analytics ride the shared ownership-authorized endpoints. Behind tenant + `essays` feature + faculty scope, org-unit targeted, draft→publish. Hard per-college isolation. Individual essays byte-for-byte unchanged. Built + tested. |
| **4c-ii — College essays (UI)** ✅ | College_admin/faculty author essay topics in the shell (`/c/:slug/essays`) reusing the platform-admin `EssayTopicEditorDialog` via an injected `authApi` (+ org-unit targeting + draft→publish + AI keyword-gen) with tenant-scoped results; college students write in the learner Essays page (`/essays`, merged via `mergeStudentEssays`) reusing the essay writer via a `?c=<slug>` `writerApi` seam (grading poll + analytics stay on the shared ownership-authorized endpoints). No forked editor/writer; the admin essay UI + individual writer are byte-for-byte unchanged. `essays` nav/tile flipped to a live entitlement-gated route. Built + tested. |
| **4d — College challenges** ✅ | Scope chosen from the engine (a *daily* global challenge — no per-college authoring/assignment fits). Built the artifact the sub-capability catalog earmarked: a tenant-scoped **leaderboard** of the college's own students' daily-challenge standings (`GET /c/:slug/challenges/leaderboard`, `challenges`-feature + operator), reusing the shared `UserStreak` scoped via the college's User set — **no model/engine change**, so the global daily challenge + all individual flows are byte-for-byte unchanged (existing challenge suites green). `CollegeChallengesPage` + a new entitlement-gated `challenges` nav section/tile; the student daily-challenge experience stays the shared global one. Built + tested, end-to-end. |
| **5a-i — College analytics (backend)** ✅ | Tenant + faculty-scoped READ-ONLY aggregation over the Phase 4 data (exam attempts, essay submissions, college enrollments, challenge streaks) rolled up three ways — OVERVIEW, BY ORG-UNIT (dept/section via descendant math), INDIVIDUAL — behind the `analytics` feature. Reuses `listCollegeStudents`/`resolveActorScope` for scope; pure `lib/analytics-rollup` for the math (unit-tested). Honest metrics only (courses = assignment counts, no fabricated progress). NO engine/model/write change — all existing suites green. Routes `GET /c/:slug/analytics/{overview,by-org-unit,students/:id}`. Built + tested. |
| **5a-ii — College analytics (UI)** ✅ | The analytics dashboard (`/c/:slug/analytics`) — Overview (headline `StatCard`s + honest CSS-bar comparisons; courses = assignment counts, no fake progress), By-department (dept→section comparison table + bars, faculty-scope-aware), and Students (scope-aware picker → per-student profile). Reuses the dashboard's extracted shared `StatCard` + motion; **no charting dependency added**; pure `lib/analytics-view` helpers unit-tested. `analytics` nav/tile flipped to a live entitlement-gated route. Nothing backend/dashboard changed. Built + tested. |
| **5b — College postings (placements)** ✅ | Tenant-scoped posting authoring + the student browse/apply flow over the REUSED careers engine. Additive: `Job` gets optional `college`/`orgUnits`/`isPublished` (individual postings keep `college:null` and ignore `isPublished`); `JobApplication` is unchanged (it resolves tenancy through its parent posting). Authoring delegates to `careers-admin` (shared `postingUpsertFields` + reference-safe delete + applications review) behind tenant + `postings` feature + faculty scope, org-unit targeted, draft→publish; students browse/apply via the reused careers UI (`PostingEditorDialog` injected `authApi`; `?c=<slug>` seam on `/careers/:id` + `mergeStudentPostings`); operators review applicants + move status. Individual/global feed hard-scoped to `college:null` (isolation) — individual careers byte-for-byte unchanged (existing suite green). `postings` nav/tile flipped live (`/c/:slug/postings`). Routes `/c/:slug/postings/*` (authoring) + `/c/:slug/careers/*` (student). Built + tested. **This completes the multi-tenant spec.** |
| **5c+ — Cross-college (future)** | `external_apply` sub-capability, `export`, cross-college reporting for super_admin. Not yet requested. |

Each later phase reuses the Phase-0 spine: `resolveTenant` for context,
`createTenantScope` for queries, `requireFeature`/`requireCourseGranted` for
entitlements, and the role guards for authority.

---

## Question bank (net-new, backend)

A global **Standard** (MCQ) + **Coding** (CODE) bank curated by super-admin, plus
a per-college **Self Bank** auto-populated from each tenant's own questions.

- **Model — `BankQuestion` (`models/question-bank.model.ts`).** Its PAYLOAD
  MIRRORS `ExamQuestion` field-for-field — `questionType` (MCQ_SINGLE | MCQ_MULTI
  | CODE only), `text`, `options`, `correctOptions` (0-based), `starterCode`,
  `language`, `allowedLanguages`, `image`, `marks` — plus **embedded**
  `testCases[{inputData,expectedOutput,isHidden,order}]` (a library item is
  self-contained, unlike the referenced `ExamTestCase`). So a pull → exam question
  is a clean field copy, no conversion. Bank METADATA: `kind` (standard|coding,
  DERIVED from questionType), `category`, `subCategory`, `company` (default
  "General"), `difficulty` (easy|medium|hard), `tags[]`. SCOPE: `scope`
  (global|college) + `college` ref (null for global). Indexed `{college}` (Self
  Bank reads), `{scope,kind,category,company,difficulty}` (filters).
- **Grant model.** A new `question_banks` **CollegeFeature** gates access to the
  GLOBAL banks (checked via the existing `checkEntitlement`; the super-admin
  entitlements editor toggles it — no bespoke UI). A college's OWN Self Bank is
  ALWAYS available (their data) — so the college routes run the tenant stack +
  `requireFaculty` but NOT `requireFeature`; the grant is enforced INSIDE the
  service (global scope requires it, self scope never does).
- **Reused-and-extended importer.** The exam parsers' type-specific answer/
  test-case logic is factored into `readMcqCore` / `readCodingCore`
  (`lib/exam-excel.ts`) — the exam importer's accepted format is UNCHANGED (it now
  calls these; the round-trip drift-guard + `exam-excel` tests prove it). The bank
  importer (`lib/question-bank-excel.ts`) reuses those cores with bank-metadata
  columns instead of the exam's section columns. **THE categorized import format
  (seed data must match exactly):**
  - **Bank MCQ sheet:** `category | subCategory | company | difficulty | tags |
    text | marks | option1..option5 | correctOptions` (correctOptions = 1-based
    comma list; 1 answer → MCQ_SINGLE, >1 → MCQ_MULTI; tags = comma list;
    difficulty = easy|medium|hard).
  - **Bank Coding sheet:** `category | subCategory | company | difficulty | tags |
    text | marks | starterCode | language | allowedLanguages | input1 | expected1
    | hidden1 | … | input5 | expected5 | hidden5` (1–5 inline test cases; a triple
    is imported when input OR expected is set; `hiddenN` truthy = true/1/yes/
    hidden; `allowedLanguages` blank/all/open = any, a single language = locked).
- **Self-bank auto-populate.** `bulkUploadQuestionsWithParsed` (exam-admin) returns
  the parsed questions alongside the response; the college exam `bulkUpload` wraps
  it and additionally mirrors those questions into the college's Self Bank
  (`autoPopulateSelfBank`, tenant-scoped, deduped by (college, questionType,
  text); `category` = the exam section name). Best-effort: a self-bank failure
  never fails the exam upload. The individual/global exam path calls the thin
  `bulkUploadQuestions` wrapper, so it is byte-for-byte unchanged.
- **Browse/filter.** Paginated, scope- + grant-aware: super-admin browses `global`;
  a college browses its Self Bank always + the global banks if granted (`scope`=
  global|college|all; explicit `scope=global` without the grant → 403; `all`
  without the grant silently returns only the Self Bank). Filters: kind, category,
  subCategory, company, difficulty, free-text `q` over text + tags.
- **Pull into exam.** `POST /c/:slug/question-banks/pull-into-exam` copies the
  chosen bank questions into an exam section as real `ExamQuestion`s (+
  `ExamTestCase`s) by REUSING `examAdmin.createQuestion` / `addTestCase`. The exam
  + section must belong to the tenant (cross-tenant → 404); pulling any GLOBAL
  question without the grant → 403; another college's Self-Bank question is
  skipped (never copied cross-tenant).
- **Routes.** Super-admin: `/admin/question-banks` (GET browse, POST create, PATCH
  /:id, DELETE /:id), `POST /admin/question-banks/import`, `GET
  /admin/question-banks/template?kind=`. College (tenant + faculty): `GET
  /c/:slug/question-banks`, `POST /c/:slug/question-banks/pull-into-exam`.
- **Unchanged.** Individual exam authoring/taking + the exam importer's accepted
  format + exam question creation are untouched; the bank layer is purely
  additive.

### Question bank — UI (Prompt 2)

Web only; the Prompt-1 bank backend is unchanged. Two surfaces, both reusing the
shell/dialog/table/chip primitives:

- **Bank picker (college exam editor).** Each section in `CollegeExamEditorPage`
  gets **Standard Bank / Coding Bank / Self Bank** entry points (via a new
  optional `headerActions` slot on the shared `ExamSectionCard` — the platform-
  admin editor passes nothing, so it's unchanged). Standard/Coding are gated by
  the `question_banks` grant (`checkEntitlement`, disabled with a hint when
  ungranted); Self Bank is always shown. `BankPickerDialog` (one dialog,
  parameterized by `source`) browses `GET /c/:slug/question-banks` (scope+kind
  from the source, category/company/difficulty chips + `q` search + pagination)
  and ADDs via `POST /c/:slug/question-banks/pull-into-exam` — per-question "Add"
  → "Added", plus multi-select "Add selected"; on add it refetches the exam tree
  so the copied questions appear in the section.
- **Super-admin management (`/admin/question-banks`).** `AdminQuestionBanksPage`
  browses/filters the global banks (kind tabs + the shared filter bar), with
  create/edit/delete (`BankQuestionEditorDialog`, reusing the exam `QuestionDraft`
  helpers + inline test cases) and a **bulk Import** (`BankImportDialog`) that
  posts the categorized MCQ/coding workbooks to `POST /admin/question-banks/import`
  (+ template download) — where the seed sets are uploaded.
- **Pure helpers** (`lib/question-bank-ui.ts`, unit-tested): `bankSourceQuery`,
  `buildBankBrowseQuery`, `emptyBankFacets`, `toggleId`, `pageCount`,
  `bankUpsertFromDraft`, `parseTagsInput`. **api-client:** `adminQuestionBanks`
  (list/create/update/remove/import/template) + `collegeQuestionBanks`
  (browse/pullIntoExam).

#### Filter facets — bank-wide, server-side

The filter chips were originally derived from the CURRENT PAGE of results, so a
category/company that only appeared on another page was hidden, and subCategory
+ tags weren't offered at all. Facets are now computed SERVER-SIDE across the
whole bank the caller may browse and returned on the browse response
(`bankFacetsSchema` on `bankListResponseSchema`).

- `computeFacets` (in `question-bank.service.ts`) runs Mongo `distinct` per field
  with **cascading (category-dependent) facets**. **Parent** facets — kind,
  category, company, difficulty — are distinct over the **scope clause + source
  `kind`** only (never the soft filters), so you can always switch subject/
  company/difficulty. **Child** facets narrow to the parent selection:
  sub-categories are scoped to the selected `category` (so they're that subject's
  6–12 sub-topics, not a flat ~70-value wall across every subject), and tags are
  scoped to the selected `category` (+ `subCategory` when chosen). It respects
  scope/grant exactly like browse: a college's facets cover its Self Bank (+ the
  global banks only if granted); an ungranted college never sees global values.
  Blank/duplicate values dropped; difficulties ordered easy→medium→hard.
- Browse gained a `tag` param (array-contains match); `subCategory` already
  existed. `BankFilterBar` renders category / company from the server facets +
  the fixed difficulty set as top-level rows, and **sub-topic + tags as child
  rows**: with **Category = All** the sub-topic row is hidden behind a hint
  ("select a category to filter by sub-topic") instead of dumping every value;
  picking a category shows only that subject's sub-topics and narrows tags, and
  clears any now-incompatible sub-topic/tag selection (picking a sub-topic clears
  the tag). Long rows keep the "show all N / show less" expander. Both the
  college picker (`BankPickerDialog`) and the super-admin page read
  `listQuery.data.facets` — never page-derived; the facets recompute on filter
  change so children track the selected parent.

### AI Test Builder (Prompt 3)

LLM-drafted questions inserted into a college exam + mirrored into the Self Bank.
Reuses the **existing** LLM integration — the shared `callLlmChatJson` client the
essay flow uses (configured exactly like `generateKeywords`: `ESSAY_AI_PROVIDER=llm`
+ `ESSAY_LLM_URL`/`ESSAY_LLM_API_KEY`/`ESSAY_LLM_MODEL`/`ESSAY_AI_TIMEOUT_MS`) — with
**no new provider or dependency**.

- **Coercion (shared, pure).** `packages/shared/ai-questions.ts`:
  `coerceGeneratedQuestion` / `coerceGeneratedQuestions` validate each untrusted
  LLM item into the REAL exam-question shape (MCQ_SINGLE/MCQ_MULTI/CODE only) and
  DROP anything malformed (bad/unrequested type, empty text, <2 options, blank
  option that would shift indices, no/too-many correct indices). CODE test cases
  are kept as **advisory** (LLM-proposed, not executed). Capped at
  `MAX_AI_GENERATED_QUESTIONS` (20) per run.
- **Endpoint.** `POST /c/:slug/question-banks/ai-generate` (sibling to
  pull-into-exam) behind `requireAuth → enforcePasswordChange → resolveTenant →
  requireFeature(exams) → requireFaculty`. `generateQuestionsIntoExam` (in
  `question-bank.service.ts`) verifies the exam+section belong to the tenant
  (reusing pull-into-exam's checks → 404 cross-tenant), calls the LLM, coerces the
  output, inserts valid questions via the **same** `examAdmin.createQuestion` /
  `addTestCase` path, and mirrors them into the Self Bank via the **same**
  `autoPopulateSelfBank` hook (best-effort). The LLM step is an injectable
  `QuestionGenerator` (faked in tests). No key → `{configured:false, created:0}` +
  a clear warning; never throws, never inserts a malformed question.
- **UI — a WHOLE-EXAM action.** `AITestBuilderDialog` opens from an **AI Build**
  button in the exam editor's Power-tools row (exam-level, NOT per section — the
  per-section `SectionBankButtons` hold only the Standard/Coding/Self bank
  pickers). The dialog takes description, real-type checkboxes (True/False +
  Fill-in-the-blank shown disabled with a note), **questions per section**, and
  difficulty, and shows the live total (`perSection × sectionCount`). On submit it
  calls the endpoint **once per existing section** (so each section's name steers
  its own generation), then aggregates created/skipped + a per-section breakdown
  and refetches the exam tree. If the exam has no sections it prompts to add one
  first; the no-key path renders a clear "contact your administrator" message
  (short-circuits after the first section). The backend endpoint is unchanged —
  still single-section — the exam-level behavior is the UI looping over sections.
  Pure helpers (`lib/question-bank-ui.ts`, unit-tested): `emptyAiBuilderState`,
  `clampCount`, `validateAiBuilderState`, `buildAiGenerateRequest` (per-section
  `count`). **api-client:** `collegeQuestionBanks.aiGenerate`.

### Exam editor — section container + collapse

`ExamSectionCard` (shared by the college + admin editors) renders each section as
an unmistakable **container**: a colored left spine down the whole card, a tinted
header band with a "Section" pill + bolder title, and its questions nested inside
a **sunken well** as individual raised tiles (clear even with one question). The
header has a **chevron toggle** (`aria-expanded`/`aria-controls`, default
expanded) that collapses the questions well so long exams stay scannable; the
header (with its question count) remains as the collapsed summary. Presentation +
local UI state only — no section/question CRUD, actions, ordering, or data
changed.

## LLM Gateway (multi-provider free-tier router)

A gateway sits **behind the single `callLlmChatJson` seam**, so every AI feature
(essay grading, essay keywords, AI Test Builder) transparently gains
multi-provider failover, rate-limit/quota cooldown, encrypted key storage,
per-provider usage tracking, task-policy routing, and graceful exhaustion — with
**no feature-code change** beyond optionally passing a task policy.

**Seam (unchanged signature).** `callLlmChatJson(config, system, user, policy?)`
in `@codeapt/shared` gained (a) a `registerLlmRouter(fn)` hook and (b) an optional
`policy` arg. When a router is installed, the call routes through it (the legacy
`config` creds are ignored); otherwise the original single-provider env behavior
stands. The seam never throws — a misbehaving router degrades to `null`. Callers
are untouched except the three that now pass a policy: essay grading →
`{kind:"grading", sensitive:true}`, keywords + AI Build → `{kind:"generation"}`.

**Pure engine (`@codeapt/shared/llm-gateway`, isomorphic, no DB/crypto).**
- `ProviderHttpError` — typed adapter error: status + parsed **Retry-After**
  (seconds or HTTP-date, **clamped to 24h** so a hostile header can't bench
  forever) + classification (`rate_limit`/`transient`/`fatal`) + `daily`.
- **Adapters** (one `ProviderAdapter` interface, `chatJson → {content, usage}`):
  an OpenAI-compatible base (Groq/Cerebras/OpenRouter/Mistral/NVIDIA) + quirk
  adapters for Google (Gemini/Gemma), Cohere v2, and Cloudflare Workers AI. Each
  maps its own request/response shape and throws `ProviderHttpError` on non-2xx.
- **Router** — `selectProviders` filters to AVAILABLE (has key, not in cooldown,
  has headroom, and for sensitive tasks NOT `trainsOnData`) then orders:
  generation → priority asc + score; grading → reliability desc (most stable)
  then priority. `routeChatJson` tries the chain best-first: success+parse →
  return; `ProviderHttpError` → `cooldownUntilFor` (Retry-After, else daily→UTC
  reset / minute→60s / transient→30s / fatal→10m) + record failure + **fail over**
  to the next; 2xx-but-unparseable → soft failure (no bench) + next; exhausted →
  `null` (graceful). Bounded (≤6 attempts, each provider once) — never loops.

**DB layer + wiring (`apps/api`, platform-level, super-admin owned).**
- Models: `AiProvider` (kind/baseUrl/model/enabled/priority/limits/trainsOnData/
  capability), `AiProviderKey` (API key **AES-256-GCM encrypted at rest** — never
  stored/logged/returned plaintext), `AiProviderHealth` (per-provider rolling
  minute/day request+token counters, cooldownUntil, consecutiveFailures,
  reliability).
- `lib/crypto.ts` — AES-256-GCM with `ENCRYPTION_KEY` (env, SHA-256-stretched to
  32 bytes); blob `v1:iv:tag:ciphertext`. Gateway is OFF without the key.
- `provider-source` loads enabled providers + their (decrypted) key + current-
  window usage/health → `ProviderRuntime[]`; `persist` increments usage (window
  reset on the minute/day boundary) and records cooldown/reliability; `gateway`
  wires provider-source + real adapters + the shared router + persist behind the
  seam; `seedAiProviders` idempotently seeds the catalog (Groq 8B → Gemma → Gemini
  Flash-Lite → Groq 70B → Cerebras → Cloudflare → OpenRouter → Cohere, + Mistral/
  NVIDIA off/addable) by priority; `installLlmGateway` registers it at boot when
  `ENCRYPTION_KEY` is set. Keys are seeded EMPTY — a super-admin adds them
  (encrypted) via the admin UI (Prompt 2), so the gateway is idle until keyed.
- Tests: 22 engine (retry-after/cooldown/headroom/selection/failover/policy/
  trainsOnData/exhaustion + adapters via stubbed fetch) + 12 DB/seam (crypto
  round-trip + no-plaintext, idempotent seed, provider-source decrypt/skip, usage
  windows + cooldown, gateway e2e + failover, seam routes through the gateway +
  policy plumb + graceful null). No real network.

### Admin console + worker wiring (turns the gateway ON + observable)

**Super-admin API (`/admin/ai-providers`, requireSuperAdmin, platform-level).**
`GET` returns every provider's config + `keySet` (BOOLEAN only) + live health
(current-window requests/tokens vs limits, derived status, cooldownUntil,
reliability, lastError/At, lastUsedAt) + a summary (total/enabled/keyed/available)
— all from REAL health counters. `PATCH /:id` edits enabled/priority/trainsOnData/
capability/model/baseUrl/limits. `PUT /:id/key` accepts a plaintext key, encrypts
it immediately (reusing `lib/crypto.ts`), replaces any existing key, and responds
`{keySet:true}` — the key is **never** returned or logged. `DELETE /:id/key`
removes it. `POST /:id/test` does a tiny live probe of the provider with its key
and returns `{ok}` or a **redacted** `{ok:false,status,message}` (status +
classification only — never the body/key); it's rate-limited (15/min/user). The
`ai-provider-admin.service` reuses the gateway models/crypto/adapters and does NOT
touch the router engine.

**Worker wiring (essay grading now on the gateway).** `apps/worker` gained a thin
copy of the gateway DB glue (models + `crypto` + `provider-source`/`persist`/
`gateway`/`install`, mirroring the API — the repo already duplicates models per
app; the pure engine still comes from `@codeapt/shared`). `installLlmGateway()`
runs in the worker bootstrap (guarded by `ENCRYPTION_KEY`). The essay grader is
now gateway-aware: `selectGrader()` prefers the LLM grader and `createLlmGrader`
skips the legacy env URL/key guard **when `hasLlmRouter()`** — so with the gateway
installed, grading routes through the multi-provider router with its
`{kind:"grading", sensitive:true}` policy (stable-first, failover, excludes
`trainsOnData`); without it, the single-provider fallback is unchanged.

**Admin page (`/admin/ai-providers`).** A super-admin console: a summary strip
(providers / enabled / keyed / available), then a card per provider — status
badge (Healthy / Cooling down · Ns / Disabled / No key), enable + trainsOnData
toggles (with an "avoid for student data" hint), priority reorder arrows, key
Add/Replace (masked input, encrypted server-side, never echoed) / Delete / Test,
and headroom bars (requests + tokens, minute + day vs the documented limits) plus
reliability / last-used / last-error. Each provider also carries a curated
`keyUrl` (its key-claim console — Groq/Google AI Studio/OpenRouter/Cohere/…),
surfaced as a **"Get API key ↗"** link on the row and inside the add-key dialog,
so the super-admin can go claim a free key and paste it straight back. `keyUrl`
is seeded (backfilled via `$set` on every boot) and returned on the admin list
(display-only — not admin-editable, never a secret). Reuses the admin shell +
Card/Switch/Progress/Badge/Dialog primitives; "AI providers" added to the
platform-admin nav.
Pure helpers (`lib/ai-providers-ui.ts`, unit-tested): `usagePercent`,
`statusLabel`/`statusVariant`, `cooldownRemaining`, `reorderSwap`. api-client:
`adminAiProviders` (list/patch/setKey/deleteKey/test).

- Tests: +6 API (requireSuperAdmin gating; list+summary+health shape sorted by
  priority; key PUT encrypts at rest + GET/response never return plaintext +
  replace keeps one + delete; patch enable/reorder/trainsOnData/limits; redacted
  test-probe ok + bad-key-no-leak + no-key) + 3 worker (mock grader without a
  gateway; grading routes through an installed router with the grading policy;
  install arms only with ENCRYPTION_KEY) + 5 web (`ai-providers-ui` helpers).
  Engine + feature code unchanged (only the opt-in worker grader wiring).
