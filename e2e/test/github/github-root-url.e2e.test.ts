import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { type FakeGithub, startFakeGithub } from '#fakes/fake-github.ts'
import { buildDetail, createLinkedTeam, uploadPr } from '#github/github-helpers.ts'
import { useStack } from '#stack/vitest.ts'

/**
 * The github.com form of the API address. The shared `github` profile serves its fake under
 * `/api/v3` (GitHub Enterprise Server), so every other file exercises that form. Here the fake
 * answers at the root, the way `https://api.github.com` does (`GITHUB_API_URL` has no path):
 * installation token, check run and pull request comment. One dedicated stack, one test.
 * GitHub is a fake: nothing here ran against github.com itself.
 */
describe('GitHub App with a github.com style API address (fake GitHub at the root)', () => {
  let gh: FakeGithub
  // Registered before useStack's own hook, so the fake exists when the stack's environment is read.
  beforeAll(async () => {
    gh = await startFakeGithub()
  })
  afterAll(async () => {
    await gh.close()
  })
  const ctx = useStack({ dedicated: true, setup: true, env: () => gh.env() })

  it('mints a token and writes the check run and comment at the root paths', async () => {
    const { stack, setup } = ctx
    expect(new URL(gh.apiUrl).pathname).toBe('/')
    expect(new URL(ctx.stack.url).origin).toBeTruthy()
    const workspace = setup.workspace.slug
    const linked = await createLinkedTeam(stack, setup.session, workspace, 'Root form', {
      repoRef: 'acme/root',
    })
    const pr = await uploadPr(stack, linked, 7, { login: { dot: { x: 200, y: 100 } } })
    expect(pr.exitCode).toBe(0)
    await expect
      .poll(() => gh.checkRuns.find((c) => c.headSha === pr.sha)?.conclusion)
      .toBe('action_required')
    await expect.poll(() => gh.comments.filter((c) => c.prNumber === 7).length).toBe(1)

    const paths = gh.requests.map((r) => r.path)
    expect(paths).toContain(`/app/installations/${linked.installationId}/access_tokens`)
    expect(paths).toContain('/repos/acme/root/check-runs')
    expect(paths.every((p) => !p.startsWith('/api/v3'))).toBe(true)
    expect(gh.requests.every((r) => r.auth === 'app' || r.auth === 'installation')).toBe(true)
    expect((await buildDetail(setup.session, linked, pr.buildNumber)).build.status).toBe('complete')
  })
})
