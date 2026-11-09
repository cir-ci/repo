import { describe, expect, it } from 'vitest'

import {
  buildGithubManifest,
  convertGithubManifestCode,
  defaultGithubAppName,
  GithubManifestError,
  githubManifestPostUrl,
  githubWebBase,
} from '#src/kinds/github/manifest.ts'

const answer = (status: number, body: unknown): typeof fetch => {
  return async () => new Response(JSON.stringify(body), { status })
}

describe('the App manifest', () => {
  it('names the instance, its webhook, redirect and setup addresses, and the App’s permissions', () => {
    expect(buildGithubManifest({ publicUrl: 'https://ci.example.com/some/path' })).toEqual({
      name: 'CirCI (ci.example.com)',
      url: 'https://ci.example.com',
      hook_attributes: {
        url: 'https://ci.example.com/api/integrations/github/webhook',
        active: true,
      },
      redirect_url: 'https://ci.example.com/api/instance/github-app/callback',
      setup_url: 'https://ci.example.com/api/integrations/github/setup',
      setup_on_update: true,
      public: false,
      default_permissions: { checks: 'write', pull_requests: 'write', metadata: 'read' },
      default_events: ['check_run', 'issue_comment', 'pull_request'],
    })
  })

  it('keeps an edited name within GitHub’s 34 characters', () => {
    const long = 'x'.repeat(60)
    expect(buildGithubManifest({ publicUrl: 'https://a.io', name: long }).name).toHaveLength(34)
    expect(
      defaultGithubAppName('https://a-very-long-hostname.ci.example-company.com'),
    ).toHaveLength(34)
    expect(buildGithubManifest({ publicUrl: 'https://a.io', name: '  ' }).name).toBe('CirCI (a.io)')
  })

  it('posts to GitHub.com or to a GitHub Enterprise Server, for an account or an organization', () => {
    expect(githubManifestPostUrl('https://api.github.com')).toBe(
      'https://github.com/settings/apps/new',
    )
    expect(githubManifestPostUrl('https://api.github.com', 'acme')).toBe(
      'https://github.com/organizations/acme/settings/apps/new',
    )
    expect(githubManifestPostUrl('https://ghe.example.com/api/v3', 'acme')).toBe(
      'https://ghe.example.com/organizations/acme/settings/apps/new',
    )
    expect(githubWebBase('https://ghe.example.com/api/v3/')).toBe('https://ghe.example.com')
  })
})

describe('converting the manifest code', () => {
  it('returns the App’s credentials, calling GitHub without authentication', async () => {
    let seen: { url: string; auth: string | null; method: string } | undefined
    const fetcher: typeof fetch = async (input, init) => {
      const req = new Request(input, init)
      seen = { url: req.url, auth: req.headers.get('authorization'), method: req.method }
      return new Response(
        JSON.stringify({
          id: 12,
          slug: 'circi',
          client_id: 'c',
          client_secret: 's',
          webhook_secret: 'w',
          pem: 'PEM',
          html_url: 'https://github.com/apps/circi',
        }),
        { status: 201 },
      )
    }
    expect(await convertGithubManifestCode('https://api.github.com', 'abc/1', fetcher)).toEqual({
      appId: '12',
      slug: 'circi',
      clientId: 'c',
      clientSecret: 's',
      webhookSecret: 'w',
      privateKey: 'PEM',
      htmlUrl: 'https://github.com/apps/circi',
    })
    expect(seen).toEqual({
      url: 'https://api.github.com/app-manifests/abc%2F1/conversions',
      auth: null,
      method: 'POST',
    })
  })

  it('fails for a code GitHub no longer accepts, or an answer without credentials', async () => {
    await expect(
      convertGithubManifestCode(
        'https://api.github.com',
        'x',
        answer(404, { message: 'Not Found' }),
      ),
    ).rejects.toMatchObject({ name: 'GithubManifestError', status: 404 })
    await expect(
      convertGithubManifestCode('https://api.github.com', 'x', answer(201, { id: 1, slug: 's' })),
    ).rejects.toBeInstanceOf(GithubManifestError)
  })
})
