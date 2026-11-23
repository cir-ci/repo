# @circi/e2e

## 0.0.1

### Patch Changes

- [#28](https://github.com/cir-ci/repo/pull/28) [`0b9c42d`](https://github.com/cir-ci/repo/commit/0b9c42d44d7f54256aba09983b62a399491b5afe) Thanks [@michaelhazan](https://github.com/michaelhazan)! - The webhook retry end-to-end test no longer fails when it catches a retry in progress: on its sped-up clock a retried job can be running its next attempt when the test looks, so it accepts pending or running, with at least two attempts.

- [#34](https://github.com/cir-ci/repo/pull/34) [`3d7a9f9`](https://github.com/cir-ci/repo/commit/3d7a9f96ca6e11e1f251d77a3a3ab57a71b9b7a2) Thanks [@michaelhazan](https://github.com/michaelhazan)! - Server-side test cleanup, with nothing to change in how the app or the packages behave: shared helpers for seeded builds and members, the mail fake, sign-in by email code, PNG builders, temp directories, the auth secret and fake timers; duplicated and wrapper-only tests removed (each assertion still has a test that covers it); fixed waits in the live-stream tests replaced by ordered marker events; one database per file in the triage tests; the CLI's slow spawned test kept only where the exit code matters. `@circi/vitest`'s slow plugin test (a real nested Vitest run in Chromium) now runs as its own `pnpm test:vitest` task, part of `pnpm gate`, instead of on the Node tests' critical path.
