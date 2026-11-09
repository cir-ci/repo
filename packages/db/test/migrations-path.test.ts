import { resolve } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

async function load(): Promise<string> {
  vi.resetModules()
  return (await import('#src/client.ts')).migrationsFolder
}

describe('migrationsFolder', () => {
  it('points at packages/db/migrations, wherever this package sits', async () => {
    expect(await load()).toBe(resolve(import.meta.dirname, '../migrations'))
  })
})
