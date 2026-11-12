import { describe, expect, it } from 'vitest'

import {
  configProblems,
  draftOf,
  isDirty,
  lockedBy,
  mailServer,
  saveRequests,
} from '#features/instance/config-model.ts'

import { configFixture } from './fixtures.ts'

describe('the settings draft', () => {
  it('starts as what is saved, with nothing to send', () => {
    const config = configFixture()
    const draft = draftOf(config)
    expect(isDirty(config, draft)).toBe(false)
    expect(saveRequests(config, draft)).toEqual([])
    expect(configProblems(config, draft)).toEqual({})
  })

  it('sends only what changed, the mail server first', () => {
    const config = configFixture()
    const draft = draftOf(config)
    draft.signIn.password = false
    draft.anyoneCreatesWorkspaces = true
    draft.limits.gcGraceHours = 48
    draft.smtp.host = 'smtp2.acme.io'
    expect(saveRequests(config, draft).map((r) => [r.path.join('/'), r.body])).toEqual([
      [
        'config/smtp',
        {
          host: 'smtp2.acme.io',
          port: 587,
          secure: false,
          user: 'mailer',
          from: 'CirCI <circi@acme.io>',
        },
      ],
      ['config/workspace-creation', { value: 'anyone' }],
      ['config/limits', { gcGraceHours: 48 }],
      ['config/sign-in', { password: false }],
    ])
  })

  it('leaves a saved secret out, and sends a replaced or removed one', () => {
    const config = configFixture()
    const kept = draftOf(config)
    kept.smtp.from = 'ci@acme.io'
    expect(JSON.stringify(saveRequests(config, kept))).not.toContain('password')

    const replaced = draftOf(config)
    replaced.smtp.password = { mode: 'replace', value: 'new-secret' }
    expect(saveRequests(config, replaced)[0]?.body).toMatchObject({ password: 'new-secret' })

    const removed = draftOf(config)
    removed.smtp.user = ''
    removed.smtp.password = { mode: 'remove' }
    expect(saveRequests(config, removed)[0]?.body).toMatchObject({ user: '', password: null })
  })

  it('never sends a setting whose variable is set', () => {
    const locked = { source: 'env' as const, env: 'GC_GRACE_HOURS' }
    const config = configFixture({
      limits: {
        ...configFixture().limits,
        gcGraceHours: { value: 48, ...locked },
      },
      signIn: {
        ...configFixture().signIn,
        password: { value: true, source: 'env', env: 'AUTH_PASSWORD_ENABLED' },
      },
      smtp: { ...configFixture().smtp, source: 'env', env: 'SMTP_HOST' },
    })
    const draft = draftOf(config)
    draft.limits.gcGraceHours = 1
    draft.signIn.password = false
    draft.smtp.host = 'other'
    expect(saveRequests(config, draft)).toEqual([])
    expect(lockedBy(config.limits.gcGraceHours)).toBe('Set by GC_GRACE_HOURS')
    expect(lockedBy(config.limits.jobRetentionDays)).toBeUndefined()
  })

  it('checks limits against their bounds, and the mail and Slack fields', () => {
    const config = configFixture()
    const draft = draftOf(config)
    draft.limits.defaultProjectRetentionDays = 0
    draft.limits.staticSitesMaxMb = 9000
    draft.limits.uploadTimeoutMinutes = 1.5
    draft.smtp.host = ''
    draft.smtp.port = 70_000
    draft.smtp.from = 'nope'
    expect(Object.keys(configProblems(config, draft)).toSorted()).toEqual([
      'limits.defaultProjectRetentionDays',
      'limits.staticSitesMaxMb',
      'limits.uploadTimeoutMinutes',
      'smtp.from',
      'smtp.host',
      'smtp.port',
    ])

    const slack = draftOf(config)
    slack.slack.clientId = 'id'
    expect(configProblems(config, slack)['slack.secret']).toBe('Enter the client secret')
    slack.slack.secret = { mode: 'replace', value: 'secret' }
    expect(configProblems(config, slack)).toEqual({})
  })

  it('needs a password for a user name', () => {
    const config = configFixture({ smtp: { ...configFixture().smtp, passwordSaved: false } })
    const draft = draftOf(config)
    draft.smtp.host = 'smtp2.acme.io'
    expect(configProblems(config, draft)['smtp.password']).toMatch(/password/)
    draft.smtp.password = { mode: 'replace', value: 'pw' }
    expect(configProblems(config, draft)).toEqual({})
  })

  it('writes the mail server in a line', () => {
    expect(mailServer(configFixture().smtp)).toBe('smtp.acme.io:587')
    expect(mailServer({ ...configFixture().smtp, secure: true })).toBe('smtp.acme.io:587 (TLS)')
    expect(mailServer({ ...configFixture().smtp, source: 'none', host: '' })).toBeNull()
  })
})
