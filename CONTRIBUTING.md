# Contributing to CirCI

The full guide is on the documentation site: **https://circi.dev/contributing/how-to-contribute/**. This is the short version.

- **The critical rule: understand your code.** If you can't explain your change and how it fits the system without an AI tool's help, don't submit it.
- **Disclose AI use.** Name the tool and how much it did, in the pull request. A human reads and edits everything sent to the project. AI-generated media isn't accepted.
- **Bugs:** search issues and discussions (closed ones too), then file a bug report with the issue form. Fill it in completely.
- **Ideas and questions:** open a discussion (Ideas, Q&A). A maintainer turns a well-defined idea into an issue.
- **Pull requests implement an issue.** Small fixes can go straight to a pull request; anything non-trivial starts with an issue so we agree on the shape first. Don't use a pull request to design a feature.
- **Set up:** Node 26 (`nvm use`), pnpm 12, Docker for `pnpm dev` and the end-to-end tests. `pnpm install`, `pnpm exec playwright install chromium`, `pnpm dev`.
- **Before you push:** `pnpm format`, then `pnpm gate` (format check, lint, typecheck, tests, build; no Docker). Run `pnpm gate:full` (adds the end-to-end tests) when you touch the server, worker or storage.
- **Conventions:** [CLAUDE.md](CLAUDE.md) has the layers, naming, copy and test rules; `packages/services/test/layers.test.ts` enforces the layering.
- **Tests are required**, in the smallest kind that covers the change. Anything only tested against a fake of an external service (GitHub, Slack, S3, ...) is said so in the pull request.
- **Commits** say what changed and why in the subject, explain behavior and reasoning in the body, and stay focused.
- **License:** contributions are licensed under the [GNU GPL v3](LICENSE), like the rest of CirCI.

## CI

CircleCI runs on every push and pull request: the `gate` job is `pnpm gate`. The `e2e` job (the end-to-end tests on Docker) and `compose-smoke` (the shipped Compose files) run on pushes to `main` and nightly. A nightly run is a CircleCI scheduled pipeline, which is set up in the CircleCI UI (Project Settings, Triggers) with the pipeline parameter `nightly` set to `true`. Make `gate` a required status check on pull requests.

Security issues: use the repository's Security tab ("Report a vulnerability"), not a public issue.

Adapted from [Ghostty's contributing guide](https://github.com/ghostty-org/ghostty/blob/main/CONTRIBUTING.md), © Mitchell Hashimoto and Ghostty contributors, MIT License (the notice is on the documentation page above).
