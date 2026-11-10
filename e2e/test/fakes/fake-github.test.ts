import { type CheckReport, PR_COMMENT_MARKER } from '@circi/integrations/git'
import { GithubApiError, GithubApp } from '@circi/integrations/github'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { type FakeGithub, startFakeGithub } from '#fakes/fake-github.ts'

let gh: FakeGithub
let app: GithubApp
beforeEach(async () => {
  gh = await startFakeGithub({ host: '127.0.0.1' })
  app = new GithubApp({ apiUrl: gh.apiUrl, appId: gh.appId, privateKey: gh.privateKey })
})
afterEach(() => gh.close())

const report: CheckReport = {
  name: 'CirCI',
  status: 'completed',
  conclusion: 'failure',
  title: 'Visual changes need review',
  summary: '1 changed',
  actions: [{ identifier: 'approve', label: 'Approve', description: 'Accept these changes' }],
}

// The point of these tests: the fake speaks what the real adapter (packages/integrations/src/kinds/github) calls.
describe('fake GitHub, driven by the real GithubApp', () => {
  it('gives installation tokens only for a valid app JWT, and records the calls', async () => {
    const id = await app.upsertCheckRun('77', 'acme/web', {
      sha: 'a'.repeat(40),
      report,
      detailsUrl: 'http://ci/builds/1',
    })
    const tokenCall = gh.find('POST /app/installations/77/access_tokens')[0]
    expect(tokenCall?.auth).toBe('app')
    expect(gh.find('POST /repos/acme/web/check-runs')[0]?.auth).toBe('installation')
    expect(gh.checkRuns).toHaveLength(1)
    expect(gh.checkRuns[0]).toMatchObject({
      id: Number(id),
      headSha: 'a'.repeat(40),
      status: 'completed',
      conclusion: 'failure',
      title: 'Visual changes need review',
      detailsUrl: 'http://ci/builds/1',
    })
    expect(gh.checkRuns[0]?.actions.map((a) => a.identifier)).toEqual(['approve'])

    const other = new GithubApp({
      apiUrl: gh.apiUrl,
      appId: gh.appId,
      // A different key: the fake must reject its JWT.
      privateKey: await startOtherKey(),
    })
    await expect(
      other.upsertCheckRun('77', 'acme/web', { sha: 'b'.repeat(40), report, detailsUrl: 'x' }),
    ).rejects.toBeInstanceOf(GithubApiError)
  })

  it('updates a check run in place', async () => {
    const sha = 'c'.repeat(40)
    const id = await app.upsertCheckRun('1', 'acme/web', {
      sha,
      report: { ...report, status: 'in_progress' },
      detailsUrl: 'u',
    })
    await app.upsertCheckRun('1', 'acme/web', { sha, report, detailsUrl: 'u', existingId: id })
    expect(gh.checkRuns).toHaveLength(1)
    expect(gh.checkRuns[0]?.history).toHaveLength(2)
    expect(gh.checkRuns[0]?.conclusion).toBe('failure')
  })

  it('creates, finds by marker and edits the PR comment; reacts and replies', async () => {
    const first = await app.upsertComment('1', 'acme/web', 5, `${PR_COMMENT_MARKER}\nfirst`)
    expect(gh.comments).toHaveLength(1)
    // Same marker, lost id: found and edited instead of duplicated.
    const again = await app.upsertComment('1', 'acme/web', 5, `${PR_COMMENT_MARKER}\nsecond`)
    expect(again).toBe(first)
    expect(gh.comments).toHaveLength(1)
    expect(gh.comments[0]?.body).toContain('second')
    await app.react('1', 'acme/web', first, '+1')
    await app.reply('1', 'acme/web', 5, 'done')
    expect(gh.comments[0]?.reactions).toEqual(['+1'])
    expect(gh.comments).toHaveLength(2)
  })

  it('answers the collaborator permission check from what the test configured', async () => {
    gh.setPermission('acme/web', 'octocat', 'write')
    gh.setPermission('acme/web', 'viewer', 'read')
    expect(await app.canWrite('1', 'acme/web', 'octocat')).toBe(true)
    expect(await app.canWrite('1', 'acme/web', 'viewer')).toBe(false)
    expect(await app.canWrite('1', 'acme/web', 'stranger')).toBe(false)
  })

  it('fails on demand', async () => {
    gh.failNext('POST /repos/acme/web/check-runs', 502)
    await expect(
      app.upsertCheckRun('1', 'acme/web', { sha: 'd'.repeat(40), report, detailsUrl: 'u' }),
    ).rejects.toMatchObject({ status: 502 })
    await expect(
      app.upsertCheckRun('1', 'acme/web', { sha: 'd'.repeat(40), report, detailsUrl: 'u' }),
    ).resolves.toBeTypeOf('string')
  })

  it('produces the environment the stack needs, with the key escaped for an env var', () => {
    const env = gh.env()
    expect(Object.keys(env).toSorted()).toEqual([
      'GITHUB_API_URL',
      'GITHUB_APP_ID',
      'GITHUB_APP_PRIVATE_KEY',
      'GITHUB_APP_WEBHOOK_SECRET',
    ])
    expect(env['GITHUB_APP_PRIVATE_KEY']).not.toContain('\n')
    expect(env['GITHUB_APP_PRIVATE_KEY']?.replace(/\\n/g, '\n')).toBe(gh.privateKey)
  })
})

async function startOtherKey(): Promise<string> {
  const { generateKeyPairSync } = await import('node:crypto')
  return generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  }).privateKey
}

describe('fake GitHub: the App manifest conversion and the App itself', () => {
  it("converts a manifest code once, without authentication, into this fake's App", async () => {
    const code = gh.issueManifestCode()
    const url = `${gh.apiUrl}/app-manifests/${code}/conversions`
    const first = await fetch(url, { method: 'POST' })
    expect(first.status).toBe(201)
    expect(await first.json()).toMatchObject({
      id: Number(gh.appId),
      slug: gh.slug,
      webhook_secret: gh.webhookSecret,
      pem: gh.privateKey,
    })
    expect((await fetch(url, { method: 'POST' })).status).toBe(404)
    expect(
      (await fetch(`${gh.apiUrl}/app-manifests/nope/conversions`, { method: 'POST' })).status,
    ).toBe(404)
  })

  it('tells the App about itself (`GET /app`), the real GithubApp reading it', async () => {
    expect(await app.appInfo()).toMatchObject({ slug: gh.slug, name: 'CirCI' })
  })
})
