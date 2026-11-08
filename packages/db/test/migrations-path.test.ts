import { resolve } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

async function load(): Promise<string> {
  vi.resetModules()
  return (await import('../src/client.ts')).migrationsFolder
}

describe('migrationsFolder', () => {
  it('points at packages/db/migrations, wherever this package sits', async () => {
    vi.stubEnv('CIRCI_MIGRATIONS', '')
    delete process.env.CIRCI_MIGRATIONS
    expect(await load()).toBe(resolve(import.meta.dirname, '../migrations'))
  })

  it('can be overridden with CIRCI_MIGRATIONS (the server bundle ships its own copy)', async () => {
    vi.stubEnv('CIRCI_MIGRATIONS', '/app/migrations')
    expect(await load()).toBe('/app/migrations')
  })
})
