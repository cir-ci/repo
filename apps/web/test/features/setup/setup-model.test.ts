import { describe, expect, it } from 'vitest'

import {
  stepLabel,
  storageFindings,
  validateAccount,
  validateWorkspace,
  workspaceSlug,
} from '#features/setup/setup-model.ts'

const account = {
  code: 'abc',
  name: 'Ada',
  email: 'ada@example.com',
  password: 'correct horse battery',
}

const finding = (id: string) => ({
  id,
  level: 'ok' as const,
  label: id,
  detail: '',
  value: null,
  message: '',
  fix: null,
})

describe('setup steps', () => {
  it('labels a step out of four', () => {
    expect(stepLabel(1)).toBe('Step 1 of 4')
    expect(stepLabel(4)).toBe('Step 4 of 4')
  })

  it('accepts a complete account and names what is wrong otherwise', () => {
    expect(validateAccount(account)).toEqual({})
    expect(validateAccount({ code: ' ', name: '', email: '', password: '' })).toEqual({
      code: 'Enter the setup code',
      name: 'Enter your name',
      email: 'Enter your email',
      password: 'Enter a password',
    })
    expect(validateAccount({ ...account, email: 'ada@', password: '12345678901' })).toEqual({
      email: 'Enter a valid email address',
      password: 'Use at least 12 characters',
    })
    expect(validateAccount({ ...account, password: '123456789012' })).toEqual({})
  })

  it('makes the workspace address from the name unless one was typed', () => {
    expect(workspaceSlug({ name: 'Acme Inc.', slug: '' })).toBe('acme-inc')
    expect(workspaceSlug({ name: 'Acme Inc.', slug: ' acme ' })).toBe('acme')
  })

  it('validates the workspace name and address', () => {
    expect(validateWorkspace({ name: 'Acme', slug: '' })).toEqual({})
    expect(validateWorkspace({ name: '', slug: '' })).toEqual({ name: 'Enter a name' })
    expect(validateWorkspace({ name: 'Acme', slug: 'No Good' }).slug).toMatch(/lowercase/)
    expect(validateWorkspace({ name: 'Acme', slug: 'settings' }).slug).toMatch(/reserved/)
    // A name with nothing to make an address from asks for one.
    expect(validateWorkspace({ name: '***', slug: '' })).toEqual({ slug: 'Enter an address' })
  })

  it('picks the storage findings out of the doctor checks', () => {
    expect(
      storageFindings({
        findings: [finding('database'), finding('storage'), finding('disk')],
        warned: false,
      }).map((f) => f.id),
    ).toEqual(['storage', 'disk'])
  })
})
