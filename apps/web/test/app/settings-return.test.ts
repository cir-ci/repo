import { describe, expect, it } from 'vitest'

import { isAppPage, returnTarget } from '#app/settings-return.ts'

const teams = [
  { slug: 'web', name: 'Web app' },
  { slug: 'docs', name: 'Docs' },
]

describe('returnTarget', () => {
  it('falls to the Inbox without a remembered page, or with one that is not an app page', () => {
    expect(returnTarget(undefined, teams)).toEqual({ path: '/inbox', label: 'Inbox' })
    expect(returnTarget('/account/profile', teams)).toEqual({ path: '/inbox', label: 'Inbox' })
    expect(returnTarget('/acme/web/settings/members', teams)).toEqual({
      path: '/inbox',
      label: 'Inbox',
    })
  })

  it('names the page it returns to', () => {
    expect(returnTarget('/acme/web', teams)).toEqual({ path: '/acme/web', label: 'Web app' })
    expect(returnTarget('/acme/web/builds/148?shot=a', teams)).toEqual({
      path: '/acme/web/builds/148?shot=a',
      label: 'Build #148',
    })
    expect(returnTarget('/acme/web/triage', teams).label).toBe('Triage')
    expect(returnTarget('/acme/web/baselines/checkout', teams).label).toBe('Baselines')
    expect(returnTarget('/inbox', teams).label).toBe('Inbox')
    expect(returnTarget('/workspaces/acme/reviews', teams).label).toBe('Reviews')
    expect(returnTarget('/', teams).label).toBe('Teams')
  })

  it('uses the slug for a team the list does not know', () => {
    expect(returnTarget('/acme/gone', teams).label).toBe('gone')
  })
})

describe('isAppPage', () => {
  it('is false for settings and the pages outside the frame', () => {
    expect(isAppPage('/acme/web')).toBe(true)
    expect(isAppPage('/instance/health')).toBe(false)
    expect(isAppPage('/workspaces/acme/settings')).toBe(false)
    expect(isAppPage('/_sso/login')).toBe(false)
  })
})
