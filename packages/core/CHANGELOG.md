# @circi/core

## 0.0.2

### Patch Changes

- [#53](https://github.com/cir-ci/repo/pull/53) [`d7e643c`](https://github.com/cir-ci/repo/commit/d7e643cc99088f127e5b8cb3ea410a89969b56b4) Thanks [@michaelhazan](https://github.com/michaelhazan)! - Each package now typechecks, tests and builds on its own, with its configs from three new config packages: `@circi/typescript-config` (one tsconfig per kind of package), `@circi/vitest-config` (one Vitest config per kind) and `@circi/tsdown-config` (one build config per built package). Turborepo caches every package's typecheck and tests separately, so a change reruns only the packages it touches and the ones that depend on them, and a release's version bumps no longer rerun the whole gate. Nothing in what the packages ship changes: the built output is byte for byte the same.

## 0.0.1

### Patch Changes

- [#40](https://github.com/cir-ci/repo/pull/40) [`a485d66`](https://github.com/cir-ci/repo/commit/a485d6669f5bd06c50305b180aee282952f45d91) Thanks [@michaelhazan](https://github.com/michaelhazan)! - Push notifications no longer stop for everyone now and then. About 1 in 256 of the server's web push keys was read back as invalid, so the server made new keys and dropped every device's subscription, and people had to turn push on again. Keys made before this release keep working.
