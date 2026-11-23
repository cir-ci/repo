# @circi/testing

## 0.0.1

### Patch Changes

- [#39](https://github.com/cir-ci/repo/pull/39) [`5d0dc77`](https://github.com/cir-ci/repo/commit/5d0dc778f9d8340ac1d967f22e20899dfbe17e50) Thanks [@michaelhazan](https://github.com/michaelhazan)! - The image library is loaded when the server first reads, diffs or resizes an image, not when it starts, which makes startup and the test suite faster. Image handling is unchanged.

- [#34](https://github.com/cir-ci/repo/pull/34) [`3d7a9f9`](https://github.com/cir-ci/repo/commit/3d7a9f96ca6e11e1f251d77a3a3ab57a71b9b7a2) Thanks [@michaelhazan](https://github.com/michaelhazan)! - Server-side test cleanup, with nothing to change in how the app or the packages behave: shared helpers for seeded builds and members, the mail fake, sign-in by email code, PNG builders, temp directories, the auth secret and fake timers; duplicated and wrapper-only tests removed (each assertion still has a test that covers it); fixed waits in the live-stream tests replaced by ordered marker events; one database per file in the triage tests; the CLI's slow spawned test kept only where the exit code matters. `@circi/vitest`'s slow plugin test (a real nested Vitest run in Chromium) now runs as its own `pnpm test:vitest` task, part of `pnpm gate`, instead of on the Node tests' critical path.

- [#35](https://github.com/cir-ci/repo/pull/35) [`ab6be07`](https://github.com/cir-ci/repo/commit/ab6be076a8559f5167443de59bd7d3df5140e28b) Thanks [@michaelhazan](https://github.com/michaelhazan)! - The fake CirCI API server the CLI's tests used (`FakeCirci`) is now in `@circi/testing/hosts`, so the integrations' tests share it, with an `outcome` option, `uploads()` and `json(method, path)`.
