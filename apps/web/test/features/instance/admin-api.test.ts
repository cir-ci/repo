import { describe, expect, it } from 'vitest'

import {
  accountBody,
  accountProblems,
  banBody,
  banProblem,
  banSummary,
  emptyAccountDraft,
  findingsSummary,
  formatAge,
  formatDay,
  isForbidden,
  lastSeen,
  mailServer,
  pageCount,
  queueTotals,
  signInMethods,
  slugPreview,
  sortFindings,
  workspaceProblems,
} from '#features/instance/admin-api.ts'
import { HttpError } from '#lib/http.ts'

import { account, settingsFixture } from './fixtures.ts'

describe('creating an account', () => {
  const draft = { ...emptyAccountDraft(), name: ' Lior ', email: ' lior@acme.dev ' }

  it('needs a name and an email', () => {
    expect(accountProblems(emptyAccountDraft())).toEqual({
      name: 'Enter a name',
      email: 'Enter a valid email address',
    })
    expect(accountProblems(draft)).toEqual({})
  })

  it('accepts no password (one is generated) or one of 12 characters or more', () => {
    expect(accountProblems({ ...draft, password: 'short' }).password).toMatch(/at least 12/)
    expect(accountProblems({ ...draft, password: 'a'.repeat(12) })).toEqual({})
  })

  it('sends trimmed values and only what was chosen', () => {
    expect(accountBody(draft)).toEqual({ name: 'Lior', email: 'lior@acme.dev' })
    expect(accountBody({ ...draft, instanceAdmin: true, password: 'a'.repeat(12) })).toEqual({
      name: 'Lior',
      email: 'lior@acme.dev',
      instanceAdmin: true,
      password: 'a'.repeat(12),
    })
  })
})

describe('banning', () => {
  it('lets the end be empty (no end) or whole days up to 3650', () => {
    expect(banProblem({ reason: '', days: '' })).toBeNull()
    expect(banProblem({ reason: '', days: '30' })).toBeNull()
    expect(banProblem({ reason: '', days: '0' })).not.toBeNull()
    expect(banProblem({ reason: '', days: '1.5' })).not.toBeNull()
    expect(banProblem({ reason: '', days: '4000' })).not.toBeNull()
    expect(banProblem({ reason: '', days: 'soon' })).not.toBeNull()
  })

  it('builds the body from what was filled in', () => {
    expect(banBody({ reason: ' ', days: '' })).toEqual({})
    expect(banBody({ reason: ' spam ', days: '7' })).toEqual({ reason: 'spam', expiresInDays: 7 })
  })

  it('says how long and why', () => {
    expect(banSummary(account())).toBeNull()
    expect(banSummary(account({ banned: true }))).toBe('Banned')
    expect(
      banSummary(
        account({ banned: true, banReason: 'spam', banExpires: '2026-10-03T00:00:00.000Z' }),
      ),
    ).toBe('Banned until Oct 3, 2026: spam')
  })
})

describe('formatting', () => {
  it('writes days in UTC', () => {
    expect(formatDay('2026-09-12T23:30:00.000Z')).toBe('Sep 12, 2026')
  })

  it('says when someone last signed in, or that they never did', () => {
    const now = Date.parse('2026-11-08T12:00:00Z')
    expect(lastSeen(account(), now)).toBe('Never signed in')
    expect(lastSeen(account({ lastSignInAt: '2026-11-08T10:00:00Z' }), now)).toBe('2 hours ago')
  })

  it('writes how long a job has waited', () => {
    const now = Date.parse('2026-11-08T12:00:00Z')
    expect(formatAge('2026-11-08T11:59:18Z', now)).toBe('42 seconds')
    expect(formatAge('2026-11-08T11:57:00Z', now)).toBe('3 minutes')
    expect(formatAge('2026-11-08T10:00:00Z', now)).toBe('2 hours')
    expect(formatAge('2026-11-04T12:00:00Z', now)).toBe('4 days')
  })

  it('counts pages, at least one', () => {
    expect(pageCount(0, 25)).toBe(1)
    expect(pageCount(25, 25)).toBe(1)
    expect(pageCount(26, 25)).toBe(2)
  })
})

describe('workspaces', () => {
  it('shows the address a name becomes', () => {
    expect(slugPreview('Acme Mobile')).toBe('acme-mobile')
  })

  it('needs a name that makes an address, and an owner email', () => {
    expect(workspaceProblems({ name: '', ownerEmail: '' })).toEqual({
      name: 'Enter a name',
      ownerEmail: 'Enter a valid email address',
    })
    expect(workspaceProblems({ name: '!!!', ownerEmail: 'a@b.co' }).name).toMatch(/letter or digit/)
    expect(workspaceProblems({ name: 'Acme', ownerEmail: 'a@b.co' })).toEqual({})
  })
})

describe('instance settings', () => {
  it('lists the sign-in methods with their variables', () => {
    const rows = signInMethods({
      password: true,
      email: false,
      sso: [{ id: 'oidc', name: 'Okta' }],
    })
    expect(rows.map((r) => [r.name, r.env, r.allowed])).toEqual([
      ['Password', 'AUTH_PASSWORD_ENABLED', true],
      ['Email code', 'AUTH_EMAIL_ENABLED', false],
      ['Okta', 'AUTH_OIDC_*', true],
    ])
  })

  it('writes the mail server', () => {
    expect(mailServer(settingsFixture().mail)).toBe('smtp.acme.io:587')
    expect(mailServer({ ...settingsFixture().mail, secure: true })).toBe('smtp.acme.io:587 (TLS)')
    expect(
      mailServer({
        configured: false,
        from: null,
        host: null,
        port: null,
        secure: null,
        authenticated: false,
      }),
    ).toBeNull()
  })
})

const f = (id: string, level: 'ok' | 'warn' | 'info') => ({ id, level, message: id, fix: null })

describe('health', () => {
  it('puts warnings first, then notes, then passes, keeping the server’s order', () => {
    const sorted = sortFindings([f('a', 'ok'), f('b', 'warn'), f('c', 'info'), f('d', 'warn')])
    expect(sorted.map((x) => x.id)).toEqual(['b', 'd', 'c', 'a'])
  })

  it('summarises the findings', () => {
    expect(findingsSummary([f('a', 'ok')])).toBe('Everything passes')
    expect(findingsSummary([f('a', 'warn')])).toBe('1 check needs attention')
    expect(findingsSummary([f('a', 'warn'), f('b', 'warn')])).toBe('2 checks need attention')
  })

  it('totals the queues and finds the oldest waiting job', () => {
    expect(
      queueTotals([
        {
          queue: 'diff',
          pending: 2,
          running: 1,
          failed: 0,
          oldestPendingAt: '2026-11-08T10:00:00Z',
        },
        {
          queue: 'webhook',
          pending: 1,
          running: 0,
          failed: 3,
          oldestPendingAt: '2026-11-08T09:00:00Z',
        },
        { queue: 'idle', pending: 0, running: 0, failed: 0, oldestPendingAt: null },
      ]),
    ).toEqual({
      pending: 3,
      running: 1,
      failed: 3,
      oldestPendingAt: '2026-11-08T09:00:00Z',
      oldestQueue: 'webhook',
    })
    expect(queueTotals([]).oldestPendingAt).toBeNull()
  })
})

describe('isForbidden', () => {
  it('is a 403 and nothing else', () => {
    expect(isForbidden(new HttpError(403, 'no'))).toBe(true)
    expect(isForbidden(new HttpError(500, 'no'))).toBe(false)
    expect(isForbidden(new Error('x'))).toBe(false)
    expect(isForbidden(null)).toBe(false)
  })
})
