import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { type FakeGithub, startFakeGithub } from '#fakes/fake-github.ts'
import { useStack } from '#src/vitest.ts'

/**
 * The GitHub App's one-click (manifest) setup against the real stack. The container has no
 * `GITHUB_APP_*`, only `GITHUB_API_URL` pointing at the fake GitHub on the host (which stands in
 * for the conversion endpoint and the App itself). The browser's trip to github.com's "new App"
 * page is skipped: the test hands the callback the code the fake issues. Nothing here ran against
 * the real GitHub.
 */
describe('GitHub App: created from the manifest, used without a restart', () => {
  let gh: FakeGithub
  beforeAll(async () => {
    gh = await startFakeGithub({ pathPrefix: '/api/v3' })
  })
  afterAll(async () => {
    await gh.close()
  })
  const ctx = useStack({
    dedicated: true,
    setup: true,
    env: () => ({ GITHUB_API_URL: gh.env()['GITHUB_API_URL'] ?? '' }),
  })

  it('creates the App, installs it on a workspace and receives its webhooks', async () => {
    const { stack, setup } = ctx
    const admin = setup.session
    const workspace = setup.workspace.slug
    const webhook = () => gh.sendWebhook(stack.url, 'ping', { zen: 'keep it logically awesome' })

    expect(await admin.get('/api/instance/github-app')).toMatchObject({
      source: 'none',
      canManage: true,
    })
    // Without an App GitHub's deliveries have nowhere to go.
    expect((await webhook()).status).toBe(404)

    const { manifest, postUrl, state } = await admin.post<{
      manifest: { hook_attributes: { url: string }; setup_url: string }
      postUrl: string
      state: string
    }>('/api/instance/github-app/manifest', {})
    expect(manifest.hook_attributes.url).toBe(`${stack.url}/api/integrations/github/webhook`)
    expect(manifest.setup_url).toBe(`${stack.url}/api/integrations/github/setup`)
    expect(postUrl).toMatch(/\/settings\/apps\/new$/)

    // GitHub's redirect back, with the code only it can issue.
    const code = gh.issueManifestCode()
    const back = await admin.request(
      'GET',
      `/api/instance/github-app/callback?code=${code}&state=${encodeURIComponent(state)}`,
    )
    expect(back.status).toBe(302)
    expect(back.headers.get('location')).toContain(`/apps/${gh.slug}/installations/new?state=`)
    expect(gh.find('POST /app-manifests/')).toHaveLength(1)
    // The same code again fails gracefully.
    const twice = await admin.request(
      'GET',
      `/api/instance/github-app/callback?code=${code}&state=${encodeURIComponent(state)}`,
    )
    expect(twice.headers.get('location')).toBe('/instance?githubApp=failed')

    const status = await admin.get<Record<string, unknown>>('/api/instance/github-app')
    expect(status).toMatchObject({ source: 'manifest', appId: gh.appId, slug: gh.slug })
    expect(JSON.stringify(status)).not.toContain(gh.webhookSecret)

    // Usable now, without a restart: GitHub's webhook is verified with the new secret ...
    expect((await webhook()).status).toBe(200)
    expect((await gh.sendWebhook(stack.url, 'ping', {}, { secret: 'wrong' })).status).toBe(401)

    // ... and the install's return connects the installation to the workspace the state names.
    const { url } = await admin.get<{ url: string }>(
      `/api/workspaces/${workspace}/integrations/github/install`,
    )
    const installState = new URL(url).searchParams.get('state') ?? ''
    const installed = await admin.request(
      'GET',
      `/api/integrations/github/setup?installation_id=9001&setup_action=install&state=${encodeURIComponent(installState)}`,
    )
    expect(installed.status).toBe(302)
    expect(installed.headers.get('location')).toContain(
      `/workspaces/${workspace}/settings/integrations/github/`,
    )
    expect(gh.find('POST /app/installations/9001/access_tokens')).toHaveLength(1)

    // The credentials survive a restart: the App is read back from the database.
    await stack.restart('circi')
    expect((await webhook()).status).toBe(200)
    expect(
      (await stack.sql("select value from instance_settings where key = 'github_app'"))[0]?.[0],
    ).not.toContain('BEGIN')
  })
})
