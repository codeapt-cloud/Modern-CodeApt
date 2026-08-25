# CodeApt (MERN rebuild)

Coding-aptitude & campus-placement training platform, rebuilt from a Django
monolith into a modern, production-grade **MERN monorepo** with an async job
queue for fast post-deploy responses.

> **Status:** Step 1 — *walking skeleton*. Everything is wired, typed, and
> boots; there is **no feature/business logic yet**. See
> [`01_CodeApt_Deep_Analysis.md`](./01_CodeApt_Deep_Analysis.md) for the full
> product spec that drives the rebuild.

---

## Monorepo map

```
.
├── apps/
│   ├── api/          Express + TypeScript REST API
│   │                 (routes → controllers → services → models,
│   │                  zod env loader, Mongoose, health, error mw, logging)
│   ├── worker/       BullMQ worker — 4 queues (default/practice/
│   │                 assessment/playground) with no-op processors
│   └── web/          React + Vite + TypeScript + Tailwind SPA
│                     (router, typed API client, health page)
├── packages/
│   └── shared/       Shared TS types, enums, constants, scoring
│                     weights, queue config, and zod validators
├── docker-compose.yml   App services (default) + opt-in `local-db` Mongo/Redis
├── tsconfig.base.json   Strict TS config extended by every package
├── eslint.config.mjs    Single shared flat ESLint config
└── .env.example         Full environment inventory
```

The API, worker, and web all import shared contracts from `@codeapt/shared`
— there is no duplication of enums, statuses, or validation schemas.

---

## Prerequisites

- **Node.js ≥ 20** (tested on 22)
- **pnpm 9** — `corepack enable && corepack prepare pnpm@9.15.0 --activate`
- **Docker** (for local MongoDB + Redis)

---

## Run it locally

```bash
# 1. Install all workspace dependencies
pnpm install

# 2. Start local MongoDB + Redis (opt-in `local-db` profile, bound to 127.0.0.1)
docker compose --profile local-db up -d mongo redis

# 3. Create local env files (dev-ready defaults included)
cp apps/api/.env.example    apps/api/.env
cp apps/worker/.env.example apps/worker/.env
cp apps/web/.env.example    apps/web/.env

# 4. Boot api + worker + web together
pnpm dev
```

Then:

- **API** → http://localhost:4000/api/health (JSON, DB status)
- **Web** → http://localhost:5173 (open **/health** to see the API status)
- **Worker** → logs "Registered worker" for all 4 queues

> The web dev server proxies `/api/*` to the API, so the SPA calls the API
> same-origin (no CORS friction in dev).

### Everything in containers (optional, local)

```bash
# app services + the local data stores, all in containers
docker compose --profile local-db up -d --build
# web → http://localhost:8080 , api → http://localhost:4000
```

> **Production is different — and deliberately so.** A bare `docker compose up -d`
> starts **only the app services** (api, worker, asr, web, piston); it does **not**
> start a database. In production, `MONGODB_URI` and `REDIS_URL` in `.env` point at
> the **managed** Mongo + Redis, and the `local-db` profile is left off so the box
> never runs — or reconnects to — a throwaway local database. Those connection
> strings, `CORS_ORIGIN`, and the JWT secrets are **required**: a missing value
> fails the `up` loudly rather than silently falling back to a wrong default. See
> the header of `docker-compose.yml` for the incident this prevents.
>
> The api and worker load the **whole** repo-root `.env` via `env_file:`, so every
> variable the apps read — `ENCRYPTION_KEY`, `ASR_URL`, `CLOUDINARY_*`,
> `ESSAY_LLM_*`, … — reaches the container without a hand-maintained
> `environment:` list (a capability going missing because a var wasn't copied
> across was its own production incident). The `environment:` block still wins
> over `env_file` for the keys it pins (`NODE_ENV`, the `${VAR:?}` guards). Keep
> `.env` complete — `.env.example` is the full inventory, flagging which vars
> **silently disable a capability** when absent.

---

## Common scripts

Run from the repo root:

| Command             | What it does                                  |
| ------------------- | --------------------------------------------- |
| `pnpm dev`          | api + worker + web concurrently               |
| `pnpm build`        | build every package/app                       |
| `pnpm -r typecheck` | strict TypeScript check across the monorepo   |
| `pnpm -r lint`      | ESLint across the monorepo                    |
| `pnpm format`       | Prettier write                                |

Per-app scripts (`dev`/`build`/`typecheck`/`lint`) also exist, e.g.
`pnpm --filter @codeapt/api dev`.

---

## Troubleshooting

- **BullMQ logs `Redis version needs to be greater or equal than 5.0.0`.**
  Another (old) Redis is already listening on host port `6379` and shadowing
  the Docker container. Stop the native service (Windows: check the service
  holding `6379`), or point `REDIS_URL` at an unused port and publish the
  container there (e.g. `6380`). The bundled `redis:7-alpine` is modern enough;
  the conflict is a stale host install.
- **`Invalid environment configuration` on boot.** Copy the `.env.example`
  files to `.env` and fill required values — the loader fails fast by design.

---

## Conventions

- **TypeScript strict everywhere**; no `any` without a justifying comment.
- **No secrets in code** — env is validated with zod and **fails fast** if a
  required variable is missing. Local values live in gitignored `.env` files.
- **Service-layer pattern** in the API; controllers stay thin.
- **All datetimes are UTC**; IST is a display concern handled client-side.
- Money is stored as **integer paise** (minor units) to stay decimal-safe.
