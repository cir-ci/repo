import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { runCli } from '#cli/index.ts'
import { debugOn, describeFailure, UsageError } from '#cli/lib/usage.ts'

// The commands open a runtime first; a bad flag is refused before it is used, so a stub is enough.
vi.mock('#composition/runtime.ts', () => ({
  createRuntime: () => ({ close: async () => {}, config: {} }),
}))

describe('the admin CLI reports failures on one line', () => {
  let printed: string[]
  beforeEach(() => {
    printed = []
    vi.spyOn(console, 'error').mockImplementation(
      (text: unknown) => void printed.push(String(text)),
    )
    process.exitCode = undefined
  })
  afterEach(() => {
    vi.restoreAllMocks()
    process.exitCode = undefined
  })

  it('prints the usage line for a bad flag, with no stack', async () => {
    await runCli([
      'node',
      'circi',
      'admin',
      'github',
      'link',
      '--org',
      'acme',
      '--project',
      'web',
      '--repo',
      'nonsense',
      '--installation',
      '1',
    ])
    const text = printed.join('\n')
    expect(text).toContain('error: --repo must look like owner/name')
    expect(text).toContain('Usage: circi admin github link [options]')
    expect(text).not.toMatch(/\n\s+at /)
    expect(process.exitCode).toBe(1)
  })

  it('keeps a stack only with --debug', async () => {
    const argv = [
      'node',
      'circi',
      'admin',
      'github',
      'link',
      '--org',
      'acme',
      '--project',
      'web',
      '--repo',
      'nonsense',
      '--installation',
      '1',
    ]
    await runCli([...argv, '--debug'])
    expect(printed.join('\n')).toMatch(/\n\s+at /)
  })
})

describe('describeFailure', () => {
  it('says how to get the stack for an unexpected error', () => {
    const text = describeFailure(new Error('boom\nsecond line'), { expected: false, debug: false })
    expect(text).toBe('error: boom\n(Run again with --debug, or set DEBUG=1, for the stack trace.)')
  })

  it('prints expected errors as just their message', () => {
    expect(describeFailure(new Error('No such project'), { expected: true, debug: false })).toBe(
      'error: No such project',
    )
  })

  it('adds the usage for a UsageError', () => {
    const root = { name: () => 'circi', usage: () => '[options]', parent: null }
    const sub = { name: () => 'webhook', usage: () => '[options] <cmd>', parent: root }
    const text = describeFailure(new UsageError('--events: choose at least one event'), {
      expected: false,
      debug: false,
      command: sub,
    })
    expect(text).toContain('error: --events: choose at least one event')
    expect(text).toContain('Usage: circi webhook [options] <cmd>')
  })
})

describe('debugOn', () => {
  it('is the --debug flag or a DEBUG that is not off', () => {
    expect(debugOn(['x', '--debug'], {})).toBe(true)
    expect(debugOn([], { DEBUG: '1' })).toBe(true)
    expect(debugOn([], { DEBUG: '0' })).toBe(false)
    expect(debugOn([], {})).toBe(false)
  })
})
