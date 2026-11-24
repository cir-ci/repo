# @circi/e2e

## 0.0.3

### Patch Changes

- [#56](https://github.com/cir-ci/repo/pull/56) [`4b98e62`](https://github.com/cir-ci/repo/commit/4b98e625b797f217a27f583b2c03348b8413c2df) Thanks [@michaelhazan](https://github.com/michaelhazan)! - The end-to-end checks that broke when each package got its own Vitest config work again. The Compose smoke test runs @circi/storage's live tests from that package's folder. The visual run (`pnpm test:visual`) receives the `CIRCI_*` settings through Turborepo again, and its uploader looks for the captures at the repository root, where the visual project writes them, so the design system's screenshots upload again.

- [#53](https://github.com/cir-ci/repo/pull/53) [`d7e643c`](https://github.com/cir-ci/repo/commit/d7e643cc99088f127e5b8cb3ea410a89969b56b4) Thanks [@michaelhazan](https://github.com/michaelhazan)! - Each package now typechecks, tests and builds on its own, with its configs from three new config packages: `@circi/typescript-config` (one tsconfig per kind of package), `@circi/vitest-config` (one Vitest config per kind) and `@circi/tsdown-config` (one build config per built package). Turborepo caches every package's typecheck and tests separately, so a change reruns only the packages it touches and the ones that depend on them, and a release's version bumps no longer rerun the whole gate. Nothing in what the packages ship changes: the built output is byte for byte the same.

- [#57](https://github.com/cir-ci/repo/pull/57) [`f16b179`](https://github.com/cir-ci/repo/commit/f16b179813a2867e5aa1626213ef28017465471f) Thanks [@michaelhazan](https://github.com/michaelhazan)! - Tests now run on a real Postgres server instead of PGlite, an in-process copy of Postgres. Each test file gets its own database, copied from one migrated template database on that server. Each PGlite database had used several gigabytes in the test process. Now the server holds the data, so the gate's test jobs need much less memory. On your machine, Testcontainers starts a `postgres:18-alpine` container the first time and later runs reuse it, so Docker must be running. On CI, and anywhere `CIRCI_TEST_DATABASE_URL` is set, the tests use that server instead. Production code is unchanged.

## 0.0.2

### Patch Changes

- [#49](https://github.com/cir-ci/repo/pull/49) [`ac0f3fe`](https://github.com/cir-ci/repo/commit/ac0f3feef038a27e98e40274571c9f9dbd068483) Thanks [@michaelhazan](https://github.com/michaelhazan)! - The GitHub App end-to-end test now waits for the "can't reach GitHub" banner to leave the project page, instead of counting it at the first paint, when the page is still drawn from the browser's stored copy of the project.

## 0.0.1

### Patch Changes

- [#28](https://github.com/cir-ci/repo/pull/28) [`0b9c42d`](https://github.com/cir-ci/repo/commit/0b9c42d44d7f54256aba09983b62a399491b5afe) Thanks [@michaelhazan](https://github.com/michaelhazan)! - The webhook retry end-to-end test no longer fails when it catches a retry in progress: on its sped-up clock a retried job can be running its next attempt when the test looks, so it accepts pending or running, with at least two attempts.

- [#34](https://github.com/cir-ci/repo/pull/34) [`3d7a9f9`](https://github.com/cir-ci/repo/commit/3d7a9f96ca6e11e1f251d77a3a3ab57a71b9b7a2) Thanks [@michaelhazan](https://github.com/michaelhazan)! - Server-side test cleanup, with nothing to change in how the app or the packages behave: shared helpers for seeded builds and members, the mail fake, sign-in by email code, PNG builders, temp directories, the auth secret and fake timers; duplicated and wrapper-only tests removed (each assertion still has a test that covers it); fixed waits in the live-stream tests replaced by ordered marker events; one database per file in the triage tests; the CLI's slow spawned test kept only where the exit code matters. `@circi/vitest`'s slow plugin test (a real nested Vitest run in Chromium) now runs as its own `pnpm test:vitest` task, part of `pnpm gate`, instead of on the Node tests' critical path.
