# CodeApt — Deep Project Analysis (for MERN Rebuild)

> **Source:** `codeapt_site.zip` — a Django 4.2 monolith (~6,500 LOC Python, 52 templates, 6 apps).
> **Goal:** Rebuild as a MERN stack app with a fast post-deploy response architecture and a modern, polished UI/UX.
> This document is the ground-truth spec. Every feature below must have a MERN equivalent unless we explicitly decide to cut it.

---

## 1. What CodeApt Actually Is

A **coding-aptitude & campus-placement training platform** (domain: `codeapt.in`) aimed at students preparing for placement drives (TCS NQT, service-based & product-based company tracks). It bundles six product surfaces into one monolith:

1. **Learning / LMS** — paid courses (Program → Subject → Module → Topic), YouTube video lessons, text articles, per-topic progress, subject quizzes.
2. **Assessments / Mock Exams** — section-timed exams with MCQ (single/multi) + coding questions, test-case grading, public token links, malpractice/anti-cheat detection, Excel result export.
3. **Daily Challenges** — one problem per day (MCQ or coding), streaks, total score, leaderboard.
4. **Essays** — AI-graded essay writing with a deterministic scoring engine + external AI microservice, plus keystroke/anti-cheat analytics.
5. **Payments & Enrollment** — PhonePe gateway, orders, coupons, auto-enroll on success.
6. **Careers / Placements** — job listings, applications, placement success stories.

Plus a **Django admin**-driven back office with heavy Excel bulk-upload tooling, and an **async execution layer** (Redis + django-rq) that offloads all code running/grading to background workers.

---

## 2. Tech Stack (current) → MERN target mapping

| Concern | Current (Django) | MERN target |
|---|---|---|
| Web framework | Django 4.2.14 / Python 3.12 | **Express** (Node) REST API |
| DB | PostgreSQL (Neon, SSL) | **MongoDB** (Atlas) via **Mongoose** |
| ORM/schema | Django ORM + migrations | Mongoose schemas + indexes |
| Frontend | Django templates (52 HTML) + vanilla JS | **React** (Vite) SPA |
| Auth | Django sessions + `User`/`Profile` | JWT (access+refresh) or session cookies |
| Async jobs | Redis + django-rq (4 queues) | **BullMQ** (Redis) worker service |
| Code execution | Piston API via DevTunnel | Piston (self-host or public) behind worker |
| AI essay grading | External FastAPI at `32.194.25.0:8000` | Keep FastAPI microservice OR port scoring to Node |
| Media/files | Cloudinary + WhiteNoise | Cloudinary (unchanged) |
| Payments | PhonePe SDK v2.1.5 | PhonePe REST (Node) |
| Static/deploy | Gunicorn, Docker, AWS App Runner, Vercel | Node API + static React (Vercel/Render/Fly) |
| Excel I/O | pandas + openpyxl | `xlsx` / `exceljs` (Node) |
| Timezone | `Asia/Kolkata`, `USE_TZ=True` | store UTC, render IST client-side |

---

## 3. App-by-App Breakdown

### 3.1 `accounts` — Auth & Registration (145 LOC)
- **Models:** none of its own — relies on Django `User` + `core.Profile`.
- **Views (4 routes):** `login_view`, `register_view`, `logout_view`, `force_password_change_view`.
- **Form:** `StudentRegisterForm` extends `UserCreationForm` with `email`, `college`, `phone`, `state`, `roll_number`; `clean_email` + `clean_roll_number` enforce **uniqueness**.
- **Key behavior:** on login, if `profile.force_password_change` is true → redirect to forced reset. Profile is auto-created by signal (see core).
- **Rebuild notes:** `/api/auth/register|login|logout|change-password`. Roll number + email uniqueness = Mongo unique indexes. `force_password_change` flag drives a client-side redirect guard.

### 3.2 `core` — Dashboard, Profiles, Payments, Code-run, Static pages (1,611 LOC, 26 routes)
- **Models:**
  - `Profile` (1-to-1 User): `full_name`, `college_name`, `roll_number`, `phone_number`, `state`, `bio`, `avatar_url` (defaults to ui-avatars.com), `force_password_change`. **Auto-created + saved via `post_save` signals on User.**
  - `ExecutionJob`: async job tracker — `job_id` (unique), `user`, `submission_ref`, `queue` (`assessment`/`practice`), `status` (`queued`/`processing`/`completed`/`failed`), `result` (JSON), `error`, timestamps.
- **Views (highlights):** `index`, `dashboard` (enrolled courses + quiz stats + pending orders + job apps), static pages (`about`, `contact`, `terms`, `privacy`, `refund_policy`), `courses`/`course_detail`/`course_landing`/`topic_detail`, `enroll_course`, `toggle_topic_completion` (AJAX), `run_code` (CSRF-exempt), `quiz_view`, `training`, `placements`, `careers`, `track_application`, `profile`.
  - **Payments:** `initiate_payment` (PhonePe, Decimal-safe), `payment_callback` (CSRF-exempt verify), `check_payment_status`.
- **`core/utils.py`:** `execute_code_piston()` — the central code runner. Sends DevTunnel header `X-Tunnel-Skip-Anti-Phishing-Page`, maps language → Piston version (Python/JS/Java/C++/C), 10s timeout.
- **`core/services/execution_service.py`:** `ExecutionService` class + `ExecutionResult` value object (`success/stdout/stderr/to_dict()`), `_parse_response`, language config, session init. This is the newer, hardened executor.
- **`core/phonepe.py`:** `get_phonepe_client()` — StandardCheckoutClient (SDK v2), OAuth token handled internally.
- **Forms:** `ContactForm`, `UserUpdateForm` (email), `ProfileUpdateForm`.
- **Rebuild notes:** dashboard = one aggregated `/api/me/dashboard` endpoint. Split static/legal pages into React routes with CMS-ish JSON. Payment flow becomes `/api/payments/initiate` + webhook `/api/payments/callback`.

### 3.3 `curriculum` — LMS content model (702 LOC)
- **Models & hierarchy:** `Program` → `Subject` → `Module` → `Topic`.
  - `Subject`: `name`, `slug` (auto), `image`, `description`, `price`, `discount_price`, `is_popular`, `is_visible`. Slug auto-generated on save.
  - `Module`: `name`, `order`.
  - `Topic`: `topic_type` ∈ {text, video, quiz, exam, **essay**}, `order` (**FloatField** — decimals let you insert between topics), `content`, `video_id` (YouTube), `duration`, `essay_topic` FK (→ `essays.EssayTopic`, used only for essay type).
  - `Question` + `Choice` (subject-level quizzes; `is_correct` flag).
  - `Enrollment` (unique `user+subject`), `TopicProgress` (unique `user+topic`, `is_completed`), `QuizSubmission` (`score`, `total_questions`, `percentage` property).
  - `Order`: `order_id` (unique internal), `transaction_id` (PhonePe), `amount`, `coupon` FK, `coupon_code`, `discount_amount`, `status` ∈ {PENDING, SUCCESS, FAILED}.
  - `Coupon`: `code` (unique), `discount_type` (percentage/fixed), `discount_value`, `active`, `valid_from/to`, `usage_limit` (global), `per_user_limit`, optional `subject` scope.
  - `Job` + `JobApplication`.
- **`utils.extract_video_id()`:** regex YouTube ID extraction (watch?v=, youtu.be, embed).
- **Admin:** heavy — `FilteredSelectMultiple` for bulk enrollment, Excel bulk topic upload (columns: module, order, name, type, content, video_id, duration; auto-creates modules), bulk enrollment upload.
- **Rebuild notes:** the Program/Subject/Module/Topic tree maps cleanly to Mongo with references. `Topic.order` as float is a nice ordering trick — keep it. Coupons need validation logic (window + global limit + per-user limit + subject scope) enforced server-side at checkout.

### 3.4 `assessments` — Mock exams & anti-cheat (1,754 LOC, 11 routes)
- **Models:**
  - `Exam` (1-to-1 with `Topic`): `total_marks`, `pass_percentage`. Duration lives on sections, not the exam.
  - `ExamSection`: `name`, `order`, `duration_minutes`, `description`. **Per-section timers prevent time pooling.**
  - `ExamQuestion`: `question_type` ∈ {MCQ_SINGLE, MCQ_MULTI, CODE}; MCQ `option_1..5` + `correct_options` (comma-sep for multi); `starter_code` for CODE; Cloudinary `image`; `marks` (default 5).
  - `ExamTestCase`: `input_data`, `expected_output` (drives partial marking).
  - `StudentExamAttempt`: works for both logged-in users **and** anonymous public (`user=None`, captures `roll_number`/`college_name`). Tracks `current_section` + `section_start_time`, `response_data` (JSON: per-section answers + metadata), `warnings_triggered`, `is_auto_submitted`, `completed_at`, `score`, `passed`.
  - `PublicExamLink`: UUID `access_token`, `is_active`, `start_time`/`end_time`, `is_available()` window check.
  - `ExamAttemptCounter` + `ExamAttemptResetLog`: enforce per-user attempt limits with an audit trail for resets.
- **Grading (`calculate_final_score`):** MCQ_SINGLE = strict match; MCQ_MULTI = set comparison; CODE = run each test case, normalize whitespace, **proportional marks** = (passed/total)×marks. Pass threshold noted at 40% in code (vs `pass_percentage` field — reconcile during rebuild).
- **Fast-path optimization (documented in `EXAM_OPTIMIZATION_SUMMARY.md`):** `load_section_data(attempt_id)` returns full next-section JSON so section transitions are **AJAX, no page reload, stays in fullscreen**.
- **Anti-cheat (documented in `NOTIFICATION_*` docs):** focus-loss / tab-switch detection → `warnings_triggered`; toast + in-fullscreen modal notifications (no native `alert()`/`confirm()` that would break fullscreen); auto-submit on timeout; malpractice flag when warnings > 2.
- **Admin:** `ExamAdmin` with Excel question upload + result export; `SectionInline`, `TestCaseInline`.
- **Rebuild notes:** this is the most complex surface. Section timing must be **server-authoritative** (store `section_start_time`, compute remaining server-side). Public exams need a tokenized, session-scoped flow. All code grading goes through the async queue.

### 3.5 `challenges` — Daily problems, streaks, leaderboard (375 LOC, 4 routes)
- **Models:** `DailyQuestion` (`question_type` MCQ/CODE, `release_date` unique, MCQ `option_a..d` + `correct_option`, `starter_code`), `TestCase`, `UserStreak` (1-to-1: `current_streak`, `max_streak`, `total_score`, `last_solved_date`), `DailySubmission` (unique `user+question`).
- **Logic:** `daily_challenge` loads today's problem by `release_date`; `submit_mcq` (5 or 0); `submit_code` (proportional via test cases). `update_user_progress`: no duplicates; streak = +1 if solved yesterday, reset to 1 if a day was skipped, no-op if already today; update `max_streak`. `leaderboard` = top 20 by (score desc, streak desc) + current user's rank.
- **Rebuild notes:** streak logic must use IST day boundaries. Leaderboard should paginate (currently hard-capped at 20). One submission per user per day = unique compound index.

### 3.6 `essays` — AI-graded writing + analytics (1,771 LOC, 11 routes) ⭐ most sophisticated
- **Models:**
  - `EssayTopic`: `title`, `description`, `instructions`, `difficulty_level` (1/2/3), `min_words`/`max_words`, `time_limit_minutes`, `is_active`, `semantic_keywords` (JSON list), validation in `clean()`.
  - `EssayAttempt`: `attempt_number` (unique per user+topic), `status` (DRAFT→IN_PROGRESS→SUBMITTED→UNDER_REVIEW→GRADED→CANCELLED), `content`, counts (`word/character/paragraph`), **7 sub-scores** (grammar, spelling, punctuation, readability, vocabulary, structure, relevance) + `final_score`, `ai_report`, `grading_status`, timing (`time_limit_seconds`, `is_timed`, `timer_expired`, `get_time_remaining()`, `can_edit()`), `ip_address`, `user_agent`.
  - `EssayDraft`: autosave snapshots (`content`, `word_count`, `saved_at`).
  - `EssayAnalytics` (1-to-1): **keystroke/anti-cheat** — `typing_events`, `paste_events`, `copy_events`, `delete_events`, `focus_loss_count`, `inactivity_seconds`, `longest_pause_seconds`, `suspicious_activity`, `risk_score`.
- **Scoring engine (`services/scoring_service.py`, 770 LOC):** deterministic + AI hybrid.
  - Deterministic analyzers: `analyze_grammar`, `analyze_spelling` (uses `COMMON_MISSPELLINGS` map), `analyze_punctuation`, `analyze_readability` (Flesch), `analyze_vocabulary` (lexical diversity + academic-word bonus − filler/repetition penalty), `analyze_structure` (transition words, paragraph coherence), `analyze_relevance` (keyword coverage vs topic; `coverage_ratio**1.5 * 100`).
  - **AI blend:** vocabulary & structure = `0.6*deterministic + 0.4*AI`. AI feedback summary optional (feature flags: `ENABLE_AI_FEEDBACK=True`, `ENABLE_AI_VOCAB=False`, `ENABLE_AI_STRUCTURE=False`).
  - **Final weights:** grammar 0.08, spelling 0.03, punctuation 0.04, readability 0.05, **vocabulary 0.30, structure 0.25, relevance 0.25**; +5 bonus if vocab/structure/relevance all ≥80.
- **AI microservice (`services/ai_service.py`):** POSTs to `http://32.194.25.0:8000` endpoints: `extract-keywords`, `analyze-vocabulary-sophistication`, `analyze-structure-coherence`, `generate-feedback-summary`. 45s timeout, graceful fallback on failure.
- **Async:** `tasks.py` + `rq_jobs.enqueue_grading_job` → grading runs on a worker.
- **Views split across:** `views.py` (editor, submit, autosave), `views_ai_report.py`, `views_attempt_history.py`. Frontend editor JS in `static/essays/js/essay_editor.js`.
- **Rebuild notes:** the scoring engine is the crown jewel. Cleanest path: keep the **FastAPI AI microservice as-is**, and port the deterministic scoring either to a Node worker or a small Python grading service the BullMQ worker calls. Preserve exact weights and the anti-cheat analytics schema.

---

## 4. Async / "Fast Response" Architecture (critical for the rebuild goal)

The current app already offloads heavy work to Redis-backed queues via **django-rq** — this is the pattern to preserve and modernize:

- **4 queues:** `default` (300s), `practice` (300s), `assessment` (600s, priority), `playground` (300s).
- **`ExecutionJob`** row is created immediately (status `queued`) → API returns fast with a `job_id` → client polls for result.
- **Worker (`execute_submission_job`)** is **idempotent** (skips already-finalized jobs), enforces **timer safety** (won't grade expired attempts), does **atomic** DB updates for grading/leaderboard, and logs stuck jobs.
- **`enqueue_grading_job(attempt_id)`** does the same for essay grading.

**MERN translation:** Express endpoint enqueues a **BullMQ** job and returns `{ jobId }` in <100ms; a separate **worker process** runs Piston + grading; client polls `GET /api/jobs/:id` or subscribes via WebSocket/SSE for push updates. This is what keeps the deployed app snappy under load.

---

## 5. Cross-Cutting Concerns to Carry Over

- **Auth guard:** `login_required` everywhere + `force_password_change` interceptor.
- **Public/anonymous flows:** public exam links (token + roll/college capture, no account).
- **Excel everywhere:** bulk topic upload, bulk enrollment, exam question upload, daily-question upload, result export. Back-office tooling is a real feature, not an afterthought.
- **YouTube ID extraction** for video lessons.
- **Cloudinary** for all media (question images, subject images, avatars).
- **IST timezone** semantics for streaks, exam windows, coupon validity.

---

## 6. Known Issues / Cleanups Spotted (fix during rebuild)

1. **Hardcoded secret fallbacks** in `settings.py` (Cloudinary name/key/secret literals present as defaults) — must move to env-only, no fallbacks, and rotate.
2. **Duplicated imports / two model blocks** in `core/models.py` and `essays/models.py` (files were appended to over time).
3. **Pass threshold inconsistency** in assessments (hardcoded 40% vs `pass_percentage` field).
4. **`@csrf_exempt` on payment + run_code** — becomes signed webhook verification + auth in the API.
5. **Hardcoded AI service IP** (`32.194.25.0:8000`) — move to env/config with retry + circuit breaker.
6. **Leaderboard hard-capped at 20**, no pagination.
7. **Missing indexes** on some hot filters (`release_date`, `is_visible`) — design Mongo indexes up front.
8. **Business logic in views** — the rebuild should use a clean **service layer** (controllers → services → models).

---

## 7. Proposed MERN Target Architecture (preview — we'll detail next)

```
apps/
  web/            React (Vite) SPA — student + public + admin UIs
  api/            Express REST API (auth, courses, exams, challenges,
                  essays, payments, careers, admin) — returns fast
  worker/         BullMQ worker — code execution (Piston) + grading
  ai-service/     (kept) FastAPI essay AI OR ported grading module
packages/
  shared/         shared types, validation (zod), constants, scoring weights
infra/            Docker, deploy configs
```

- **DB:** MongoDB Atlas + Mongoose, indexes designed from the schema above.
- **Cache/Queue:** Redis (BullMQ + response caching for catalog/leaderboard).
- **Auth:** JWT access+refresh (httpOnly cookies) + role guard (student/admin/anonymous-public).
- **Realtime:** SSE or Socket.IO for job results + exam timers.
- **UI:** React + Tailwind + a component system for a modern, catchy look (dashboard, exam runner, essay editor, leaderboard).

---

## 8. Rebuild Sequence (the plan we'll execute one prompt at a time)

1. ✅ **Deep analysis** (this doc).
2. **Architecture & data model design** — finalize Mongoose schemas, folder structure, API contract, queue design, auth strategy.
3. **Project scaffold** — monorepo, tooling, env, Docker, base API + React shell.
4. **Auth + Profile** — register/login/JWT/force-password-change.
5. **Curriculum/LMS** — Program/Subject/Module/Topic + enrollment + progress + quizzes.
6. **Payments** — PhonePe + orders + coupons + auto-enroll.
7. **Async execution layer** — BullMQ worker + Piston + job API/polling.
8. **Assessments** — exam runner, section timers, anti-cheat, grading, public links, Excel.
9. **Daily challenges** — streaks + leaderboard.
10. **Essays** — editor, autosave, analytics, AI grading integration.
11. **Careers/Placements + static pages.**
12. **Admin back office** — bulk Excel tooling, exports.
13. **UI/UX polish pass** — design system, animations, responsiveness.
14. **Testing, hardening, deployment.**

Each step is one prompt; the output of each drives the next.
