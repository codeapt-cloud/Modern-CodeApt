# Build context is the REPO ROOT (see docker-compose.yml).
# Multi-stage: install + build the workspace, then ship a pruned prod bundle.
FROM node:20-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
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
