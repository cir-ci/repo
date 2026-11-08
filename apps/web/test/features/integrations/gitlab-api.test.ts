import { describe, expect, it } from 'vitest'

import { integrationPage } from '#features/integrations/api.ts'
import { isGitlabBaseUrl, isGitlabProjectPath } from '#features/integrations/gitlab-api.ts'

describe('GitLab helpers', () => {
  it('accepts http(s) addresses only', () => {
    expect(isGitlabBaseUrl(' https://gitlab.com ')).toBe(true)
    expect(isGitlabBaseUrl('http://gitlab.internal:8080/gitlab')).toBe(true)
    for (const bad of ['', 'gitlab.com', 'ftp://gitlab.com', 'not a url']) {
      expect(isGitlabBaseUrl(bad)).toBe(false)
    }
  })

  it('accepts project paths with a namespace', () => {
    expect(isGitlabProjectPath(' acme/web ')).toBe(true)
    expect(isGitlabProjectPath('acme/tools/sub.group/web-app')).toBe(true)
    for (const bad of ['', 'web', 'acme/', '/web', 'acme web/x', 'acme//web']) {
      expect(isGitlabProjectPath(bad)).toBe(false)
    }
  })

  it('has a page for GitLab connections', () => {
    expect(integrationPage('gitlab')).toBe('gitlab')
  })
})
