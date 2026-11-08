# syntax=docker/dockerfile:1
# Build from the repo root:  docker build -f deploy/Dockerfile -t circi .

ARG NODE_VERSION=26
ARG PNPM_VERSION=12.0.0

FROM node:${NODE_VERSION}-slim AS base
ARG PNPM_VERSION
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN npm install -g pnpm@${PNPM_VERSION} && npm cache clean --force
WORKDIR /app

# Workspace manifests only, so dependency layers stay cached when sources change.
FROM base AS manifests
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/api/package.json packages/api/
COPY packages/auth/package.json packages/auth/
COPY packages/cli/package.json packages/cli/
COPY packages/config/package.json packages/config/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/diff/package.json packages/diff/
COPY packages/integrations/package.json packages/integrations/
COPY packages/providers/package.json packages/providers/
COPY packages/services/package.json packages/services/
COPY packages/sites/package.json packages/sites/
COPY packages/storage/package.json packages/storage/
COPY packages/testing/package.json packages/testing/
COPY packages/vitest/package.json packages/vitest/
COPY e2e/package.json e2e/

FROM manifests AS build
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile
COPY tsconfig.base.json tsconfig.json ./
COPY apps apps
COPY packages packages
# Only what the image ships: the server bundle (inlines the workspace packages from source) and the
# dashboard. The CLI, @circi/vitest and the design system's own build are not part of the image.
RUN pnpm --filter @circi/server --filter @circi/web build

FROM manifests AS runtime-deps
# The server bundle inlines our code and almost every dependency; what is left external is the
# server package's `dependencies` (sharp, pg, the AWS SDK; see apps/server/tsdown.config.ts), and
# `pnpm deploy` installs exactly those, from the lockfile. The web app ships as static files below,
# and the CI CLI is published separately.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm --filter @circi/server deploy --prod /deploy

FROM node:${NODE_VERSION}-slim AS runtime
# CIRCI_MIGRATIONS and CIRCI_WEB_DIST: the bundle can't find these relative to itself.
ENV NODE_ENV=production \
    NODE_OPTIONS=--enable-source-maps \
    CIRCI_MIGRATIONS=/app/migrations \
    CIRCI_WEB_DIST=/app/web \
    STORAGE_PATH=/var/lib/circi/files \
    PORT=3000
WORKDIR /app
COPY --from=runtime-deps /deploy/node_modules node_modules
COPY --from=build /app/apps/server/dist dist
COPY --from=build /app/packages/db/migrations migrations
COPY --from=build /app/apps/web/dist web
RUN mkdir -p /var/lib/circi/files && chown node:node /var/lib/circi/files \
 && ln -s /app/dist/main.mjs /usr/local/bin/circi
USER node
VOLUME /var/lib/circi/files
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
ENTRYPOINT ["circi"]
CMD ["all"]
