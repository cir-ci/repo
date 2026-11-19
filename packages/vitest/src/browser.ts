/**
 * What a browser-side file may import (`@circi/vitest/browser`): the page-settling step and
 * nothing that needs Node. The package's main entry also holds the reporter, which reads files and
 * talks to CirCI; a browser bundle cannot load that.
 */
export { DEFAULT_DIR, settlePage, STABILIZE_CSS } from './screenshot.ts'
