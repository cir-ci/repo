import type { Build } from '@circi/api'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createProject, type CreatedProject, inviteMember, newAccount } from '../src/admin.ts'
import type { FakeGithub } from '../src/fakes/fake-github.ts'
import { startWebhookReceiver, type WebhookReceiver } from '../src/fakes/webhook-receiver.ts'
import { Repo } from '../src/git-repo.ts'
import { extractLinks } from '../src/mail.ts'
import { uploadOrThrow } from '../src/upload.ts'
import { useStack } from '../src/vitest.ts'

/**
 * Proves the plumbing the feature tests build on: the container reaches fakes running on the host
 * (`host.docker.internal`), and mail reaches Mailpit. Only the edges are fake: the webhook
 * receiver and GitHub are test doubles; CirCI's own code is the real thing.
 */
describe('host fakes and mail, seen from the real stack', () => {
  let gh: FakeGithub
  let receiver: WebhookReceiver
  let repo: Repo
  let project: CreatedProject
  let prBuild = 0
  beforeAll(async () => {
    receiver = await startWebhookReceiver()
    repo = await Repo.create()
  })
  afterAll(async () => {
    await receiver.close()
    await repo.destroy()
  })
  const ctx = useStack({ profile: 'github', setup: true })
  // The profile's fake GitHub, reset for this file. Registered right after useStack's own hooks.
  beforeAll(() => {
    gh = ctx.github
  })

  it('delivers a signed webhook to a receiver on the host', async () => {
    const { stack, setup } = ctx
    const org = setup.organization.slug
    project = await createProject(setup.session, org, 'Hooked')
    const created = await setup.session.post<{ secret: string }>(
      `/api/projects/${org}/${project.slug}/webhooks`,
      { url: `${receiver.url}/hook`, events: ['build.completed'] },
    )
    receiver.setSecret(created.secret)

    await repo.writeShots({ home: {} })
    await repo.commit('first')
    const up = await uploadOrThrow({ stack, token: project.token, repo, wait: true })

    const delivery = await receiver.waitFor((d) => d.event === 'build.completed')
    expect(delivery.signatureValid).toBe(true)
    expect(delivery.json).toMatchObject({
      event: 'build.completed',
      build: { number: up.build.number },
    })
  })

  it('reports a pull request build to GitHub: installation token, check run with Approve/Reject, comment', async () => {
    const { stack, setup } = ctx
    const org = setup.organization.slug
    await setup.session.put(`/api/projects/${org}/${project.slug}/github`, {
      installationId: '77',
      repoRef: 'acme/hooked',
    })

    await repo.checkout('feature', { create: true })
    await repo.writeShots({ home: { dot: { x: 5, y: 5 } } })
    const sha = await repo.commit('change')
    const up = await uploadOrThrow({
      stack,
      token: project.token,
      repo,
      wait: true,
      pr: { number: 3 },
    })
    // With a linked repository the check run blocks the merge, so the CLI itself exits 0.
    expect(up.exitCode).toBe(0)
    expect(up.status?.outcome).toMatchObject({ state: 'fail' })
    prBuild = up.build.number

    await expect.poll(() => gh.checkRuns.find((c) => c.headSha === sha)?.status).toBe('completed')
    const check = gh.checkRuns.find((c) => c.headSha === sha)
    expect(check).toMatchObject({ repo: 'acme/hooked', conclusion: 'action_required' })
    expect(check?.actions.map((a) => a.identifier)).toEqual(['approve', 'reject'])
    expect(check?.detailsUrl).toContain(`/${org}/${project.slug}/builds/${up.build.number}`)
    // The app JWT was signed with this run's private key and accepted.
    expect(gh.find('POST /app/installations/77/access_tokens')[0]?.auth).toBe('app')
    // One check run and one comment for the build, however many notices were queued for it.
    await expect.poll(() => gh.comments.filter((c) => c.prNumber === 3).length).toBe(1)
    expect(gh.checkRuns.filter((c) => c.headSha === sha)).toHaveLength(1)
  })

  it('a GitHub user not linked to a CirCI member cannot approve from the check run', async () => {
    const { stack, setup } = ctx
    const org = setup.organization.slug
    const check = gh.checkRuns.at(-1)
    expect(check).toBeDefined()
    const detail = () =>
      setup.session.get<Build.Detail>(`/api/projects/${org}/${project.slug}/builds/${prBuild}`)
    // A correctly signed webhook, but the sender's GitHub login is linked to no member: ignored.
    const res = await gh.sendWebhook(stack.url, 'check_run', {
      action: 'requested_action',
      requested_action: { identifier: 'approve' },
      check_run: { id: check?.id },
      repository: { full_name: 'acme/hooked' },
      installation: { id: 77 },
      sender: { id: 999, login: 'stranger' },
    })
    expect(res.status).toBeLessThan(300)
    expect((await detail()).build.reviewStatus).toBe('pending')
  })

  it('sends invitation mail through the stack to Mailpit', async () => {
    const { stack, setup } = ctx
    const guest = newAccount('guest')
    await inviteMember(setup.session, setup.organization.slug, guest.email, 'member')
    const mail = await stack.mail.waitFor({ to: guest.email })
    expect(mail.Subject.length).toBeGreaterThan(0)
    expect(extractLinks(mail).some((l) => l.startsWith(stack.url))).toBe(true)
  })
})
