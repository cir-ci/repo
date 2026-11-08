import { describe, expect, it } from 'vitest'

import { isInstanceAdmin } from '#lib/instance-admin.ts'

describe('isInstanceAdmin', () => {
  it('is true for the admin role, alone or among others', () => {
    expect(isInstanceAdmin({ role: 'admin' })).toBe(true)
    expect(isInstanceAdmin({ role: 'user,admin' })).toBe(true)
  })
  it('is false for anyone else', () => {
    expect(isInstanceAdmin({ role: 'user' })).toBe(false)
    expect(isInstanceAdmin({ role: 'administrator' })).toBe(false)
    expect(isInstanceAdmin({})).toBe(false)
    expect(isInstanceAdmin(undefined)).toBe(false)
  })
})
