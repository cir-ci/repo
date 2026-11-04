# syntax=docker/dockerfile:1
# Build from the repo root:  docker build -f deploy/Dockerfile -t zopheros .

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
COPY apps/worker/package.json apps/worker/
COPY packages/config/package.json packages/config/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/storage/package.json packages/storage/

FROM manifests AS build
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile
COPY tsconfig.base.json tsconfig.build.json ./
COPY apps apps
COPY packages packages
RUN pnpm build

FROM manifests AS runtime-tree
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile --prod
COPY --from=build /app/apps/server/dist apps/server/dist
COPY --from=build /app/apps/worker/dist apps/worker/dist
COPY --from=build /app/packages/config/dist packages/config/dist
COPY --from=build /app/packages/core/dist packages/core/dist
COPY --from=build /app/packages/db/dist packages/db/dist
COPY --from=build /app/packages/db/migrations packages/db/migrations
COPY --from=build /app/packages/storage/dist packages/storage/dist

FROM node:${NODE_VERSION}-slim AS runtime
ENV NODE_ENV=production \
    STORAGE_PATH=/var/lib/zopheros/files \
    PORT=3000
WORKDIR /app
COPY --from=runtime-tree /app /app
RUN mkdir -p /var/lib/zopheros/files && chown node:node /var/lib/zopheros/files \
 && ln -s /app/apps/server/dist/main.js /usr/local/bin/zopheros && chmod +x /app/apps/server/dist/main.js
USER node
VOLUME /var/lib/zopheros/files
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
ENTRYPOINT ["zopheros"]
CMD ["all"]
