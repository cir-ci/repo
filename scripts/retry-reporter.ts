import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'

import type { Reporter, TestModule } from 'vitest/node'

/**
 * The tests that passed only on a retry. The browser projects retry a test once (a lost frame in
 * the runner, a slow machine), which keeps a run green; this lists every such test at the end of
 * the run and writes the list to `.vitest/retried-tests.txt`, so CI shows flakiness instead of
 * hiding it. It never fails the run: a test that fails both times already does.
 */
export interface Retried {
  project: string
  file: string
  name: string
  retries: number
  /** Whether the last attempt passed. */
  passed: boolean
}

const root = resolve(import.meta.dirname, '..')
export const RETRIED_FILE = resolve(root, '.vitest/retried-tests.txt')

/** The part of Vitest's `TestModule` this reads (so a test can pass plain objects). */
export interface ModuleLike {
  moduleId: string
  project: { name: string }
  children: {
    allTests(): Iterable<{
      fullName: string
      diagnostic(): { retryCount: number } | undefined
      result(): { state: string }
    }>
  }
}

/** The tests of the run that needed a retry. */
export function retriedTests(modules: readonly ModuleLike[]): Retried[] {
  const found: Retried[] = []
  for (const module of modules) {
    for (const test of module.children.allTests()) {
      const retries = test.diagnostic()?.retryCount ?? 0
      if (retries === 0) continue
      found.push({
        project: module.project.name,
        file: relative(root, module.moduleId),
        name: test.fullName,
        retries,
        passed: test.result().state === 'passed',
      })
    }
  }
  return found.toSorted((a, b) => `${a.file} ${a.name}`.localeCompare(`${b.file} ${b.name}`))
}

export function describeRetried(retried: readonly Retried[]): string {
  if (retried.length === 0) return 'No test needed its retry.'
  const lines = retried.map(
    (t) =>
      `  [${t.project}] ${t.file} > ${t.name} (${t.retries} ${t.retries === 1 ? 'retry' : 'retries'}, ${t.passed ? 'passed' : 'failed'})`,
  )
  return `${retried.length} ${retried.length === 1 ? 'test needed its retry' : 'tests needed their retry'}:\n${lines.join('\n')}`
}

export default class RetryReporter implements Reporter {
  onTestRunEnd(modules: ReadonlyArray<TestModule>): void {
    const retried = retriedTests(modules)
    const text = describeRetried(retried)
    mkdirSync(dirname(RETRIED_FILE), { recursive: true })
    writeFileSync(RETRIED_FILE, `${text}\n`)
    if (retried.length > 0) console.log(`\n${text}\n(also in ${relative(root, RETRIED_FILE)})`)
  }
}
