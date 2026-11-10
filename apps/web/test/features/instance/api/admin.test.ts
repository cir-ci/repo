import type { InstanceAdmin } from '@circi/api'
import { describe, expect, it } from 'vitest'

import {
  accountBody,
  deletedLabel,
  accountProblems,
  banBody,
  banProblem,
  banSummary,
  emptyAccountDraft,
  findingCounts,
  formatShortDay,
  isMoving,
  formatAge,
  formatDay,
  groupFindings,
  isForbidden,
  lastSeen,
  mailServer,
  pageCount,
  queueTotals,
  signInMethods,
  slugPreview,
  sortFindings,
  stepDone,
  workspaceProblems,
} from '#features/instance/api/admin.ts'
import { HttpError } from '#lib/http.ts'

import { account, settingsFixture } from '../fixtures.ts'

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

describe('creating an account with a sign-in code', () => {
  const draft = { ...emptyAccountDraft(), name: 'Lior', email: 'lior@acme.dev' }

  it('sends the flag and no password, whatever was typed before switching', () => {
    expect(
      accountBody({ ...draft, delivery: 'code', password: 'a'.repeat(12), instanceAdmin: true }),
    ).toEqual({ name: 'Lior', email: 'lior@acme.dev', instanceAdmin: true, signInCode: true })
  })

  it('ignores the password field while a code is chosen', () => {
    expect(accountProblems({ ...draft, delivery: 'code', password: 'short' })).toEqual({})
  })
})

describe('deleted workspaces', () => {
  it('says how long is left', () => {
    expect(deletedLabel(30)).toBe('Deleted · 30 days left')
    expect(deletedLabel(1)).toBe('Deleted · 1 day left')
    expect(deletedLabel(0)).toBe('Deleted · being purged')
    expect(deletedLabel(null)).toBe('')
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
    const now = Date.parse('2026-11-09T12:00:00Z')
    // The year only when it is not this one.
    expect(formatShortDay('2026-11-09T23:30:00.000Z', now)).toBe('Nov 9')
    expect(formatShortDay('2025-11-09T10:00:00.000Z', now)).toBe('Nov 9, 2025')
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

const step = (values: string[]) => ({ id: 'dns', title: 't', detail: 'd', values })
const f = (id: string, level: 'ok' | 'warn' | 'info' | 'fail'): InstanceAdmin.Finding => ({
  id,
  level,
  label: id,
  detail: `${id} detail`,
  value: null,
  message: id,
  fix: null,
})
const queue = (over: Partial<InstanceAdmin.QueueDepth>): InstanceAdmin.QueueDepth => ({
  queue: 'diff',
  pending: 0,
  running: 0,
  failed: 0,
  oldestPendingAt: null,
  retrying: 0,
  mostRetried: null,
  ...over,
})

describe('health', () => {
  it("puts failures first, then warnings, notes and passes, keeping the server's order", () => {
    const sorted = sortFindings([
      f('a', 'ok'),
      f('b', 'warn'),
      f('c', 'info'),
      f('d', 'warn'),
      f('e', 'fail'),
    ])
    expect(sorted.map((x) => x.id)).toEqual(['e', 'b', 'd', 'c', 'a'])
  })

  it('groups storage as a service and the rest as domains, without the reminder', () => {
    const groups = groupFindings([
      f('host:acme.io', 'ok'),
      f('storage', 'ok'),
      f('public-url', 'warn'),
      f('reminder', 'info'),
    ])
    expect(groups.services.map((x) => x.id)).toEqual(['storage'])
    expect(groups.domains.map((x) => x.id)).toEqual(['public-url', 'host:acme.io'])
  })

  it('puts storage, disk, database and mail under services', () => {
    const groups = groupFindings([
      f('mail', 'info'),
      f('host:acme.io', 'ok'),
      f('disk', 'warn'),
      f('database', 'ok'),
      f('storage', 'ok'),
    ])
    expect(groups.services.map((x) => x.id)).toEqual(['disk', 'mail', 'database', 'storage'])
    expect(groups.domains.map((x) => x.id)).toEqual(['host:acme.io'])
  })

  it('counts passing, warned and failing findings; notes and the reminder are not counted', () => {
    expect(
      findingCounts([
        f('a', 'ok'),
        f('b', 'ok'),
        f('c', 'warn'),
        f('d', 'info'),
        f('e', 'fail'),
        f('reminder', 'info'),
      ]),
    ).toEqual({ passing: 2, warned: 1, failing: 1 })
  })

  it('is moving only while old addresses are listed', () => {
    expect(isMoving({ previousHosts: ['circi.acme.dev'] })).toBe(true)
    expect(isMoving({ previousHosts: [] })).toBe(false)
  })

  it('calls the address step done only once the old address is listed', () => {
    expect(
      stepDone(step(['PUBLIC_URL=https://ci.acme.io', 'PREVIOUS_PUBLIC_URLS=circi.acme.dev'])),
    ).toBe(true)
    expect(stepDone(step(['PREVIOUS_PUBLIC_URLS=<the old address>']))).toBe(false)
    expect(stepDone({ id: 'sessions', title: 't', detail: 'd', values: [] })).toBe(false)
  })

  it('totals the queues, finds the oldest waiting job and the job furthest into its retries', () => {
    expect(
      queueTotals([
        queue({
          queue: 'diff',
          pending: 2,
          running: 1,
          oldestPendingAt: '2026-11-08T10:00:00Z',
          retrying: 1,
          mostRetried: { attempt: 2, maxAttempts: 5 },
        }),
        queue({
          queue: 'webhook',
          pending: 1,
          failed: 3,
          oldestPendingAt: '2026-11-08T09:00:00Z',
          retrying: 1,
          mostRetried: { attempt: 3, maxAttempts: 8 },
        }),
        queue({ queue: 'idle' }),
      ]),
    ).toEqual({
      pending: 3,
      running: 1,
      failed: 3,
      failedDetail: 'webhook · 3',
      retrying: 2,
      retryingDetail: 'webhook · attempt 3 of 8',
      oldestPendingAt: '2026-11-08T09:00:00Z',
      oldestQueue: 'webhook',
    })
    expect(queueTotals([]).oldestPendingAt).toBeNull()
    expect(queueTotals([queue({})]).retryingDetail).toBeNull()
    expect(queueTotals([queue({})]).failedDetail).toBeNull()
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
