# @circi/cli

## 0.2.0

### Minor Changes

- [#3](https://github.com/cir-ci/repo/pull/3) [`41d98f7`](https://github.com/cir-ci/repo/commit/41d98f77bb7b724157373ad8e2fa6ef4d3733049) Thanks [@michaelhazan](https://github.com/michaelhazan)! - New exports: `parseShard` (reads `2/4` as the second of four jobs) and `errorLine` (the CLI's one-line text for an error). `upload` now asks the server for the project while it reads git, and `site upload` packs the site while it looks up the branch, so both start sending sooner. `--api-url` now names CIRCI_API_URL in `--help`, where it is read from when the flag is left out.
  
  `@circi/vitest`: the reporter uploads the screenshot folder as it is, instead of copying every screenshot to a temporary folder that was never deleted. A failed upload is reported with the CLI's error text, including its hints for the address and the token.

### Patch Changes

- [#3](https://github.com/cir-ci/repo/pull/3) [`41d98f7`](https://github.com/cir-ci/repo/commit/41d98f77bb7b724157373ad8e2fa6ef4d3733049) Thanks [@michaelhazan](https://github.com/michaelhazan)! - Updated dependencies: commander 15.1.0 and tar 7.5.23.

## 0.1.0

### Minor Changes

- [`be08f90`](https://github.com/cir-ci/repo/commit/be08f909b84ec8bac7c0fdac6fc0b729b62bc910) Thanks [@michaelhazan](https://github.com/michaelhazan)! - First public release.
