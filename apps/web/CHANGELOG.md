# @circi/web

## 0.1.1

### Patch Changes

- [#53](https://github.com/cir-ci/repo/pull/53) [`d7e643c`](https://github.com/cir-ci/repo/commit/d7e643cc99088f127e5b8cb3ea410a89969b56b4) Thanks [@michaelhazan](https://github.com/michaelhazan)! - Each package now typechecks, tests and builds on its own, with its configs from three new config packages: `@circi/typescript-config` (one tsconfig per kind of package), `@circi/vitest-config` (one Vitest config per kind) and `@circi/tsdown-config` (one build config per built package). Turborepo caches every package's typecheck and tests separately, so a change reruns only the packages it touches and the ones that depend on them, and a release's version bumps no longer rerun the whole gate. Nothing in what the packages ship changes: the built output is byte for byte the same.

- [#59](https://github.com/cir-ci/repo/pull/59) [`8381d8a`](https://github.com/cir-ci/repo/commit/8381d8a2babf0277e9adbcddc809291058e6c043) Thanks [@michaelhazan](https://github.com/michaelhazan)! - The dashboard's tests are faster on CI: 242 s instead of 441 s, which brings the gate's test half from 8m02s to 5m33s. Most of that comes from running two workers there instead of one. The gate had spent its last minutes waiting on web's tests alone, and the memory a single worker used to protect is free now that the test databases live on a Postgres server. Two tests no longer wait out a timeout. In Shell, opening a project page recorded the workspace as last opened through a request the test hadn't faked. Its "not found" toast covered the phone-sized menu for 10 seconds, and the next click waited it out. In Accounts, a check for the "Copied" toast also matched the copy button, which reads "Copied" too, so it ran until its 5-second timeout.

## 0.1.0

### Minor Changes

- [#44](https://github.com/cir-ci/repo/pull/44) [`365fbaa`](https://github.com/cir-ci/repo/commit/365fbaa8e5857dc73cc2723504c0627377f7aa07) Thanks [@michaelhazan](https://github.com/michaelhazan)! - Removed the Argos-compatible `/v2` API, which never worked with the real Argos SDKs (they reject CirCI's token format and localhost, and expect a different baseline reply). Upload with `circi upload`, the Vitest plugin or the Cypress plugin. A migration drops the unused `commit_ancestry` table (`builds.history_source` stays for one more release so a rolling deploy is safe), and builds that recorded `sdk` as their baseline source now show none. The Projects empty state no longer mentions Argos.

## 0.0.1

### Patch Changes

- [#27](https://github.com/cir-ci/repo/pull/27) [`bce1004`](https://github.com/cir-ci/repo/commit/bce1004a3061f94649d98d9bcb9e44dba250fd67) Thanks [@michaelhazan](https://github.com/michaelhazan)! - A dashboard test that hovers a project's "+N" chip waits for the avatar stack's spread animation to finish first; it failed now and then on slower machines.

- [#39](https://github.com/cir-ci/repo/pull/39) [`5d0dc77`](https://github.com/cir-ci/repo/commit/5d0dc778f9d8340ac1d967f22e20899dfbe17e50) Thanks [@michaelhazan](https://github.com/michaelhazan)! - The server and dashboard tests run in about half the time: test files now share loaded modules instead of loading the server again for each one. Nothing changes in the app.

- [#36](https://github.com/cir-ci/repo/pull/36) [`98437cc`](https://github.com/cir-ci/repo/commit/98437cc08305e1280797643150b09892b4330575) Thanks [@michaelhazan](https://github.com/michaelhazan)! - The dashboard's and the design system's component tests are faster and steadier, with no change to what the app does or looks like: the test browser prefers reduced motion (so no test waits out a transition), one typed fake API and one auth-client mock serve every dashboard test, a test fails on an unexpected `console.error` or unhandled rejection, and a run lists the tests that passed only on their retry. The persisted query cache's write throttle is now an option of `startPersisting` and `restorePersisted` (2 seconds, as before, unless asked).
