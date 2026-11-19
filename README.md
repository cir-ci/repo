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

## What it does

- **Upload from any CI.** `circi upload`, the [Vitest plugin](https://circi.dev/ci/vitest/), or the [Argos-compatible API](https://circi.dev/ci/argos-compatible-api/) for the Argos SDKs.
- **Compare against the right baseline.** The worker pairs each screenshot with its baseline and diffs the pixels.
- **Review as a team.** An inbox, review requests, comments on regions, live updates, and triage of flaky screenshots.
- **Gate the merge.** Checks and comments on GitHub, GitLab and Bitbucket, plus Slack, Linear, Jira, Figma and webhooks.
- **Host Storybook and reports** next to the builds, behind your workspace's sign-in.
- **Run it yourself.** One Docker image and Postgres. Screenshots go on local disk or S3-compatible storage.

## Quick start

Self-host with Docker Compose ([full guide](https://circi.dev/self-hosting/docker-compose/)):

```sh
cd deploy
cp .env.example .env    # set POSTGRES_PASSWORD, PUBLIC_URL and BETTER_AUTH_SECRET
docker compose up -d --build
```

Then upload from CI ([CLI reference](https://circi.dev/ci/cli/), [CI examples](https://circi.dev/ci/ci-examples/)):

```sh
CIRCI_TOKEN=circi_… CIRCI_API_URL=https://ci.acme.io npx circi upload ./screenshots --wait
```

## Documentation

Everything else is on **[circi.dev](https://circi.dev)**:

| | |
|---|---|
| [Introduction](https://circi.dev/introduction/what-is-circi/) | How a build flows, key concepts, how screenshots are compared |
| [Self-hosting](https://circi.dev/self-hosting/requirements/) | Install, [configuration](https://circi.dev/self-hosting/configuration/), [authentication](https://circi.dev/self-hosting/authentication/), [storage](https://circi.dev/self-hosting/storage/), upgrades, backups |
| [Using CirCI](https://circi.dev/using/reviewing-a-build/) | Reviewing, baselines, flaky screenshots, settings |
| [Upload from CI](https://circi.dev/ci/cli/) | The CLI, Vitest, CI examples, the Argos-compatible API |
| [Integrations](https://circi.dev/integrations/overview/) | GitHub, GitLab, Bitbucket, Slack, Linear, Jira, Figma, webhooks |
| [Reference](https://circi.dev/reference/http-api/) | [Environment variables](https://circi.dev/reference/environment-variables/), [admin CLI](https://circi.dev/reference/admin-cli/), HTTP API, exit codes |

## Development

pnpm 12 and Docker for the local environment. `pnpm install` also installs the Node it runs on (26, `devEngines` in package.json).

```sh
pnpm install
pnpm exec playwright install chromium   # once, for the browser tests
pnpm dev                                # Postgres, Mailpit, the server and the dashboard, seeded
pnpm gate                               # format check, lint, typecheck, tests and build
```

[Local development](https://circi.dev/contributing/local-development/) and the [repository layout](https://circi.dev/contributing/repo-layout/) are on the website. [CONTRIBUTING.md](CONTRIBUTING.md) covers how to contribute, and [CLAUDE.md](CLAUDE.md) has the code conventions.

## License

CirCI is free software under the [GNU General Public License v3.0](LICENSE) (GPL-3.0-only). Contributions are licensed the same way.
