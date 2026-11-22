import { fileURLToPath } from 'node:url'

import { toolDir } from '@circi/cli/names'

import { type BrowserSettings, PROVIDE_KEY } from './options.ts'
import { CirciReporter } from './reporter.ts'
import { DEFAULT_DIR } from './screenshot.ts'

export namespace circi {
  export interface Options extends CirciReporter.Options {
    /**
     * Also compare locally, as Vitest does without the plugin: references are saved next to the
     * tests and a changed screenshot fails the test. The captures are uploaded either way.
     * Default `false`: nothing is compared or stored locally and a test never fails on pixels;
     * CirCI is the gate.
     */
    local?: boolean
  }
}

/** The pieces of a Vite/Vitest config this plugin reads and edits. */
interface TestConfig {
  test?: {
    reporters?: unknown
    setupFiles?: string | string[]
    provide?: Record<string, unknown>
  }
}

/** Next to this file, whether it runs from `src/*.ts` or from the built `dist/*.mjs`. */
const setupFile = fileURLToPath(
  new URL(import.meta.url.endsWith('.ts') ? './setup.ts' : './setup.mjs', import.meta.url),
)

/**
 * The Vitest plugin: add it to `plugins` in `vitest.config.ts`.
 *
 * Tests keep Vitest's `await expect(locator).toMatchScreenshot('name')`. The plugin writes each
 * capture to `.circi/screenshots/vitest/<test file>/<name>.png` and the reporter it registers uploads
 * them to CirCI when the run ends.
 */
export function circi(options: circi.Options = {}) {
  const { local = false, ...reporterOptions } = options
  const settings: BrowserSettings = { local, dir: toolDir(options.dir ?? DEFAULT_DIR, 'vitest') }
  // One reporter for the plugin, however many projects inherit it.
  const reporter = new CirciReporter({ ...reporterOptions, clean: true })
  return {
    name: 'circi',
    config(config: TestConfig) {
      const test = (config.test ??= {})
      const reporters = test.reporters
      if (Array.isArray(reporters)) {
        if (!reporters.includes(reporter)) reporters.push(reporter)
      } else if (reporters === undefined) {
        test.reporters = ['default', reporter]
      }
      const setup = test.setupFiles
      const files = setup === undefined ? [] : Array.isArray(setup) ? setup : [setup]
      if (!files.includes(setupFile)) test.setupFiles = [...files, setupFile]
      test.provide = { ...test.provide, [PROVIDE_KEY]: settings }
    },
  }
}
