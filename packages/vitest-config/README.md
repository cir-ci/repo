# @circi/vitest-config

The Vitest setup of every package. Each package runs its own tests from its own folder (`pnpm test` there,
the `test` task in turbo.json, cached on that package and the packages it depends on), with a
`vitest.config.ts` that calls the config for its kind and passes only what is its own:

| File | For |
| --- | --- |
| `shared.ts` | What every run shares: the `@circi/source` condition, timeouts, the reporters (retries, Flakiness.io on CI) and coverage. |
| `vitest.node.config.ts` | A package's Node tests (`node`, sharing modules between files, and `node-isolated` for the files that `vi.mock`). The packages that create a test database pass @circi/db's `template-db.ts` as `globalSetup`. Every other kind builds on it. |
| `vitest.web.config.ts` | The dashboard: Node tests, and its components in headless Chromium (`web-browser`). |
| `vitest.ui.config.ts` | @circi/ui: Node tests, components in Chromium (`ui`), and with VISUAL=1 the visual run (`ui-visual`). |
| `vitest.storybook.config.ts`, `vitest.cypress.config.ts`, `vitest.vitest.config.ts` | The published plugins: Node tests, and their slow tests against the real tool (`vitest.slow.ts`). |
| `vitest.e2e.config.ts` | `e2e`: the harness's fakes, and with E2E=1 / COMPOSE_SMOKE=1 the end-to-end groups and the Compose smoke test. |
| `browser.ts` | Headless Chromium and the dependencies Vite pre-bundles for the component tests. |
| `setup-node.ts` | Pins the time zone and language, restores mocks and timers after each test. |
| `retry-reporter.ts` | Lists the tests that passed only on their retry (`<package>/.vitest/retried-tests.txt`). |
| `no-netlink.ts` | The Chromium environment on Linux that ignores the host's network changes (the end-to-end and visual runs). |
