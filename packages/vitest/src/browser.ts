/**
 * What a test file imports (`@circi/vitest/browser`): the screenshot helper and nothing that
 * needs Node. The package's main entry also holds the reporter, which reads files and talks to
 * CirCI; a browser bundle cannot load that, so tests running in Vitest browser mode import from here.
 */
export {
  circiScreenshot,
  DEFAULT_DIR,
  type ScreenshotOptions,
  type Screenshotter,
  screenshotPath,
  settlePage,
  STABILIZE_CSS,
} from './screenshot.ts'
