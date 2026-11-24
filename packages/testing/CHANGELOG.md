# @circi/testing

## 0.0.2

### Patch Changes

- [#53](https://github.com/cir-ci/repo/pull/53) [`d7e643c`](https://github.com/cir-ci/repo/commit/d7e643cc99088f127e5b8cb3ea410a89969b56b4) Thanks [@michaelhazan](https://github.com/michaelhazan)! - Each package now typechecks, tests and builds on its own, with its configs from three new config packages: `@circi/typescript-config` (one tsconfig per kind of package), `@circi/vitest-config` (one Vitest config per kind) and `@circi/tsdown-config` (one build config per built package). Turborepo caches every package's typecheck and tests separately, so a change reruns only the packages it touches and the ones that depend on them, and a release's version bumps no longer rerun the whole gate. Nothing in what the packages ship changes: the built output is byte for byte the same.

- [#57](https://github.com/cir-ci/repo/pull/57) [`f16b179`](https://github.com/cir-ci/repo/commit/f16b179813a2867e5aa1626213ef28017465471f) Thanks [@michaelhazan](https://github.com/michaelhazan)! - Tests now run on a real Postgres server instead of PGlite, an in-process copy of Postgres. Each test file gets its own database, copied from one migrated template database on that server. Each PGlite database had used several gigabytes in the test process. Now the server holds the data, so the gate's test jobs need much less memory. On your machine, Testcontainers starts a `postgres:18-alpine` container the first time and later runs reuse it, so Docker must be running. On CI, and anywhere `CIRCI_TEST_DATABASE_URL` is set, the tests use that server instead. Production code is unchanged.

## 0.0.1

### Patch Changes

- [#39](https://github.com/cir-ci/repo/pull/39) [`5d0dc77`](https://github.com/cir-ci/repo/commit/5d0dc778f9d8340ac1d967f22e20899dfbe17e50) Thanks [@michaelhazan](https://github.com/michaelhazan)! - The image library is loaded when the server first reads, diffs or resizes an image, not when it starts, which makes startup and the test suite faster. Image handling is unchanged.

- [#34](https://github.com/cir-ci/repo/pull/34) [`3d7a9f9`](https://github.com/cir-ci/repo/commit/3d7a9f96ca6e11e1f251d77a3a3ab57a71b9b7a2) Thanks [@michaelhazan](https://github.com/michaelhazan)! - Server-side test cleanup, with nothing to change in how the app or the packages behave: shared helpers for seeded builds and members, the mail fake, sign-in by email code, PNG builders, temp directories, the auth secret and fake timers; duplicated and wrapper-only tests removed (each assertion still has a test that covers it); fixed waits in the live-stream tests replaced by ordered marker events; one database per file in the triage tests; the CLI's slow spawned test kept only where the exit code matters. `@circi/vitest`'s slow plugin test (a real nested Vitest run in Chromium) now runs as its own `pnpm test:vitest` task, part of `pnpm gate`, instead of on the Node tests' critical path.

- [#35](https://github.com/cir-ci/repo/pull/35) [`ab6be07`](https://github.com/cir-ci/repo/commit/ab6be076a8559f5167443de59bd7d3df5140e28b) Thanks [@michaelhazan](https://github.com/michaelhazan)! - The fake CirCI API server the CLI's tests used (`FakeCirci`) is now in `@circi/testing/hosts`, so the integrations' tests share it, with an `outcome` option, `uploads()` and `json(method, path)`.
