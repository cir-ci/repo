import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'

/**
 * Vitest's own `html` reporter (from `@vitest/ui`), found among a run's reporters so its report
 * can be hosted. Vitest hands `onTestRunEnd` to every reporter at once (`Promise.all`), so this
 * reporter's upload would race the HTML report's writing: `watchHtmlReporter` wraps the HTML
 * reporter's `onTestRunEnd` to remember its promise, and `finished()` waits for it.
 */
export interface HtmlReport {
  /** Where the report is written: `<root>/<outputDir>`, `.vitest` unless the reporter says otherwise. */
  dir: string
  /** Resolves once the HTML reporter has written the whole report. */
  finished: () => Promise<void>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** The HTML reporter among `reporters` (Vitest's `vitest.reporters`), with its end of run watched. */
export function watchHtmlReporter(
  root: string,
  reporters: readonly unknown[] | undefined,
): HtmlReport | undefined {
  for (const reporter of reporters ?? []) {
    if (!isRecord(reporter) || reporter.constructor.name !== 'HTMLReporter') continue
    const original: unknown = Reflect.get(reporter, 'onTestRunEnd')
    if (typeof original !== 'function') return undefined
    const options = Reflect.get(reporter, 'options')
    const outputDir = isRecord(options) ? options.outputDir : undefined
    let pending: Promise<unknown> | undefined
    Reflect.set(reporter, 'onTestRunEnd', (...args: unknown[]) => {
      pending = Promise.resolve(Reflect.apply(original, reporter, args))
      return pending
    })
    return {
      dir: resolve(root, typeof outputDir === 'string' ? outputDir : '.vitest'),
      // A turn first: every reporter's `onTestRunEnd` is called before any of them is awaited.
      finished: async () => {
        await Promise.resolve()
        await pending
      },
    }
  }
  return undefined
}

/** Whether a `test.reporters` entry from a config is the HTML reporter (`'html'`, `['html', {…}]` or an instance). */
export function isHtmlReporterEntry(entry: unknown): boolean {
  if (entry === 'html') return true
  if (Array.isArray(entry)) return entry[0] === 'html'
  return isRecord(entry) && entry.constructor.name === 'HTMLReporter'
}

/** Whether `@vitest/ui`, which the HTML reporter loads, can be found from `root`. */
export function htmlReporterAvailable(root: string): boolean {
  try {
    createRequire(join(root, 'noop.js')).resolve('@vitest/ui/reporter')
    return true
  } catch {
    return false
  }
}
