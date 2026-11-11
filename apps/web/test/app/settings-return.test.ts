import { describe, expect, it } from 'vitest'

import { isAppPage, returnTarget } from '#app/settings-return.ts'

const projects = [
  { slug: 'web', name: 'Web app' },
  { slug: 'docs', name: 'Docs' },
]

describe('returnTarget', () => {
  it('falls to the Inbox without a remembered page, or with one that is not an app page', () => {
    expect(returnTarget(undefined, projects)).toEqual({ path: '/inbox', label: 'Inbox' })
    expect(returnTarget('/account/profile', projects)).toEqual({ path: '/inbox', label: 'Inbox' })
    expect(returnTarget('/acme/web/settings/members', projects)).toEqual({
      path: '/inbox',
      label: 'Inbox',
    })
  })

  it('names the page it returns to', () => {
    expect(returnTarget('/acme/web', projects)).toEqual({ path: '/acme/web', label: 'Web app' })
    expect(returnTarget('/acme/web/builds/148?shot=a', projects)).toEqual({
      path: '/acme/web/builds/148?shot=a',
      label: 'Build #148',
    })
    expect(returnTarget('/acme/web/triage', projects).label).toBe('Triage')
    expect(returnTarget('/acme/web/baselines/checkout', projects).label).toBe('Baselines')
    expect(returnTarget('/inbox', projects).label).toBe('Inbox')
    expect(returnTarget('/workspaces/acme/reviews', projects).label).toBe('Reviews')
    expect(returnTarget('/', projects).label).toBe('Projects')
  })

  it('goes back to the Inbox from an app page it has no name for, never "the app"', () => {
    expect(returnTarget('/workspaces/acme/somewhere', projects)).toEqual({
      path: '/inbox',
      label: 'Inbox',
    })
  })

  it('uses the slug for a project the list does not know', () => {
    expect(returnTarget('/acme/gone', projects).label).toBe('gone')
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
