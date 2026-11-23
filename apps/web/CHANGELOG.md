# @circi/web

## 0.0.1

### Patch Changes

- [#27](https://github.com/cir-ci/repo/pull/27) [`bce1004`](https://github.com/cir-ci/repo/commit/bce1004a3061f94649d98d9bcb9e44dba250fd67) Thanks [@michaelhazan](https://github.com/michaelhazan)! - A dashboard test that hovers a project's "+N" chip waits for the avatar stack's spread animation to finish first; it failed now and then on slower machines.

- [#39](https://github.com/cir-ci/repo/pull/39) [`5d0dc77`](https://github.com/cir-ci/repo/commit/5d0dc778f9d8340ac1d967f22e20899dfbe17e50) Thanks [@michaelhazan](https://github.com/michaelhazan)! - The server and dashboard tests run in about half the time: test files now share loaded modules instead of loading the server again for each one. Nothing changes in the app.

- [#36](https://github.com/cir-ci/repo/pull/36) [`98437cc`](https://github.com/cir-ci/repo/commit/98437cc08305e1280797643150b09892b4330575) Thanks [@michaelhazan](https://github.com/michaelhazan)! - The dashboard's and the design system's component tests are faster and steadier, with no change to what the app does or looks like: the test browser prefers reduced motion (so no test waits out a transition), one typed fake API and one auth-client mock serve every dashboard test, a test fails on an unexpected `console.error` or unhandled rejection, and a run lists the tests that passed only on their retry. The persisted query cache's write throttle is now an option of `startPersisting` and `restorePersisted` (2 seconds, as before, unless asked).
