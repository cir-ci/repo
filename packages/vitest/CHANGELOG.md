# @circi/vitest

## 0.2.0

### Minor Changes

- [`591d2e8`](https://github.com/cir-ci/repo/commit/591d2e817fd336fcacea72c1b3404bfe75dd3e15) Thanks [@michaelhazan](https://github.com/michaelhazan)! - New `circi()` Vitest plugin: tests keep Vitest's own `await expect(locator).toMatchScreenshot('name')` with no CirCI import. Add the plugin to `plugins` in `vitest.config.ts` and it registers the reporter and writes each screenshot to `.circi/screenshots/<test file>/<name>.png` for upload. The `local` option (default `false`) chooses who gates: `false` never compares or stores references on the machine running the tests, so a test never fails on pixels and CirCI is the gate; `true` also runs Vitest's normal comparison. The reporter's `clean` option empties the folder when the run starts, which the plugin turns on.
  
  Deprecated: `circiScreenshot` (a warning prints the first time it's called, and it's removed in the next minor release). See the migration section of the Vitest docs.
  
  Removed: the reporter's `collectToMatchScreenshot` option and the `collectToMatchScreenshot` export. `local: true` covers it.

## 0.1.0

### Minor Changes

- [`be08f90`](https://github.com/cir-ci/repo/commit/be08f909b84ec8bac7c0fdac6fc0b729b62bc910) Thanks [@michaelhazan](https://github.com/michaelhazan)! - First public release.
