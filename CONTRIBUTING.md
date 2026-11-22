# Contributing to CirCI

The full guide is on the documentation site: **https://circi.dev/contributing/how-to-contribute/**. This is the short version.

- **The critical rule: understand your code.** If you can't explain your change and how it fits the system without an AI tool's help, don't submit it.
- **Disclose AI use.** Name the tool and how much it did, in the pull request. A human reads and edits everything sent to the project. AI-generated media isn't accepted.
- **Bugs:** search issues and discussions (closed ones too), then file a bug report with the issue form. Fill it in completely.
- **Ideas and questions:** open a discussion (Ideas, Q&A). A maintainer turns a well-defined idea into an issue.
- **Pull requests implement an issue.** Small fixes can go straight to a pull request; anything non-trivial starts with an issue so we agree on the shape first. Don't use a pull request to design a feature.
- **Set up:** pnpm 12 (it installs Node 26 itself, from package.json's `devEngines`), Docker for `pnpm dev` and the end-to-end tests. `pnpm install`, `pnpm exec playwright install chromium`, `pnpm dev`.
- **Before you push:** `pnpm format`, then `pnpm gate` (format check, lint, typecheck, tests, build; no Docker). Run `pnpm gate:full` (adds the end-to-end tests) when you touch the server, worker or storage.
- **Changesets:** three things are released: `@circi/cli` and `@circi/vitest` (npm) and the app, versioned as `@circi/server` (the `ghcr.io/cir-ci/circi` image). A change to any of them needs a changeset; the app counts as changed when anything in its image does (the server and the packages it uses, the dashboard, `deploy/`). A git hook (husky, installed by `pnpm install`) writes one for you: when a commit changes a released package, or one it depends on, and adds no changeset, it creates `.changeset/auto-<sha>.md` from the commit's first line and amends it into the commit (a patch; put `[minor]` or `[major]` in the message for more). Write your own with `pnpm changeset` for a better release note, and the hook leaves it alone; `CIRCI_AUTO_CHANGESET=0 git commit …` skips it. Every package is versioned, private ones too (`apps/*`, `packages/*`, `e2e`, `dev`, `perf`), so a change to any of them needs a changeset with a written note, even a change to tests or docs; don't use `pnpm changeset --empty`. Patch for fixes, minor for new flags or options and for breaking changes before 1.0. CI checks it.
- **Conventions:** [CLAUDE.md](CLAUDE.md) has the layers, naming, copy and test rules; `packages/services/test/layers.test.ts` enforces the layering.
- **Tests are required**, in the smallest kind that covers the change. Anything only tested against a fake of an external service (GitHub, Slack, S3, ...) is said so in the pull request. The live S3 storage tests run when `CIRCI_TEST_S3_ENDPOINT` is set (e.g. `http://localhost:9000` with `deploy/docker-compose.s3.yml`) and are skipped otherwise.
- **Commits** say what changed and why in the subject, explain behavior and reasoning in the body, and stay focused.
- **License:** contributions are licensed under the [GNU GPL v3](LICENSE), like the rest of CirCI.

## CI

CircleCI runs on every push and pull request: the `gate` job is `pnpm gate` in its two halves, `pnpm gate:checks` (format check, lint, typecheck) and then `pnpm gate:tests` (tests and build), so the type-aware lint never runs beside the browser tests on the 8 GiB machine. A `changeset` job fails a pull request that changes a published package without a changeset. Releases run on GitHub Actions (`.github/workflows/release.yml`, for npm provenance). The `e2e` job (the end-to-end tests on Docker) and `compose-smoke` (the shipped Compose files) run on pushes to `main` and nightly. A nightly run is a CircleCI scheduled pipeline, which is set up in the CircleCI UI (Project Settings, Triggers) with the pipeline parameter `nightly` set to `true`. Make `gate` a required status check on pull requests.

Security issues: use the repository's Security tab ("Report a vulnerability"), not a public issue.

Adapted from [Ghostty's contributing guide](https://github.com/ghostty-org/ghostty/blob/main/CONTRIBUTING.md), © Mitchell Hashimoto and Ghostty contributors, MIT License (the notice is on the documentation page above).
