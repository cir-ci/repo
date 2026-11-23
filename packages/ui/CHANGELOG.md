# @circi/ui

## 0.0.1

### Patch Changes

- [#38](https://github.com/cir-ci/repo/pull/38) [`6efde8b`](https://github.com/cir-ci/repo/commit/6efde8bb1b3a199fe9d4894439cf36dab21a51e6) Thanks [@michaelhazan](https://github.com/michaelhazan)! - A ListRow test no longer fails now and then on a busy machine: it no longer depends on where an earlier test left the mouse pointer. Nothing changes in the component.

- [#36](https://github.com/cir-ci/repo/pull/36) [`98437cc`](https://github.com/cir-ci/repo/commit/98437cc08305e1280797643150b09892b4330575) Thanks [@michaelhazan](https://github.com/michaelhazan)! - The dashboard's and the design system's component tests are faster and steadier, with no change to what the app does or looks like: the test browser prefers reduced motion (so no test waits out a transition), one typed fake API and one auth-client mock serve every dashboard test, a test fails on an unexpected `console.error` or unhandled rejection, and a run lists the tests that passed only on their retry. The persisted query cache's write throttle is now an option of `startPersisting` and `restorePersisted` (2 seconds, as before, unless asked).

- [#31](https://github.com/cir-ci/repo/pull/31) [`42f0b8e`](https://github.com/cir-ci/repo/commit/42f0b8e69e1dc06579006d8468aeb9c8a8453a1d) Thanks [@michaelhazan](https://github.com/michaelhazan)! - The resize handle's hover test waits for the highlight's fade-in instead of reading the color at once; it failed now and then on slower machines.
