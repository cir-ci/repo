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
COPY packages/providers/package.json packages/providers/
COPY packages/services/package.json packages/services/
COPY packages/storage/package.json packages/storage/
COPY packages/testing/package.json packages/testing/

FROM manifests AS build
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile
COPY tsconfig.base.json tsconfig.build.json ./
COPY apps apps
COPY packages packages
RUN pnpm build

FROM manifests AS runtime-tree
# Only the server and the packages it depends on: the web app ships as static files below,
# and the CI CLI is published separately, so React, MUI and friends stay out of the image.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile --prod --filter "@circi/server..."
COPY --from=build /app/apps/server/dist apps/server/dist
COPY --from=build /app/apps/worker/dist apps/worker/dist
COPY --from=build /app/packages/auth/dist packages/auth/dist
COPY --from=build /app/packages/config/dist packages/config/dist
COPY --from=build /app/packages/core/dist packages/core/dist
COPY --from=build /app/packages/db/dist packages/db/dist
COPY --from=build /app/packages/db/migrations packages/db/migrations
COPY --from=build /app/packages/diff/dist packages/diff/dist
COPY --from=build /app/packages/providers/dist packages/providers/dist
COPY --from=build /app/packages/services/dist packages/services/dist
COPY --from=build /app/apps/web/dist apps/web/dist
COPY --from=build /app/packages/storage/dist packages/storage/dist

FROM node:${NODE_VERSION}-slim AS runtime
ENV NODE_ENV=production \
    STORAGE_PATH=/var/lib/circi/files \
    PORT=3000
WORKDIR /app
COPY --from=runtime-tree /app /app
RUN mkdir -p /var/lib/circi/files && chown node:node /var/lib/circi/files \
 && ln -s /app/apps/server/dist/main.js /usr/local/bin/circi && chmod +x /app/apps/server/dist/main.js
USER node
VOLUME /var/lib/circi/files
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
ENTRYPOINT ["circi"]
CMD ["all"]
