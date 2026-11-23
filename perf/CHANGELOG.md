# @circi/perf

## 0.0.1

### Patch Changes

- [#9](https://github.com/cir-ci/repo/pull/9) [`be2a0ae`](https://github.com/cir-ci/repo/commit/be2a0ae9021649180fcd3ce8b1ac4a7101b944e3) Thanks [@michaelhazan](https://github.com/michaelhazan)! - The perf suite's seed runs the admin commands from the built server bundle, as an operator runs them in the image, instead of from source. The stale "known problem" that the bundle's `admin project create` exits before printing its token is removed from the README: that was fixed on 2026-11-11.
