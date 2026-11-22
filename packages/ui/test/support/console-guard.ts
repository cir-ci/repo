import { afterEach, beforeEach, vi } from 'vitest'

/**
 * What a test may print through `console.error` (React's warnings, a failed render, an act()
 * complaint) or reject without handling, as a list of patterns. Short on purpose: a test that
 * expects an error says so itself with `expectConsoleError(pattern)`. Add a pattern here only
 * for noise from outside the code (a browser, a library) that no test can fix.
 */
const ALLOWED: RegExp[] = [
  // Chromium reports it when a ResizeObserver callback's layout change lands in the same frame; the
  // observers in Base UI and the dashboard are right, and nothing in a test can prevent the report.
  /ResizeObserver loop/,
]

let seen: string[] = []
let expected: RegExp[] = []
let spy: { mockRestore(): void } | undefined

const text = (args: unknown[]) =>
  args.map((arg) => (arg instanceof Error ? (arg.stack ?? arg.message) : String(arg))).join(' ')

const onRejection = (event: PromiseRejectionEvent) => {
  event.preventDefault()
  seen.push(`Unhandled rejection: ${text([event.reason])}`)
}

/** This test expects `console.error` to be called with something matching `pattern`. */
export function expectConsoleError(pattern: RegExp): void {
  expected.push(pattern)
}

/** Fails a test that printed an unexpected error or left a promise rejected with nobody to hear it. */
export function guardConsole(): void {
  beforeEach(() => {
    seen = []
    expected = []
    spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      seen.push(text(args))
    })
    window.addEventListener('unhandledrejection', onRejection)
  })

  afterEach(() => {
    window.removeEventListener('unhandledrejection', onRejection)
    spy?.mockRestore()
    const unexpected = seen.filter(
      (line) => ![...ALLOWED, ...expected].some((pattern) => pattern.test(line)),
    )
    const unmet = expected.filter((pattern) => !seen.some((line) => pattern.test(line)))
    if (unexpected.length > 0) {
      throw new Error(`Unexpected console.error or unhandled rejection:\n${unexpected.join('\n')}`)
    }
    if (unmet.length > 0) {
      throw new Error(`Expected console.error matching ${unmet.join(', ')}, none was printed`)
    }
  })
}
