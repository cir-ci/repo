# Deploying CirCI

`docker compose up -d --build` runs the app and Postgres (see the top-level README). For TLS and hosted sites, add Caddy: `docker compose -f docker-compose.yml -f docker-compose.caddy.yml up -d --build`.

> ⚠️ **If you host sites, read [docs/static-sites.md](../docs/static-sites.md) first.** The sites domain must be a separate domain used for nothing else, and nothing on the dashboard's parent domain may set cookies for the whole domain: uploaded sites run arbitrary JavaScript. `circi admin doctor` checks what it can.

Files: `Dockerfile` (the app), `docker-compose.yml`, `docker-compose.s3.yml` (local MinIO), `docker-compose.caddy.yml` + `Caddyfile` + `caddy/Dockerfile` (TLS with Route53 DNS-01), `.env.example`.

## What the image runs

The image runs **one bundle**, `/app/dist/main.mjs` (tsdown, `apps/server/tsdown.config.ts`; not minified, with source maps), plus the files the bundle can't carry:

```
/app/dist/            the bundle (main.mjs and a few chunks) and its source maps
/app/migrations/      packages/db/migrations           CIRCI_MIGRATIONS=/app/migrations
/app/web/             the dashboard (apps/web/dist)    CIRCI_WEB_DIST=/app/web
/app/node_modules/    sharp, pg, @aws-sdk/*, and their dependencies (pnpm deploy --prod)
```

- **External (installed, not bundled)** is exactly `apps/server/package.json` `dependencies`: `sharp` (native libvips binaries), `pg` (optional `pg-native` and dynamic requires in its connection code) and `@aws-sdk/client-s3` plus `@aws-sdk/s3-request-presigner` (about 30 packages, large, and they load credential providers dynamically). Everything else (our packages, Fastify, better-auth and its adapters, Drizzle, pino, zod, commander, nodemailer, pixelmatch, tar) is inlined. `apps/server/test/bundle.test.ts` fails if another bare import appears in the bundle. To add or remove an external, move it between `dependencies` and `devDependencies`.
- **Paths relative to the code's own file break in a bundle.** The two that exist are the migrations folder (`packages/db/src/client.ts`) and the web app (`webDistPath` in `apps/server/src/lifecycle/services.ts`). Both read an environment variable first (set in the Dockerfile) and fall back to the source tree layout, so `pnpm circi` and the tests are unchanged. Running `node apps/server/dist/main.mjs` outside the image needs both variables.
- **Source maps are on**: the image sets `NODE_OPTIONS=--enable-source-maps`, and stack traces read `/app/apps/server/src/cli/server.ts:31` and `/app/packages/db/src/client.ts:113` (those files are not in the image; the paths mirror the repository).

### Numbers (2026-11-08, Apple silicon, Docker Desktop)

Start time is `docker run` until `/healthz` answers, with an empty Postgres (migrations included), median of 5 runs.

|                       | before (tsc output, `node_modules` for the server and its workspace dependencies) | after (bundle) |
| --------------------- | ------------------------------------------------------------------------------ | -------------- |
| image size            | 683 MB                                                      | 457 MB (compressed size not measured) |
| start until healthy   | 0.86 s                                                                          | 0.6 s (0.58 to 0.63) |
| application files     | many `dist` folders plus a full production `node_modules`                       | bundle 5.5 MB (main.mjs; 17.9 MB with chunks and maps), `node_modules` 44 MB |

Most of the rest is the `node:26-slim` base image.

