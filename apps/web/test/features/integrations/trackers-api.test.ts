import { describe, expect, it } from 'vitest'

import { isJiraSite, isTrackerKind } from '#features/integrations/trackers-api.ts'

describe('isJiraSite', () => {
  it('accepts a host name with or without https', () => {
    expect(isJiraSite('acme.atlassian.net')).toBe(true)
    expect(isJiraSite(' https://acme.atlassian.net/jira ')).toBe(true)
  })
  it('refuses empty text, bare names and IP addresses', () => {
    for (const bad of ['', '  ', 'intranet', '127.0.0.1', 'https://localhost']) {
      expect([bad, isJiraSite(bad)]).toEqual([bad, false])
    }
  })
})

describe('isTrackerKind', () => {
  it('knows Linear and Jira only', () => {
    expect(isTrackerKind('linear')).toBe(true)
    expect(isTrackerKind('jira')).toBe(true)
    expect(isTrackerKind('slack')).toBe(false)
  })
})
