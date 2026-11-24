import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

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
/**
 * A hash of a folder's files, for a pre-bundled workspace package (`sourceKeyed`). Vite keys its
 * pre-bundle cache on the lockfile and the config, not on a linked package's source: without this,
 * a change to that source would leave the tests running the old bundle.
 */
function folderHash(dir: string): string {
  const hash = createHash('sha256')
  const walk = (d: string) => {
    for (const entry of readdirSync(d, { withFileTypes: true }).toSorted((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const path = join(d, entry.name)
      if (entry.isDirectory()) walk(path)
      else hash.update(path).update(readFileSync(path))
    }
  }
  walk(dir)
  return hash.digest('hex').slice(0, 16)
}

/**
 * `project` with workspace packages pre-bundled like an installed dependency: one module instead of
 * one per source file. Each test file's page loads them again (a fresh iframe per file), so for
 * @circi/ui in the dashboard's tests that is about a hundred fewer modules per file, and less
 * memory and time in the browser. `sources` are the packages' source folders: their hash is part of
 * Vite's cache key (through a define nothing reads), so a change there re-bundles on the next run.
 * A running watch session keeps the bundle it started with.
 */
export function sourceKeyed(
  project: TestProjectInlineConfiguration,
  ids: string[],
  sources: string[],
): TestProjectInlineConfiguration {
  const key = sources.map(folderHash).join('-')
  return {
    ...project,
    optimizeDeps: {
      ...project.optimizeDeps,
      include: [...ids, ...(project.optimizeDeps?.include ?? [])],
      rolldownOptions: {
        transform: { define: { __CIRCI_PREBUNDLED_SOURCE__: JSON.stringify(key) } },
      },
    },
  }
}

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
