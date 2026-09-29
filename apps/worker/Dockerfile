# Build context is the REPO ROOT (see docker-compose.yml).
FROM node:20-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
# Pin pnpm to the repo's packageManager version (see apps/api/Dockerfile note):
# a bare `corepack enable` can fetch LATEST pnpm, whose `pnpm deploy` breaks on
# `workspace:*`. Keep in sync with root package.json.
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /repo

FROM base AS build
COPY pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY apps/worker ./apps/worker
RUN pnpm install --filter @codeapt/worker...
RUN pnpm --filter @codeapt/worker build
RUN pnpm --filter @codeapt/worker deploy --prod /app

FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app ./
CMD ["node", "dist/index.js"]
