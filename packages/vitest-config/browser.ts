import { resolve } from 'node:path'

import { playwright } from '@vitest/browser-playwright'
import type { TestProjectInlineConfiguration } from 'vitest/config'

// Vite pre-bundles the dependencies it finds while a browser project runs, and the first run after
// a new dependency can fail with import errors until it is rerun. Listing them up front makes that
// run optimize them before the first test: add a package here when a browser test starts importing
// one (a run's list is in node_modules/.vite/vitest/*/deps/_metadata.json). Ids resolve from
// the project's root; `a > b` resolves b from where a is installed.
export const reactDeps = [
  'react',
  'react/jsx-dev-runtime',
  'react/jsx-runtime',
  'vitest-browser-react',
]
export const baseUiDeps = [
  'alert-dialog',
  'autocomplete',
  'avatar',
  'button',
  'checkbox',
  'checkbox-group',
  'collapsible',
  'combobox',
  'context-menu',
  'dialog',
  'drawer',
  'field',
  'fieldset',
  'input',
  'menu',
  'number-field',
  'popover',
  'radio',
  'radio-group',
  'scroll-area',
  'select',
  'slider',
  'switch',
  'tabs',
  'toast',
  'toggle',
  'toggle-group',
  'tooltip',
].map((part) => `@base-ui/react/${part}`)
// The project icons load from `lucide-react/dynamic.mjs` on demand: listed so a first run doesn't
// discover it mid-test and reload the page.
export const iconDeps = ['boring-avatars', 'lucide-react', 'lucide-react/dynamic.mjs']
// Base UI and lucide are installed under @circi/ui; projects rooted elsewhere go through it.
export const viaUi = (ids: string[]): string[] => ids.map((id) => `@circi/ui > ${id}`)

/**
 * Headless Chromium at a desktop size unless a test says otherwise (the phone layout starts below
 * 820px). Component tests run with `prefers-reduced-motion: reduce`, which every motion rule in
 * the design system and the dashboard honors: no test waits out a transition. A test of the motion
 * itself switches it off for its own page with `emulateMotion()` (packages/ui/test/support).
 */
export function chromium(env?: Record<string, string>, reducedMotion = false) {
  return {
    enabled: true,
    headless: true,
    provider: playwright({
      ...(env ? { launchOptions: { env } } : {}),
      ...(reducedMotion ? { contextOptions: { reducedMotion: 'reduce' as const } } : {}),
    }),
    viewport: { width: 1000, height: 700 },
    instances: [{ browser: 'chromium' as const }],
  }
}

/**
 * A package's component tests (`test/**\/*.browser.test.tsx`) in real headless Chromium (Vitest
 * browser mode): real portals, focus, pointer events and the real compiled CSS modules. Rooted at
 * the package, so `optimizeDeps.include` resolves from where its dependencies are installed.
 */
export function components(
  name: string,
  root: string,
  deps: string[],
  setupFiles: string[] = [],
): TestProjectInlineConfiguration {
  return {
    extends: true,
    root: resolve(root),
    oxc: { jsx: { runtime: 'automatic' } },
    optimizeDeps: { include: deps },
    test: {
      name,
      setupFiles,
      include: ['test/**/*.browser.test.tsx'],
      // One retry: under a full gate the browser runner itself sometimes loses a test's frame
      // ("Frame was detached", "Cannot find vitest-iframe"), a different test each time and never
      // an assertion. A retried test is still listed in the report, so a real flake stays visible.
      retry: 1,
      browser: chromium(undefined, true),
    },
  }
}
