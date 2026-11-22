<p align="center">
  <img src="apps/web/src/features/auth/logo.svg" width="88" height="88" alt="">
</p>

<h1 align="center">CirCI</h1>

<p align="center">
  <strong>Review every visual change before it merges.</strong><br>
  Self-hosted visual regression testing: CI uploads screenshots, CirCI compares them with the
  baseline, and your team approves or rejects what changed.
</p>

<p align="center">
  <a href="https://circi.dev"><strong>Documentation</strong></a> ·
  <a href="https://circi.dev/getting-started/run-it-locally/">Getting started</a> ·
  <a href="https://circi.dev/self-hosting/requirements/">Self-hosting</a> ·
  <a href="https://circi.dev/roadmap/">Roadmap</a>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-GPL--3.0-blue" alt="License: GPL-3.0"></a>
  <a href="https://www.npmjs.com/package/@circi/cli"><img src="https://img.shields.io/npm/v/@circi/cli?label=%40circi%2Fcli" alt="@circi/cli on npm"></a>
</p>

> [!NOTE]
> CirCI is in active development. See the [roadmap](https://circi.dev/roadmap/) for what's planned.

Using and running CirCI (installing it, uploading from CI, reviewing, configuration, the API) is documented on
**[circi.dev](https://circi.dev)**. This repository's READMEs are about the code.

## Development

pnpm 12 and Docker for the local environment. `pnpm install` also installs the Node it runs on (26, `devEngines` in package.json).

```sh
pnpm install
pnpm exec playwright install chromium   # once, for the browser tests
pnpm dev                                # Postgres, Mailpit, the server and the dashboard, seeded
pnpm gate                               # format check, lint, typecheck, tests and build
```

[CONTRIBUTING.md](CONTRIBUTING.md) covers how to contribute, and [CLAUDE.md](CLAUDE.md) has the layers and code
conventions. [Local development](https://circi.dev/contributing/local-development/) is on the website.

## The code

| Folder | |
| --- | --- |
| `apps/server` | The HTTP server and the admin CLI (`circi`), bundled into the image |
| `apps/worker` | The job runner (builds, notifications, webhooks); the server bundle inlines it |
| `apps/web` | The dashboard (React, Vite) |
| `packages/` | `core` (rules, no I/O), `services` (use cases), `db` (Drizzle schema, queries, queue), `config`, `auth`, `api` (wire types), `diff`, `storage`, `sites`, [`integrations`](packages/integrations/README.md), `ui` (the design system, with [its visual tests](packages/ui/visual/README.md)), `testing` |
| `packages/cli`, `packages/vitest` | The npm packages: [`@circi/cli`](packages/cli/README.md) and [`@circi/vitest`](packages/vitest/README.md) |
| [`deploy/`](deploy/README.md) | The image, the Compose files, Caddy and [the Terraform module](deploy/terraform/README.md) |
| `dev/` | `pnpm dev`, the local environment and its seed |
| [`e2e/`](e2e/README.md) | End-to-end tests against the real Docker stack |
| [`perf/`](perf/README.md) | The k6 load tests and the diff benchmark |

## License

CirCI is free software under the [GNU General Public License v3.0](LICENSE) (GPL-3.0-only). Contributions are licensed the same way.
