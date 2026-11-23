# @circi/db

## 0.1.0

### Minor Changes

- [#44](https://github.com/cir-ci/repo/pull/44) [`365fbaa`](https://github.com/cir-ci/repo/commit/365fbaa8e5857dc73cc2723504c0627377f7aa07) Thanks [@michaelhazan](https://github.com/michaelhazan)! - Removed the Argos-compatible `/v2` API, which never worked with the real Argos SDKs (they reject CirCI's token format and localhost, and expect a different baseline reply). Upload with `circi upload`, the Vitest plugin or the Cypress plugin. A migration drops the unused `commit_ancestry` table (`builds.history_source` stays for one more release so a rolling deploy is safe), and builds that recorded `sdk` as their baseline source now show none. The Projects empty state no longer mentions Argos.

## 0.0.1

### Patch Changes

- [#34](https://github.com/cir-ci/repo/pull/34) [`3d7a9f9`](https://github.com/cir-ci/repo/commit/3d7a9f96ca6e11e1f251d77a3a3ab57a71b9b7a2) Thanks [@michaelhazan](https://github.com/michaelhazan)! - Server-side test cleanup, with nothing to change in how the app or the packages behave: shared helpers for seeded builds and members, the mail fake, sign-in by email code, PNG builders, temp directories, the auth secret and fake timers; duplicated and wrapper-only tests removed (each assertion still has a test that covers it); fixed waits in the live-stream tests replaced by ordered marker events; one database per file in the triage tests; the CLI's slow spawned test kept only where the exit code matters. `@circi/vitest`'s slow plugin test (a real nested Vitest run in Chromium) now runs as its own `pnpm test:vitest` task, part of `pnpm gate`, instead of on the Node tests' critical path.
