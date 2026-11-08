import { describe, expect, it } from 'vitest'

import {
  canManageMembers,
  pendingInvitations,
  invitationCount,
  peopleCount,
  validateDomain,
  validateInvite,
  validateSso,
} from '#features/members/model.ts'

const members = [
  { userId: 'u1', role: 'owner' },
  { userId: 'u2', role: 'admin' },
  { userId: 'u3', role: 'member' },
]

describe('canManageMembers', () => {
  it.each([
    ['u1', true],
    ['u2', true],
    ['u3', false],
    ['nobody', false],
    [undefined, false],
  ])('%s -> %s', (userId, expected) => {
    expect(canManageMembers(members, userId)).toBe(expected)
  })
})

describe('pendingInvitations', () => {
  it('keeps only the pending ones', () => {
    const list = [
      { id: 'a', status: 'pending' },
      { id: 'b', status: 'accepted' },
      { id: 'c', status: 'canceled' },
    ]
    expect(pendingInvitations(list)).toEqual([{ id: 'a', status: 'pending' }])
  })
})

describe('peopleCount', () => {
  it('says person for one and people otherwise', () => {
    expect(peopleCount(1)).toBe('1 person')
    expect(peopleCount(0)).toBe('0 people')
    expect(peopleCount(3)).toBe('3 people')
  })
})

describe('invitationCount', () => {
  it('says invitation for one and invitations otherwise', () => {
    expect(invitationCount(1)).toBe('1 invitation')
    expect(invitationCount(2)).toBe('2 invitations')
  })
})

describe('validateInvite', () => {
  it('asks for an address', () => {
    expect(validateInvite('')).toEqual({ email: 'Enter an email address' })
  })
  it.each(['ada', 'ada@', '@example.test', 'ada@example', 'a da@example.test'])(
    'refuses %j',
    (email) => {
      expect(validateInvite(email).email).toMatch(/doesn’t look like/)
    },
  )
  it('accepts an address', () => {
    expect(validateInvite('ada@example.test')).toEqual({})
  })
})

describe('validateDomain', () => {
  it('asks for a domain', () => {
    expect(validateDomain('').domain).toMatch(/Enter a domain/)
  })
  it.each(['example', 'https://example.com', 'a@example.com', 'example.com/x'])(
    'refuses %j',
    (domain) => {
      expect(validateDomain(domain).domain).toMatch(/just the domain/)
    },
  )
  it('accepts a domain', () => {
    expect(validateDomain('example.com')).toEqual({})
    expect(validateDomain('mail.example.co.uk')).toEqual({})
  })
})

describe('validateSso', () => {
  const ok = { issuer: 'https://login.example.com', clientId: 'id', clientSecret: 's3cret' }
  it('accepts a complete form', () => {
    expect(validateSso(ok)).toEqual({})
  })
  it('names every empty field', () => {
    expect(validateSso({ issuer: '', clientId: '', clientSecret: '' })).toEqual({
      issuer: 'Enter the issuer address',
      clientId: 'Enter the client id',
      clientSecret: 'Enter the client secret',
    })
  })
  it('wants a full web address for the issuer', () => {
    expect(validateSso({ ...ok, issuer: 'login.example.com' }).issuer).toMatch(/full address/)
    expect(validateSso({ ...ok, issuer: 'ftp://login.example.com' }).issuer).toMatch(/full address/)
    expect(validateSso({ ...ok, issuer: 'http://localhost:8080' })).toEqual({})
  })
})
