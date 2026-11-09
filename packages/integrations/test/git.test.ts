import { createHmac } from 'node:crypto'

import { ProviderApiError } from '@circi/providers'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { bitbucket } from '#src/bitbucket.ts'
import { github } from '#src/github.ts'
import { gitlab } from '#src/gitlab.ts'
import {
  defineIntegration,
  definitionProblems,
  derivedWebhookSecret,
  type IntegrationDefinition,
  integrationRegistry,
} from '#src/index.ts'

const ctx = (over: Partial<IntegrationDefinition.Context> = {}): IntegrationDefinition.Context => ({
  authSecret: 'instance-secret',
  publicOrigin: 'https://ci.test',
  config: {},
  ...over,
})

const gitOf = (def: IntegrationDefinition) => {
  const git = def.capabilities.git
  if (!git) throw new Error(`${def.id} has no git capability`)
  return git
}

describe('the git hosts of the registry', () => {
  it('are the definitions with the git capability, and map teams to repositories', () => {
    expect(integrationRegistry.gitKinds().toSorted()).toEqual(['bitbucket', 'github', 'gitlab'])
    for (const def of [github, gitlab, bitbucket]) {
      expect(def.group).toBe('git')
      expect(def.mapping?.target.kind).toBe('repository')
      expect(def.exclusive).toEqual({ account: true, team: 'group' })
      expect(def.events).toEqual([])
    }
  })

  it('checks that a repository target needs a git host, and a git host a repository target', () => {
    const base = {
      id: 'half',
      group: 'git' as const,
      name: 'Half',
      description: 'x',
      logo: 'half',
      credentials: z.object({ token: z.string().meta({ label: 'Token' }) }),
      connect: async () => ({ externalId: 'a', displayName: 'a', credentials: 'a' }),
      needsAttention: () => null,
      events: [],
    }
    const repoTarget = { target: { label: 'Repo', kind: 'repository' as const } }
    expect(() =>
      defineIntegration({
        ...base,
        capabilities: { design: github.capabilities.design },
        mapping: repoTarget,
      }),
    ).toThrow(/repository mapping target needs the `git` capability/)
    expect(() =>
      defineIntegration({
        ...base,
        capabilities: { git: gitOf(github) },
        mapping: { target: { label: 'Repo', kind: 'text' } },
      }),
    ).toThrow(/maps teams to repositories/)
    expect(definitionProblems(github)).toEqual([])
  })
})

const app = (listRepositories: () => Promise<unknown>) =>
  ctx({ gitProviders: { github: { listRepositories } } })

describe('GitHub', () => {
  it('is available only where the GitHub App is configured', () => {
    expect(github.available?.(ctx())).toBe(false)
    expect(
      github.available?.(
        ctx({
          config: { github: { apiUrl: 'u', appId: '1', privateKey: 'k', webhookSecret: 's' } },
        }),
      ),
    ).toBe(true)
  })

  it('connects an installation the App can see, keeping no secret of its own', async () => {
    const result = await github.connect?.(
      { installationId: '501' },
      app(async () => []),
    )
    expect(result).toEqual({
      externalId: '501',
      displayName: 'Installation 501',
      credentials: '',
    })
    expect(github.secretless).toBe(true)
  })

  it('answers 404 for an installation GitHub does not know, 502 when it does not answer, 400 without an App', async () => {
    const revoked = app(async () => {
      throw new ProviderApiError(404, 'Not Found', { revoked: true })
    })
    await expect(github.connect?.({ installationId: '9' }, revoked)).rejects.toMatchObject({
      code: 'not_found',
    })
    const down = app(async () => {
      throw new Error('boom')
    })
    await expect(github.connect?.({ installationId: '9' }, down)).rejects.toMatchObject({
      code: 'unreachable',
    })
    await expect(github.connect?.({ installationId: '9' }, ctx())).rejects.toMatchObject({
      code: 'invalid_input',
    })
  })

  it('wants a numeric installation id', () => {
    expect(github.credentials.safeParse({ installationId: 'abc' }).success).toBe(false)
    expect(github.credentials.safeParse({ installationId: '12' }).success).toBe(true)
  })

  it('turns deliveries into events', () => {
    const { webhook } = gitOf(github)
    const repository = { full_name: 'Acme/Web' }
    const installation = { id: 99 }
    expect(
      webhook.events(
        { 'x-github-event': 'issue_comment' },
        {
          action: 'created',
          issue: { number: 5, pull_request: {} },
          comment: {
            id: 77,
            body: '/circi approve',
            user: { id: 1234, login: 'ann', type: 'User' },
          },
          installation,
          repository,
        },
      ),
    ).toEqual([
      {
        type: 'command',
        repo: { ref: 'Acme/Web', connection: { externalId: '99' } },
        number: 5,
        command: 'approve',
        commentId: '77',
        actor: { accountId: '1234', login: 'ann' },
      },
    ])
    expect(
      webhook.events(
        { 'x-github-event': 'pull_request' },
        {
          action: 'opened',
          pull_request: { number: 3, user: { login: 'ann', id: 1234 } },
          installation,
          repository,
        },
      ),
    ).toEqual([
      {
        type: 'pull_request',
        repo: { ref: 'Acme/Web', connection: { externalId: '99' } },
        number: 3,
        author: { login: 'ann', accountId: '1234' },
      },
    ])
    expect(
      webhook.events(
        { 'x-github-event': 'check_run' },
        {
          action: 'requested_action',
          requested_action: { identifier: 'reject' },
          check_run: { id: 5 },
          sender: { id: 1234, login: 'ann' },
          installation,
          repository,
        },
      ),
    ).toMatchObject([{ type: 'check_action', action: 'reject', checkRunId: '5' }])
    // Bots, other actions and unknown events mean nothing.
    expect(
      webhook.events(
        { 'x-github-event': 'issue_comment' },
        {
          action: 'created',
          issue: { number: 5, pull_request: {} },
          comment: { id: 1, body: '/circi approve', user: { id: 1, type: 'Bot' } },
          installation,
          repository,
        },
      ),
    ).toEqual([])
    expect(webhook.events({ 'x-github-event': 'push' }, {})).toEqual([])
    expect(webhook.deliveryId({ 'x-github-delivery': 'd-1' }, Buffer.alloc(0))).toBe('d-1')
    expect(webhook.deliveryId({}, Buffer.alloc(0))).toBeNull()
    // The App's own secret is configured on GitHub: nothing to show.
    expect('secret' in webhook).toBe(false)
  })
})

describe('GitLab', () => {
  it('derives its webhook secret from the instance secret', () => {
    const secret = gitOf(gitlab).webhook.secret?.(ctx())
    expect(secret).toBe(derivedWebhookSecret('instance-secret', 'gitlab'))
    expect(secret).toBe(
      createHmac('sha256', 'instance-secret').update('circi:gitlab-webhook').digest('hex'),
    )
    expect(gitOf(bitbucket).webhook.secret?.(ctx())).not.toBe(secret)
  })

  it('verifies the webhook token through its provider', () => {
    const provider = gitOf(gitlab).provider(ctx())
    const secret = derivedWebhookSecret('instance-secret', 'gitlab')
    expect(provider?.verifyWebhook(Buffer.alloc(0), { 'x-gitlab-token': secret })).toBe(true)
    expect(provider?.verifyWebhook(Buffer.alloc(0), { 'x-gitlab-token': 'nope' })).toBe(false)
  })

  it('turns merge request and note hooks into events, naming the host by its address', () => {
    const { webhook } = gitOf(gitlab)
    const project = {
      path_with_namespace: 'Acme/Tools/Web',
      web_url: 'https://gitlab.example.com/Acme/Tools/Web',
    }
    expect(
      webhook.events(
        { 'x-gitlab-event': 'Note Hook' },
        {
          project,
          user: { id: 4321, username: 'ann' },
          object_attributes: { id: 9, noteable_type: 'MergeRequest', note: '/circi rerun' },
          merge_request: { iid: 12 },
        },
      ),
    ).toEqual([
      {
        type: 'command',
        repo: { ref: 'Acme/Tools/Web', connection: { externalIdPrefix: 'gitlab.example.com#' } },
        number: 12,
        command: 'rerun',
        commentId: '9',
        actor: { accountId: '4321', login: 'ann' },
      },
    ])
    expect(
      webhook.events(
        { 'x-gitlab-event': 'Merge Request Hook' },
        {
          project,
          user: { id: 4321, username: 'ann' },
          object_attributes: { action: 'update', iid: 3 },
        },
      ),
    ).toEqual([])
    expect(webhook.deliveryId({ 'x-gitlab-event-uuid': 'u1' }, Buffer.alloc(0))).toBe('gitlab:u1')
    expect(webhook.deliveryId({}, Buffer.from('body'))).toMatch(/^gitlab:[0-9a-f]{64}$/)
  })

  it('refuses addresses that are not GitLab servers before asking anyone', async () => {
    await expect(gitlab.connect?.({ baseUrl: 'ftp://x', token: 't' }, ctx())).rejects.toMatchObject(
      { code: 'invalid_input' },
    )
    await expect(
      gitlab.connect?.({ baseUrl: 'http://10.0.0.5', token: 't' }, ctx()),
    ).rejects.toMatchObject({ code: 'invalid_input' })
  })
})

describe('Bitbucket', () => {
  it('turns pull request hooks into events with the source commit and branch', () => {
    const { webhook } = gitOf(bitbucket)
    expect(
      webhook.events(
        { 'x-event-key': 'pullrequest:created' },
        {
          repository: { full_name: 'acme/Web', workspace: { slug: 'acme' } },
          pullrequest: {
            id: 4,
            author: { nickname: 'ann', uuid: '{ann}' },
            source: { commit: { hash: 'abc123' }, branch: { name: 'feature' } },
          },
        },
      ),
    ).toEqual([
      {
        type: 'pull_request',
        repo: { ref: 'acme/Web', connection: { externalId: 'acme' } },
        number: 4,
        author: { login: 'ann', accountId: '{ann}' },
        head: { sha: 'abc123', branch: 'feature' },
      },
    ])
    expect(webhook.deliveryId({ 'x-request-uuid': 'r1' }, Buffer.alloc(0))).toBe('bitbucket:r1')
    expect(webhook.deliveryId({}, Buffer.alloc(0))).toBeNull()
  })

  it('wants a workspace id, lowercases it, and takes an optional username', () => {
    expect(bitbucket.credentials.parse({ bitbucketWorkspace: 'Acme-WS', token: 't' })).toEqual({
      bitbucketWorkspace: 'acme-ws',
      token: 't',
    })
    expect(
      bitbucket.credentials.safeParse({ bitbucketWorkspace: 'has space', token: 't' }).success,
    ).toBe(false)
  })
})
