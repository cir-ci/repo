import { describe, expect, it } from 'vitest'

import { circi } from '#src/plugin.ts'
import { CirciReporter } from '#src/reporter.ts'

interface Config {
  test?: {
    reporters?: unknown[]
    setupFiles?: string | string[]
    provide?: Record<string, unknown>
  }
}

function applied(plugin: ReturnType<typeof circi>, config: Config = {}): Config {
  plugin.config(config)
  return config
}

describe('circi()', () => {
  it('adds one reporter beside the default one, and the browser setup file', () => {
    const config = applied(circi({ name: 'vitest-chromium' }))
    expect(config.test?.reporters).toHaveLength(2)
    expect(config.test?.reporters?.[0]).toBe('default')
    expect(config.test?.reporters?.[1]).toBeInstanceOf(CirciReporter)
    expect(config.test?.setupFiles).toEqual([expect.stringMatching(/setup\.(ts|mjs)$/)])
  })

  it('keeps the reporters and setup files a config already has', () => {
    const config = applied(circi(), {
      test: { reporters: ['verbose'], setupFiles: './setup.ts' },
    })
    expect(config.test?.reporters?.[0]).toBe('verbose')
    expect(config.test?.reporters).toHaveLength(2)
    expect(config.test?.setupFiles).toEqual([
      './setup.ts',
      expect.stringMatching(/setup\.(ts|mjs)$/),
    ])
  })

  it('registers its reporter once however many projects inherit the plugin', () => {
    const plugin = circi()
    const shared: Config = { test: { reporters: ['default'] } }
    applied(plugin, shared)
    applied(plugin, shared)
    expect(shared.test?.reporters).toHaveLength(2)
  })

  it('does not compare locally unless asked, and tells the browser which', () => {
    const off = applied(circi())
    expect(off.test?.provide?.['circi:screenshots']).toEqual({
      local: false,
      dir: '.circi/screenshots',
    })
    const on = applied(circi({ local: true, dir: 'shots' }))
    expect(on.test?.provide?.['circi:screenshots']).toEqual({ local: true, dir: 'shots' })
  })
})
