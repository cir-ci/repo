import { createTestDb, type TestDb } from '@circi/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { orgSsoPlugin } from '#plugins/org-sso.ts'
import { createAuth } from '#src/index.ts'

// `resolveUser` only runs inside a real identity provider round trip, which is covered by the
// server's org-sso route tests (against a fake IdP); here: the plugin is wired in.
let t: TestDb
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

describe('org single sign-on plugin', () => {
  it('registers the sso plugin', () => {
    expect(orgSsoPlugin().id).toBe('sso')
  })

  it('is part of the auth instance', () => {
    const auth = createAuth({
      db: t.db,
      secret: 'test-secret-that-is-long-enough-1234',
      baseURL: 'http://localhost:3000',
    })
    expect(Object.keys(auth.api)).toContain('registerSSOProvider')
  })
})
