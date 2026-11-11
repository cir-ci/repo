import type { Build } from '@circi/api'
import { describe, expect, it } from 'vitest'

import { issuePreview } from '#features/builds/api/issues.ts'

const image = (sha256: string) => ({ sha256, width: 10, height: 10 })

const data = (over: Partial<Pick<Build.Detail, 'reviews' | 'diffs'>> = {}) => ({
  project: {
    id: 'p1',
    slug: 'web-app',
    name: 'web-app',
    defaultBranch: 'main',
    workspaceSlug: 'acme',
    workspaceName: 'Acme',
  },
  build: {
    number: 7,
    branch: 'feature/checkout',
    prNumber: 42,
    commitSha: '0123456789abcdef',
    author: { login: 'ann', name: null, avatarUrl: null },
  },
  reviews: [],
  diffs: [
    {
      id: 'd1',
      name: 'checkout / payment',
      status: 'changed' as const,
      score: 0.01,
      changedPixels: 5,
      sizeChanged: false,
      errorMessage: null,
      head: { ...image('head1'), thumbnail: null, metadata: {} },
      base: image('base1'),
      diff: image('diff1'),
    },
  ],
  ...over,
})

describe('issuePreview', () => {
  it('names the snapshot, links the build and the diff image, and quotes the rejection', () => {
    const { title, description } = issuePreview(
      // The preview reads only these fields of the build.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      data({
        reviews: [
          {
            state: 'rejected',
            source: 'ui',
            reason: 'logo is cut off',
            userName: 'Ada',
            createdAt: '2026-11-08T10:00:00.000Z',
          },
        ],
      }) as Parameters<typeof issuePreview>[0],
      'checkout / payment',
      'https://ci.test',
    )
    expect(title).toBe('Visual regression: checkout / payment in build #7')
    expect(description).toContain(
      'Build: https://ci.test/acme/web-app/builds/7?shot=checkout%20%2F%20payment',
    )
    expect(description).toContain('Diff image: https://ci.test/api/files/diff1')
    expect(description).toContain('Ada rejected the build: logo is cut off')
    expect(description).toContain('Branch: feature/checkout')
    expect(description).toContain('Author: ann')
  })

  it('describes the whole build when no snapshot is chosen', () => {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const input = data() as Parameters<typeof issuePreview>[0]
    const { title, description } = issuePreview(input, null, 'https://ci.test')
    expect(title).toBe('Visual regression in build #7')
    expect(description).not.toContain('Diff image')
  })
})
