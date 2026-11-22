# @circi/vitest

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
