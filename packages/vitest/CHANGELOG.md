# @circi/vitest

## 0.4.0

### Minor Changes

- [#35](https://github.com/cir-ci/repo/pull/35) [`ab6be07`](https://github.com/cir-ci/repo/commit/ab6be076a8559f5167443de59bd7d3df5140e28b) Thanks [@michaelhazan](https://github.com/michaelhazan)! - New `site` option on `circi()`: `site: true` also hosts Vitest's HTML report as a site named `vitest-report` (kind `vitest-report`), so reviewers can open the run's results next to the screenshots. The plugin adds Vitest's `html` reporter when `@vitest/ui` is installed, waits for it to finish writing, and uploads the report after the screenshots, from the first shard only. `site: { name, dir }` renames the site or hosts a folder of your own. Off by default.

- [#35](https://github.com/cir-ci/repo/pull/35) [`ab6be07`](https://github.com/cir-ci/repo/commit/ab6be076a8559f5167443de59bd7d3df5140e28b) Thanks [@michaelhazan](https://github.com/michaelhazan)! - Screenshots are now written to `.circi/screenshots/vitest/<test file>/<name>.png` instead of `.circi/screenshots/<test file>/<name>.png`, so other tools can use their own folders next to it. The `dir` option is still the parent (default `.circi/screenshots`), and screenshot names in CirCI don't change. If you read the files yourself (a CI artifact path, say), point them at the `vitest` subfolder. A shard that has no screenshots still reports in, so a parallel build is no longer left waiting for it.

### Patch Changes

- [#30](https://github.com/cir-ci/repo/pull/30) [`2926511`](https://github.com/cir-ci/repo/commit/292651149f71b6deb4efd21a0e96aa9542cefebf) Thanks [@michaelhazan](https://github.com/michaelhazan)! - The npm descriptions and keywords say what the packages are for: uploading screenshots to CirCI, the self-hosted visual regression testing server. `@circi/vitest`'s no longer mentions the screenshot helper removed in 0.3.0.

- [#34](https://github.com/cir-ci/repo/pull/34) [`3d7a9f9`](https://github.com/cir-ci/repo/commit/3d7a9f96ca6e11e1f251d77a3a3ab57a71b9b7a2) Thanks [@michaelhazan](https://github.com/michaelhazan)! - Server-side test cleanup, with nothing to change in how the app or the packages behave: shared helpers for seeded builds and members, the mail fake, sign-in by email code, PNG builders, temp directories, the auth secret and fake timers; duplicated and wrapper-only tests removed (each assertion still has a test that covers it); fixed waits in the live-stream tests replaced by ordered marker events; one database per file in the triage tests; the CLI's slow spawned test kept only where the exit code matters. `@circi/vitest`'s slow plugin test (a real nested Vitest run in Chromium) now runs as its own `pnpm test:vitest` task, part of `pnpm gate`, instead of on the Node tests' critical path.

- [#35](https://github.com/cir-ci/repo/pull/35) [`ab6be07`](https://github.com/cir-ci/repo/commit/ab6be076a8559f5167443de59bd7d3df5140e28b) Thanks [@michaelhazan](https://github.com/michaelhazan)! - Internal: the reporter's upload step, screenshot naming and shard parsing now come from `@circi/cli`, shared with `@circi/storybook`. Options, names, defaults, exit codes and exports (including `Shard`, `shardFromArgs`, `DEFAULT_DIR`, `STABILIZE_CSS`) are unchanged.

## 0.3.0

### Minor Changes

- [#3](https://github.com/cir-ci/repo/pull/3) [`41d98f7`](https://github.com/cir-ci/repo/commit/41d98f77bb7b724157373ad8e2fa6ef4d3733049) Thanks [@michaelhazan](https://github.com/michaelhazan)! - Removed: `circiScreenshot` and `screenshotPath`, deprecated in 0.2.0. Use Vitest's `await expect(locator).toMatchScreenshot('name')` with the `circi()` plugin; see the migration section of the Vitest docs. `@circi/vitest/browser` still exports `settlePage`, `STABILIZE_CSS` and `DEFAULT_DIR`.

### Patch Changes

- [#3](https://github.com/cir-ci/repo/pull/3) [`41d98f7`](https://github.com/cir-ci/repo/commit/41d98f77bb7b724157373ad8e2fa6ef4d3733049) Thanks [@michaelhazan](https://github.com/michaelhazan)! - New exports: `parseShard` (reads `2/4` as the second of four jobs) and `errorLine` (the CLI's one-line text for an error). `upload` now asks the server for the project while it reads git, and `site upload` packs the site while it looks up the branch, so both start sending sooner. `--api-url` now names CIRCI_API_URL in `--help`, where it is read from when the flag is left out.
  
  `@circi/vitest`: the reporter uploads the screenshot folder as it is, instead of copying every screenshot to a temporary folder that was never deleted. A failed upload is reported with the CLI's error text, including its hints for the address and the token.

- [#3](https://github.com/cir-ci/repo/pull/3) [`41d98f7`](https://github.com/cir-ci/repo/commit/41d98f77bb7b724157373ad8e2fa6ef4d3733049) Thanks [@michaelhazan](https://github.com/michaelhazan)! - Updated dependencies: commander 15.1.0 and tar 7.5.23.

## 0.2.0

### Minor Changes

- [`591d2e8`](https://github.com/cir-ci/repo/commit/591d2e817fd336fcacea72c1b3404bfe75dd3e15) Thanks [@michaelhazan](https://github.com/michaelhazan)! - New `circi()` Vitest plugin: tests keep Vitest's own `await expect(locator).toMatchScreenshot('name')` with no CirCI import. Add the plugin to `plugins` in `vitest.config.ts` and it registers the reporter and writes each screenshot to `.circi/screenshots/<test file>/<name>.png` for upload. The `local` option (default `false`) chooses who gates: `false` never compares or stores references on the machine running the tests, so a test never fails on pixels and CirCI is the gate; `true` also runs Vitest's normal comparison. The reporter's `clean` option empties the folder when the run starts, which the plugin turns on.
  
  Deprecated: `circiScreenshot` (a warning prints the first time it's called, and it's removed in the next minor release). See the migration section of the Vitest docs.
  
  Removed: the reporter's `collectToMatchScreenshot` option and the `collectToMatchScreenshot` export. `local: true` covers it.

## 0.1.0

### Minor Changes

- [`be08f90`](https://github.com/cir-ci/repo/commit/be08f909b84ec8bac7c0fdac6fc0b729b62bc910) Thanks [@michaelhazan](https://github.com/michaelhazan)! - First public release.
