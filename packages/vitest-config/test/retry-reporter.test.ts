import { describe, expect, it } from 'vitest'

import { describeRetried, type ModuleLike, retriedTests } from '../retry-reporter.ts'

const test = (fullName: string, retryCount: number, state = 'passed') => ({
  fullName,
  diagnostic: () => ({ retryCount }),
  result: () => ({ state }),
})

const module = (moduleId: string, tests: ReturnType<typeof test>[]): ModuleLike => ({
  moduleId,
  project: { name: 'web-browser' },
  children: { allTests: () => tests },
})

describe('the retry reporter', () => {
  const root = new URL('../../..', import.meta.url).pathname

  it('lists the tests that needed a retry, by file and name, and none that passed first time', () => {
    const retried = retriedTests([
      module(`${root}apps/web/test/b.browser.test.tsx`, [test('b slow', 1), test('b fine', 0)]),
      module(`${root}apps/web/test/a.browser.test.tsx`, [test('a lost frame', 1, 'failed')]),
    ])
    expect(retried.map((t) => [t.file, t.name, t.passed])).toEqual([
      ['apps/web/test/a.browser.test.tsx', 'a lost frame', false],
      ['apps/web/test/b.browser.test.tsx', 'b slow', true],
    ])
  })

  it('says so when none did, and counts them otherwise', () => {
    expect(describeRetried([])).toBe('No test needed its retry.')
    const text = describeRetried(
      retriedTests([module(`${root}apps/web/test/a.browser.test.tsx`, [test('a', 1)])]),
    )
    expect(text).toContain('1 test needed its retry')
    expect(text).toContain('[web-browser] apps/web/test/a.browser.test.tsx > a (1 retry, passed)')
  })
})
