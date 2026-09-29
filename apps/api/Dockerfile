# Build context is the REPO ROOT (see docker-compose.yml).
# Multi-stage: install + build the workspace, then ship a pruned prod bundle.
FROM node:20-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
# Pin pnpm to the repo's packageManager version. A bare `corepack enable` lets
# newer corepack ignore the pin and fetch LATEST pnpm (e.g. 12.x), whose
# `pnpm deploy` handles `workspace:*` differently and fails with
# "no package named @codeapt/shared is present in the workspace". Prepare the
# exact version explicitly and disable the interactive download prompt so the
# build is deterministic and non-blocking. Keep in sync with root package.json.
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /repo

FROM base AS build
# Workspace manifests first for better layer caching.
COPY pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY apps/api ./apps/api
RUN pnpm install --filter @codeapt/api...
RUN pnpm --filter @codeapt/api build
# Produce a self-contained deployable dir (prod deps only) at /app.
RUN pnpm --filter @codeapt/api deploy --prod /app

FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app ./
EXPOSE 4000
CMD ["node", "dist/index.js"]
