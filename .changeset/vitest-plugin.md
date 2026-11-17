---
'@circi/vitest': minor
---

New `circi()` Vitest plugin: tests keep Vitest's own `await expect(locator).toMatchScreenshot('name')` with no CirCI import. Add the plugin to `plugins` in `vitest.config.ts` and it registers the reporter and writes each screenshot to `.circi/screenshots/<test file>/<name>.png` for upload. The `local` option (default `false`) chooses who gates: `false` never compares or stores references on the machine running the tests, so a test never fails on pixels and CirCI is the gate; `true` also runs Vitest's normal comparison. The reporter's `clean` option empties the folder when the run starts, which the plugin turns on.

Deprecated: `circiScreenshot` (a warning prints the first time it's called, and it's removed in the next minor release). See the migration section of the Vitest docs.

Removed: the reporter's `collectToMatchScreenshot` option and the `collectToMatchScreenshot` export. `local: true` covers it.
