import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@circi/core'
import { createTestDb, seedUser } from '@circi/db/testing'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { changeAccountEmail } from '#src/index.ts'

let t: createTestDb.Result
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})

const admin = { instanceAdmin: true }

describe('changeAccountEmail', () => {
  it('hands a valid, free address over, trimmed and lower case', async () => {
    const user = await seedUser(t.db, 'old@acme.test')
    const apply = vi.fn<(email: string) => Promise<void>>(async () => {})
    const result = await changeAccountEmail(t.db, {
      actor: admin,
      userId: user.id,
      email: '  New@Acme.test ',
      apply,
    })
    expect(apply).toHaveBeenCalledWith('new@acme.test')
    expect(result).toEqual({ email: 'new@acme.test', previousEmail: 'old@acme.test' })
  })

  it('is for instance admins only, and changes nothing otherwise', async () => {
    const user = await seedUser(t.db, 'someone@acme.test')
    const apply = vi.fn<(email: string) => Promise<void>>(async () => {})
    await expect(
      changeAccountEmail(t.db, {
        actor: { instanceAdmin: false },
        userId: user.id,
        email: 'x@acme.test',
        apply,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError)
    expect(apply).not.toHaveBeenCalled()
  })

  it('refuses a non-address, an unknown account, the same address and one in use', async () => {
    const one = await seedUser(t.db, 'one@acme.test')
    await seedUser(t.db, 'two@acme.test')
    const apply = vi.fn<(email: string) => Promise<void>>(async () => {})
    const attempt = (userId: string, email: string) =>
      changeAccountEmail(t.db, { actor: admin, userId, email, apply })
    await expect(attempt(one.id, 'not-an-address')).rejects.toBeInstanceOf(ValidationError)
    await expect(attempt('nobody', 'x@acme.test')).rejects.toBeInstanceOf(NotFoundError)
    await expect(attempt(one.id, 'ONE@acme.test')).rejects.toBeInstanceOf(ConflictError)
    await expect(attempt(one.id, 'Two@acme.test')).rejects.toThrow('already in use')
    expect(apply).not.toHaveBeenCalled()
  })
})
