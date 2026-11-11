import { describe, expect, it } from 'vitest'

import { defaultIssueTitle, issueDescription } from '#src/integrations/index.ts'

const facts = {
  number: 12,
  project: 'acme/web',
  branch: 'feat/header',
  prNumber: 7,
  commitSha: 'abcdef1234567',
  author: 'ann',
  buildUrl: 'https://ci.test/acme/web/builds/12',
  snapshotName: 'home',
  rejection: { by: 'Bob', reason: 'logo is cut off' },
  imageUrl: 'https://ci.test/api/files/abc',
}

describe('issue text', () => {
  it('names the snapshot and build in the title', () => {
    expect(defaultIssueTitle('home', 12)).toBe('Visual regression: home in build #12')
    expect(defaultIssueTitle(null, 12)).toBe('Visual regression in build #12')
  })

  it('describes the build, who rejected it and why, with both links', () => {
    const text = issueDescription(facts)
    expect(text).toContain('"home" changed in build #12 of acme/web')
    expect(text).toContain('Branch: feat/header')
    expect(text).toContain('Pull request: #7')
    expect(text).toContain('Commit: abcdef1')
    expect(text).toContain('Author: ann')
    expect(text).toContain('Bob rejected the build: logo is cut off')
    expect(text).toContain('Build: https://ci.test/acme/web/builds/12')
    expect(text).toContain('Diff image: https://ci.test/api/files/abc')
  })

  it('leaves out what is not known', () => {
    const text = issueDescription({
      ...facts,
      branch: null,
      prNumber: null,
      author: null,
      rejection: null,
      imageUrl: null,
      snapshotName: null,
    })
    expect(text).not.toMatch(/Branch|Pull request|Author|rejected|Diff image/)
    expect(text).toContain('Build #12 of acme/web has visual changes.')
  })
})
