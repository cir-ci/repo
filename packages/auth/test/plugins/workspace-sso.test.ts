import { createTestDb } from '@circi/db/testing'
import { TEST_AUTH_SECRET } from '@circi/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { workspaceSsoPlugin } from '#plugins/workspace-sso.ts'
import { createAuth } from '#src/index.ts'

// `resolveUser` only runs inside a real identity provider round trip, which is covered by the
// server's workspace-sso route tests (against a fake IdP); here: the plugin is wired in.
let t: createTestDb.Result
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

describe('workspace single sign-on plugin', () => {
  it('registers the sso plugin', () => {
    expect(workspaceSsoPlugin().id).toBe('sso')
  })

  it('is part of the auth instance', () => {
    const auth = createAuth({
      db: t.db,
      secret: TEST_AUTH_SECRET,
      baseURL: 'http://localhost:3000',
    })
    expect(Object.keys(auth.api)).toContain('registerSSOProvider')
  })
})
