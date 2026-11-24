# @circi/ui

## 0.0.2

### Patch Changes

- [#56](https://github.com/cir-ci/repo/pull/56) [`4b98e62`](https://github.com/cir-ci/repo/commit/4b98e625b797f217a27f583b2c03348b8413c2df) Thanks [@michaelhazan](https://github.com/michaelhazan)! - The end-to-end checks that broke when each package got its own Vitest config work again. The Compose smoke test runs @circi/storage's live tests from that package's folder. The visual run (`pnpm test:visual`) receives the `CIRCI_*` settings through Turborepo again, and its uploader looks for the captures at the repository root, where the visual project writes them, so the design system's screenshots upload again.

- [#53](https://github.com/cir-ci/repo/pull/53) [`d7e643c`](https://github.com/cir-ci/repo/commit/d7e643cc99088f127e5b8cb3ea410a89969b56b4) Thanks [@michaelhazan](https://github.com/michaelhazan)! - Each package now typechecks, tests and builds on its own, with its configs from three new config packages: `@circi/typescript-config` (one tsconfig per kind of package), `@circi/vitest-config` (one Vitest config per kind) and `@circi/tsdown-config` (one build config per built package). Turborepo caches every package's typecheck and tests separately, so a change reruns only the packages it touches and the ones that depend on them, and a release's version bumps no longer rerun the whole gate. Nothing in what the packages ship changes: the built output is byte for byte the same.

## 0.0.1

### Patch Changes

- [#38](https://github.com/cir-ci/repo/pull/38) [`6efde8b`](https://github.com/cir-ci/repo/commit/6efde8bb1b3a199fe9d4894439cf36dab21a51e6) Thanks [@michaelhazan](https://github.com/michaelhazan)! - A ListRow test no longer fails now and then on a busy machine: it no longer depends on where an earlier test left the mouse pointer. Nothing changes in the component.

- [#36](https://github.com/cir-ci/repo/pull/36) [`98437cc`](https://github.com/cir-ci/repo/commit/98437cc08305e1280797643150b09892b4330575) Thanks [@michaelhazan](https://github.com/michaelhazan)! - The dashboard's and the design system's component tests are faster and steadier, with no change to what the app does or looks like: the test browser prefers reduced motion (so no test waits out a transition), one typed fake API and one auth-client mock serve every dashboard test, a test fails on an unexpected `console.error` or unhandled rejection, and a run lists the tests that passed only on their retry. The persisted query cache's write throttle is now an option of `startPersisting` and `restorePersisted` (2 seconds, as before, unless asked).

- [#31](https://github.com/cir-ci/repo/pull/31) [`42f0b8e`](https://github.com/cir-ci/repo/commit/42f0b8e69e1dc06579006d8468aeb9c8a8453a1d) Thanks [@michaelhazan](https://github.com/michaelhazan)! - The resize handle's hover test waits for the highlight's fade-in instead of reading the color at once; it failed now and then on slower machines.
