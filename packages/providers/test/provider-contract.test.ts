import { generateKeyPairSync } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { GithubApp, providerRegistry } from '../src/index.ts'
import { type ProviderHarness, runGitProviderContract } from './support/contract.ts'
import { fakeGithubHost } from './support/fake-github-host.ts'

const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
})

function githubHarness(): ProviderHarness {
  const repos = ['acme/web', 'acme/api-private']
  const fake = fakeGithubHost({ installationId: '99', repos })
  return {
    provider: new GithubApp({
      apiUrl: 'https://api.github.test',
      appId: '4242',
      privateKey,
      webhookSecret: 's3cret',
      fetch: fake.fetcher,
    }),
    externalId: '99',
    repo: 'acme/web',
    prNumber: 7,
    repositories: repos,
    host: fake.host,
    signed: (body) => fake.sign('s3cret', body),
  }
}

runGitProviderContract('GitHub', githubHarness)

describe('providerRegistry', () => {
  it('resolves an adapter by connection kind and skips unconfigured ones', () => {
    const github = githubHarness().provider
    const registry = providerRegistry({ github, gitlab: undefined })
    expect(registry.get('github')).toBe(github)
    expect(registry.get('gitlab')).toBeUndefined()
    expect(registry.get('nope')).toBeUndefined()
    expect(registry.kinds()).toEqual(['github'])
    expect(github.kind).toBe('github')
  })
})
