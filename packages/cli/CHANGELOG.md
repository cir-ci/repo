# @circi/cli

## 0.3.2

### Patch Changes

- [#53](https://github.com/cir-ci/repo/pull/53) [`d7e643c`](https://github.com/cir-ci/repo/commit/d7e643cc99088f127e5b8cb3ea410a89969b56b4) Thanks [@michaelhazan](https://github.com/michaelhazan)! - Each package now typechecks, tests and builds on its own, with its configs from three new config packages: `@circi/typescript-config` (one tsconfig per kind of package), `@circi/vitest-config` (one Vitest config per kind) and `@circi/tsdown-config` (one build config per built package). Turborepo caches every package's typecheck and tests separately, so a change reruns only the packages it touches and the ones that depend on them, and a release's version bumps no longer rerun the whole gate. Nothing in what the packages ship changes: the built output is byte for byte the same.

## 0.3.1

### Patch Changes

- [#50](https://github.com/cir-ci/repo/pull/50) [`5629c5e`](https://github.com/cir-ci/repo/commit/5629c5efb7e0f69d56fecca8cf02db82a9fcd98a) Thanks [@michaelhazan](https://github.com/michaelhazan)! - The CLI and the Vitest, Cypress and Storybook plugins are now under the MIT License instead of GPL-3.0-only, so they can be added to any project's dependencies without a license review. The CirCI server stays GPL-3.0-only.
  
  `@circi/cypress` now depends on `tar` instead of bundling a copy of it, like the other packages, so `tar`'s own license (Blue Oak Model License 1.0.0) comes with it and the package is smaller.

## 0.3.0

### Minor Changes

- [#44](https://github.com/cir-ci/repo/pull/44) [`365fbaa`](https://github.com/cir-ci/repo/commit/365fbaa8e5857dc73cc2723504c0627377f7aa07) Thanks [@michaelhazan](https://github.com/michaelhazan)! - Removed `circi argos-env`: the Argos SDKs never accepted CirCI tokens, so use `circi upload`, the Vitest plugin or the Cypress plugin instead.

## 0.2.1

### Patch Changes

- [#35](https://github.com/cir-ci/repo/pull/35) [`ab6be07`](https://github.com/cir-ci/repo/commit/ab6be076a8559f5167443de59bd7d3df5140e28b) Thanks [@michaelhazan](https://github.com/michaelhazan)! - For tools built on the CLI (`@circi/vitest`, `@circi/storybook`): adds `CirciOptions.Common` (the options they share), `uploadCaptures` (upload a folder of captures when a run ends: credentials from the options or the environment, a notice and no upload without them, a failed upload reported rather than thrown), `writeCapture`, `mapLimit`, `shardFlag`, `shardFromArgs`, `shardFromEnv` (`CIRCI_SHARD`), `ignoreBrokenPipe`, `debugOn` and `reportError`, and a browser-safe `@circi/cli/names` (screenshot naming, `DEFAULT_DIR`, `STABILIZE_CSS`). The `circi` command is unchanged.

- [#35](https://github.com/cir-ci/repo/pull/35) [`ab6be07`](https://github.com/cir-ci/repo/commit/ab6be076a8559f5167443de59bd7d3df5140e28b) Thanks [@michaelhazan](https://github.com/michaelhazan)! - Adds `toolDir(dir, tool)` to `@circi/cli/names`: each tool that writes captures owns `<dir>/<tool>` (`.circi/screenshots/vitest`, `.circi/screenshots/storybook`), so tools sharing a project never upload or clean each other's files. A shard with no screenshots (more shards than tests, or every test skipped) now still reports in, so the parallel build completes instead of waiting for it.

- [#35](https://github.com/cir-ci/repo/pull/35) [`ab6be07`](https://github.com/cir-ci/repo/commit/ab6be076a8559f5167443de59bd7d3df5140e28b) Thanks [@michaelhazan](https://github.com/michaelhazan)! - Adds `uploadSiteAfter`, which tools built on the CLI use to host a built site (Storybook, Vitest's HTML report) after their screenshots: only when the screenshots were uploaded, with an address and a token, from the first shard, and a failed upload is logged and fails the run only with `strict`.

- [#30](https://github.com/cir-ci/repo/pull/30) [`2926511`](https://github.com/cir-ci/repo/commit/292651149f71b6deb4efd21a0e96aa9542cefebf) Thanks [@michaelhazan](https://github.com/michaelhazan)! - The npm descriptions and keywords say what the packages are for: uploading screenshots to CirCI, the self-hosted visual regression testing server. `@circi/vitest`'s no longer mentions the screenshot helper removed in 0.3.0.

- [#34](https://github.com/cir-ci/repo/pull/34) [`3d7a9f9`](https://github.com/cir-ci/repo/commit/3d7a9f96ca6e11e1f251d77a3a3ab57a71b9b7a2) Thanks [@michaelhazan](https://github.com/michaelhazan)! - Server-side test cleanup, with nothing to change in how the app or the packages behave: shared helpers for seeded builds and members, the mail fake, sign-in by email code, PNG builders, temp directories, the auth secret and fake timers; duplicated and wrapper-only tests removed (each assertion still has a test that covers it); fixed waits in the live-stream tests replaced by ordered marker events; one database per file in the triage tests; the CLI's slow spawned test kept only where the exit code matters. `@circi/vitest`'s slow plugin test (a real nested Vitest run in Chromium) now runs as its own `pnpm test:vitest` task, part of `pnpm gate`, instead of on the Node tests' critical path.

## 0.2.0

### Minor Changes

- [#3](https://github.com/cir-ci/repo/pull/3) [`41d98f7`](https://github.com/cir-ci/repo/commit/41d98f77bb7b724157373ad8e2fa6ef4d3733049) Thanks [@michaelhazan](https://github.com/michaelhazan)! - New exports: `parseShard` (reads `2/4` as the second of four jobs) and `errorLine` (the CLI's one-line text for an error). `upload` now asks the server for the project while it reads git, and `site upload` packs the site while it looks up the branch, so both start sending sooner. `--api-url` now names CIRCI_API_URL in `--help`, where it is read from when the flag is left out.
  
  `@circi/vitest`: the reporter uploads the screenshot folder as it is, instead of copying every screenshot to a temporary folder that was never deleted. A failed upload is reported with the CLI's error text, including its hints for the address and the token.

### Patch Changes

- [#3](https://github.com/cir-ci/repo/pull/3) [`41d98f7`](https://github.com/cir-ci/repo/commit/41d98f77bb7b724157373ad8e2fa6ef4d3733049) Thanks [@michaelhazan](https://github.com/michaelhazan)! - Updated dependencies: commander 15.1.0 and tar 7.5.23.

## 0.1.0

### Minor Changes

- [`be08f90`](https://github.com/cir-ci/repo/commit/be08f909b84ec8bac7c0fdac6fc0b729b62bc910) Thanks [@michaelhazan](https://github.com/michaelhazan)! - First public release.
