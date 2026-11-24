# @circi/perf

## 0.0.2

### Patch Changes

- [#53](https://github.com/cir-ci/repo/pull/53) [`d7e643c`](https://github.com/cir-ci/repo/commit/d7e643cc99088f127e5b8cb3ea410a89969b56b4) Thanks [@michaelhazan](https://github.com/michaelhazan)! - Each package now typechecks, tests and builds on its own, with its configs from three new config packages: `@circi/typescript-config` (one tsconfig per kind of package), `@circi/vitest-config` (one Vitest config per kind) and `@circi/tsdown-config` (one build config per built package). Turborepo caches every package's typecheck and tests separately, so a change reruns only the packages it touches and the ones that depend on them, and a release's version bumps no longer rerun the whole gate. Nothing in what the packages ship changes: the built output is byte for byte the same.

## 0.0.1

### Patch Changes

- [#9](https://github.com/cir-ci/repo/pull/9) [`be2a0ae`](https://github.com/cir-ci/repo/commit/be2a0ae9021649180fcd3ce8b1ac4a7101b944e3) Thanks [@michaelhazan](https://github.com/michaelhazan)! - The perf suite's seed runs the admin commands from the built server bundle, as an operator runs them in the image, instead of from source. The stale "known problem" that the bundle's `admin project create` exits before printing its token is removed from the README: that was fixed on 2026-11-11.
