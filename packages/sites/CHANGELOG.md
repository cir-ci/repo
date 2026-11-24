# @circi/sites

## 0.0.2

### Patch Changes

- [#53](https://github.com/cir-ci/repo/pull/53) [`d7e643c`](https://github.com/cir-ci/repo/commit/d7e643cc99088f127e5b8cb3ea410a89969b56b4) Thanks [@michaelhazan](https://github.com/michaelhazan)! - Each package now typechecks, tests and builds on its own, with its configs from three new config packages: `@circi/typescript-config` (one tsconfig per kind of package), `@circi/vitest-config` (one Vitest config per kind) and `@circi/tsdown-config` (one build config per built package). Turborepo caches every package's typecheck and tests separately, so a change reruns only the packages it touches and the ones that depend on them, and a release's version bumps no longer rerun the whole gate. Nothing in what the packages ship changes: the built output is byte for byte the same.

## 0.0.1

### Patch Changes

- [#38](https://github.com/cir-ci/repo/pull/38) [`6efde8b`](https://github.com/cir-ci/repo/commit/6efde8bb1b3a199fe9d4894439cf36dab21a51e6) Thanks [@michaelhazan](https://github.com/michaelhazan)! - The site kind detection tests each have their own name, so Flakiness.io can track them separately. Nothing changes in how sites are detected.
