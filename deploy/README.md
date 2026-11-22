# deploy/

The image and the files that run it. Installing, configuring and updating CirCI with them is on the website:
[Docker Compose](https://circi.dev/self-hosting/docker-compose/), [Terraform](https://circi.dev/self-hosting/terraform/), [Kubernetes](https://circi.dev/self-hosting/kubernetes/),
[TLS and reverse proxy](https://circi.dev/self-hosting/tls-and-reverse-proxy/), [Upgrades](https://circi.dev/self-hosting/upgrades-and-migrations/).

| File | |
| --- | --- |
| `Dockerfile` | The app's image: the server bundle, the dashboard, the migrations and the native diff library |
| `docker-compose.yml`, `.env.example` | The app and Postgres; `.env.example` names every setting (checked by `packages/config/test/deploy-settings.test.ts`) |
| `docker-compose.s3.yml` | Overlay: a local SeaweedFS for S3 storage, for development and the live S3 tests |
| `docker-compose.caddy.yml`, `Caddyfile`, `caddy/Dockerfile` | Overlay: Caddy with the Route53 DNS module, TLS for the dashboard and the sites domain, on-demand certificates for custom domains (confirmed with `/internal/tls-ask`) |
| [`terraform/`](terraform/README.md) | The Terraform module that runs a released image |
| [`helm/`](helm/README.md) | The Helm chart that runs a released image (and Caddy, optionally) on a Kubernetes cluster |

The release workflow (`.github/workflows/release.yml`) builds `Dockerfile` and `caddy/Dockerfile` once per app
version and publishes them as `ghcr.io/cir-ci/circi` and `circi-caddy`, and the chart as `oci://ghcr.io/cir-ci/charts/circi`. `pnpm test:compose` brings the Compose files up
for real (`e2e/test/deploy/`).

## What the image runs

The image runs **one bundle**, `/app/dist/main.mjs` (tsdown, `apps/server/tsdown.config.ts`; not minified, with source maps), plus the files the bundle can't carry:

```
/app/dist/            the bundle (main.mjs and a few chunks) and its source maps
/app/migrations/      packages/db/migrations           CIRCI_MIGRATIONS=/app/migrations
/app/web/             the dashboard (apps/web/dist)    CIRCI_WEB_DIST=/app/web
/app/node_modules/    sharp, pg, @aws-sdk/*, and their dependencies (pnpm deploy --prod)
```

- **External (installed, not bundled)** is exactly `apps/server/package.json` `dependencies`: `sharp` (native libvips binaries), `pg` (optional `pg-native` and dynamic requires in its connection code) and `@aws-sdk/client-s3` plus `@aws-sdk/s3-request-presigner` (about 30 packages, large, and they load credential providers dynamically). Everything else (our packages, Fastify, better-auth and its adapters, Drizzle, pino, zod, commander, nodemailer, pixelmatch, tar) is inlined. `apps/server/test/bundle.test.ts` fails if another bare import appears in the bundle. To add or remove an external, move it between `dependencies` and `devDependencies`.
- **Paths relative to the code's own file break in a bundle.** The two that exist are the migrations folder (`packages/db/src/client.ts`) and the web app (`webDistPath` in `apps/server/src/composition/services.ts`). Both are given by an environment variable that `@circi/config` reads (`CIRCI_MIGRATIONS`, `CIRCI_WEB_DIST`, set in the Dockerfile) and fall back to the source tree layout, so `pnpm circi` and the tests are unchanged. Running `node apps/server/dist/main.mjs` outside the image needs both variables.
- **Source maps are on**: the image sets `NODE_OPTIONS=--enable-source-maps`, and stack traces read `/app/apps/server/src/cli/server.ts:31` and `/app/packages/db/src/client.ts:113` (those files are not in the image; the paths mirror the repository).
