# Build context is the REPO ROOT (see docker-compose.yml).
FROM node:20-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
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
