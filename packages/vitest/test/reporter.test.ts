import type { UploadOptions } from '@circi/cli'
import { describe, expect, it } from 'vitest'

import { CirciReporter } from '../src/reporter.ts'
import { useTempRoot } from './support/temp-root.ts'

const tmp = useTempRoot()
const { touch } = tmp

describe('CirciReporter', () => {
  const result = { exitCode: 0 } as const
  const quiet = { log: () => {} }

  it('uploads what it finds as one build named for the run, with its shard', async () => {
    await touch('.circi/screenshots/a.png')
    const seen: UploadOptions[] = []
    const reporter = new CirciReporter({
      apiUrl: 'https://ci.acme.io',
      token: 'circi_x',
      name: 'vitest-chromium',
      root: tmp.root(),
      shard: { index: 1, total: 3 },
      uploadImpl: async (o) => {
        seen.push(o)
        return result
      },
      ...quiet,
    })
    await reporter.onTestRunEnd([], [], 'passed')
    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({
      apiUrl: 'https://ci.acme.io',
      token: 'circi_x',
      name: 'vitest-chromium',
      shard: { index: 1, total: 3 },
      wait: false,
    })
  })

  it('does nothing without credentials or without pictures, and never breaks the test run', async () => {
    let called = 0
    const upload = async () => {
      called += 1
      return result
    }
    delete process.env.CIRCI_TOKEN
    await new CirciReporter({
      apiUrl: 'https://x',
      root: tmp.root(),
      uploadImpl: upload,
      ...quiet,
    }).onTestRunEnd([], [], 'passed')
    await new CirciReporter({
      apiUrl: 'https://x',
      token: 't',
      root: tmp.root(),
      collectImpl: async () => [],
      uploadImpl: upload,
      ...quiet,
    }).onTestRunEnd([], [], 'passed')
    expect(called).toBe(0)

    const lines: string[] = []
    const failing = new CirciReporter({
      apiUrl: 'https://x',
      token: 't',
      root: tmp.root(),
      uploadImpl: async () => {
        throw new Error('server down')
      },
      log: (l) => void lines.push(l),
    })
    const before = process.exitCode
    await failing.onTestRunEnd([], [], 'passed')
    expect(lines.join('\n')).toContain('server down')
    expect(process.exitCode).toBe(before)
  })
})
