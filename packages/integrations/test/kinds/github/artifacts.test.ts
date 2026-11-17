import { generateKeyPairSync } from 'node:crypto'

import { makeZip } from '@circi/testing'
import { fakeGithubHost } from '@circi/testing/hosts'
import { describe, expect, it } from 'vitest'

import type { IntegrationDefinition } from '#src/index.ts'
import { GithubApp, GithubArtifactTooLargeError } from '#src/kinds/github/client.ts'
import { github } from '#src/kinds/github/definition.ts'

const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
})

function setup() {
  const fake = fakeGithubHost({ installationId: '99', repos: ['acme/web'] })
  const options = { apiUrl: 'https://api.github.test', appId: '4242', privateKey }
  const app = new GithubApp({ ...options, fetch: fake.fetcher })
  const ctx: IntegrationDefinition.Context = {
    authSecret: 's',
    publicOrigin: 'https://ci.test',
    config: { github: { ...options, webhookSecret: 'w' } },
    fetch: fake.fetcher,
  }
  const zip = makeZip([{ name: 'index.html', content: '<h1>hi</h1>' }])
  return { fake, app, ctx, zip }
}

const input = (over: Partial<{ name: string; maxBytes: number }> = {}) => ({
  connection: { externalId: '99' },
  repo: 'acme/web',
  runId: '7',
  name: 'circi-site',
  maxBytes: 1024 * 1024,
  ...over,
})

const runArtifacts = () => {
  const capability = github.capabilities.runArtifacts
  if (!capability) throw new Error('no runArtifacts capability')
  return capability
}

describe('GithubApp artifacts', () => {
  it('lists a run, then downloads through the redirect without sending the token there', async () => {
    const { fake, app, zip } = setup()
    const id = fake.host.addArtifact(7, { name: 'circi-site', zip })
    fake.host.addArtifact(7, { name: 'coverage', zip: Buffer.from('x') })
    expect(await app.listRunArtifacts('99', 'acme/web', '7')).toEqual([
      { id, name: 'circi-site', sizeInBytes: zip.length, expired: false },
      expect.objectContaining({ name: 'coverage' }),
    ])
    const data = await app.downloadArtifact('99', 'acme/web', id, 1_000_000)
    expect(data.equals(zip)).toBe(true)
    // The API call had the installation token; the signed address did not get it.
    const api = fake.calls.find((c) => c.path.endsWith(`/artifacts/${id}/zip`))
    expect(api?.headers.authorization).toMatch(/^Bearer ghs_/)
    const signed = fake.calls.find((c) => c.host === 'pipelines.signed.test')
    expect(signed?.headers.authorization).toBeUndefined()
    expect(fake.host.signedDownloadsHadAuth()).toEqual([false])
  })

  it('stops reading a body that is larger than allowed', async () => {
    const { fake, app, zip } = setup()
    const id = fake.host.addArtifact(7, { name: 'circi-site', zip })
    await expect(app.downloadArtifact('99', 'acme/web', id, 10)).rejects.toBeInstanceOf(
      GithubArtifactTooLargeError,
    )
  })

  it('refuses a redirect to something that is not http', async () => {
    const { app, fake } = setup()
    fake.script(
      'GET /repos/acme/web/actions/artifacts/5/zip',
      new Response(null, { status: 302, headers: { location: 'file:///etc/passwd' } }),
    )
    await expect(app.downloadArtifact('99', 'acme/web', 5, 100)).rejects.toThrow(/no address/)
  })
})

describe('the github runArtifacts capability', () => {
  it('finds the named artifact', async () => {
    const { fake, ctx, zip } = setup()
    const id = fake.host.addArtifact(7, { name: 'circi-site', zip })
    const found = await runArtifacts().fetch(input(), ctx)
    expect(found).toMatchObject({ status: 'found', artifactId: String(id) })
  })

  it('says what is missing, expired or too big, as values', async () => {
    const { fake, ctx, zip } = setup()
    fake.host.addArtifact(7, { name: 'other', zip })
    expect(await runArtifacts().fetch(input(), ctx)).toEqual({
      status: 'missing',
      available: ['other'],
    })
    fake.host.addArtifact(7, { name: 'old', zip, expired: true })
    expect(await runArtifacts().fetch(input({ name: 'old' }), ctx)).toEqual({ status: 'expired' })
    expect(await runArtifacts().fetch(input({ name: 'other', maxBytes: 5 }), ctx)).toEqual({
      status: 'too_large',
      bytes: zip.length,
    })
  })

  it('treats a refusal as denied (the App lacks Actions: read) and a server error as transient', async () => {
    const { fake, ctx } = setup()
    fake.script(
      'GET /repos/acme/web/actions/runs/7/artifacts',
      Response.json({ message: 'Resource not accessible by integration' }, { status: 403 }),
    )
    expect(await runArtifacts().fetch(input(), ctx)).toMatchObject({
      status: 'denied',
      message: expect.stringContaining('Actions: read'),
    })
    fake.script(
      'GET /repos/acme/web/actions/runs/7/artifacts',
      Response.json({ message: 'Bad gateway' }, { status: 502 }),
    )
    await expect(runArtifacts().fetch(input(), ctx)).rejects.toThrow(/Bad gateway/)
  })

  it('reports an uninstalled App as denied', async () => {
    const { fake, ctx } = setup()
    fake.host.revoke()
    expect(await runArtifacts().fetch(input(), ctx)).toMatchObject({ status: 'denied' })
  })
})
