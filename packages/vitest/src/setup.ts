import { capturePath } from '@circi/cli/names'
/**
 * The browser setup file the `circi()` plugin adds to a project's `setupFiles`. It replaces
 * `toMatchScreenshot` so that every call writes a stabilized capture to
 * `<dir>/<test file>/<name>.png`, where the reporter finds it, and then, only with `local: true`,
 * hands over to Vitest's own matcher for the local comparison.
 *
 * Why the matcher and not Vitest's screenshot options: Vitest writes a reference and fails the
 * test when none exists, before it asks a comparator anything, so with `local: false` (never a
 * reference) every first run would fail. The options (`resolveScreenshotPath`, `comparators`) can
 * move or loosen a comparison but cannot skip it.
 */
import { chai, expect, inject, type MatcherState } from 'vitest'
import type { page as Page } from 'vitest/browser'

import { type BrowserSettings, PROVIDE_KEY } from './options.ts'
import { settlePage } from './screenshot.ts'

interface Capturable {
  screenshot(options: { path: string; [key: string]: unknown }): Promise<unknown>
}

interface MatcherOptions {
  screenshotOptions?: Record<string, unknown>
}

/** What `page.elementLocator` takes: a DOM element. */
type ElementArg = Parameters<typeof Page.elementLocator>[0]

/** Per test, how many unnamed screenshots it has taken: Vitest names those `<test name> <n>`. */
const unnamed = new WeakMap<object, number>()

function isCapturable(value: unknown): value is Capturable {
  return (
    typeof value === 'object' &&
    value !== null &&
    'screenshot' in value &&
    typeof value.screenshot === 'function'
  )
}

/** A DOM element (the package is built without the DOM library, so checked by its shape). */
function isElement(value: unknown): value is ElementArg {
  return typeof value === 'object' && value !== null && 'nodeType' in value && value.nodeType === 1
}

async function install(settings: BrowserSettings): Promise<void> {
  const { page, server } = await import('vitest/browser')
  const original: unknown = Reflect.get(chai.Assertion.prototype, 'toMatchScreenshot')
  const vitestMatcher = typeof original === 'function' ? original : undefined

  async function matcher(
    this: MatcherState,
    received: unknown,
    nameOrOptions?: string | MatcherOptions,
    maybeOptions?: MatcherOptions,
  ) {
    if (this.isNot) throw new Error('\'toMatchScreenshot\' cannot be used with "not"')
    if (!this.task || this.currentTestName === undefined || !this.testPath) {
      throw new Error("'toMatchScreenshot' cannot be used without test context")
    }
    const options = (typeof nameOrOptions === 'object' ? nameOrOptions : maybeOptions) ?? {}
    // Vitest numbers the unnamed calls of a test from 1: the same name on every run.
    const count = (unnamed.get(this.task) ?? 0) + 1
    unnamed.set(this.task, count)
    const name =
      typeof nameOrOptions === 'string' ? nameOrOptions : `${this.currentTestName} ${count}`

    const target = isElement(received) ? page.elementLocator(received) : received
    if (!isCapturable(target)) {
      throw new Error('toMatchScreenshot expects a locator, an element or the page')
    }
    const root = server.config.root
    const relative = this.testPath.startsWith(`${root}/`)
      ? this.testPath.slice(root.length + 1)
      : this.testPath
    await settlePage()
    await target.screenshot({
      animations: 'disabled',
      caret: 'hide',
      ...options.screenshotOptions,
      path: `${root}/${capturePath(settings.dir, relative, name)}`,
    })

    if (settings.local) {
      if (!vitestMatcher) {
        throw new Error(
          '@circi/vitest: this Vitest has no toMatchScreenshot to compare with locally; set `local: false` or update Vitest',
        )
      }
      // Vitest's own comparison, failing the test the way it does without the plugin.
      await Reflect.apply(vitestMatcher, expect(received), [nameOrOptions, maybeOptions])
    }
    return { pass: true, message: () => '' }
  }

  expect.extend({ toMatchScreenshot: matcher })
}

const settings = (() => {
  try {
    return inject(PROVIDE_KEY)
  } catch {
    return undefined
  }
})()

// Only a browser project has a page to take pictures of; the plugin may sit in a config that also
// holds Node projects, where this file is a no-op.
if (settings && Reflect.get(globalThis, 'document') !== undefined) await install(settings)
