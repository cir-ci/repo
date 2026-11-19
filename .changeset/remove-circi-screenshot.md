---
'@circi/vitest': minor
---

Removed: `circiScreenshot` and `screenshotPath`, deprecated in 0.2.0. Use Vitest's `await expect(locator).toMatchScreenshot('name')` with the `circi()` plugin; see the migration section of the Vitest docs. `@circi/vitest/browser` still exports `settlePage`, `STABILIZE_CSS` and `DEFAULT_DIR`.
