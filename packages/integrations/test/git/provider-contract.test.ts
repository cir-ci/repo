import { generateKeyPairSync } from 'node:crypto'

import { fakeGithubHost } from '@circi/testing/hosts'
import { describe, expect, it } from 'vitest'

import { providerRegistry } from '#src/git/provider.ts'
import { GithubApp } from '#src/kinds/github/client.ts'
import {
  type ProviderHarness,
  runGitProviderContract,
} from '#test/support/git-provider-contract.ts'

const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
})

function githubHarness(): ProviderHarness {
  const repos = ['acme/web', 'acme/api-private']
  const fake = fakeGithubHost({ installationId: '99', repos })
  const app = new GithubApp({
    apiUrl: 'https://api.github.test',
    appId: '4242',
    privateKey,
    webhookSecret: 's3cret',
    fetch: fake.fetcher,
  })
  return {
    provider: app,
    reply: (pr, body) => app.reply('99', 'acme/web', pr, body),
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
