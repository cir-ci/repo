import type { Build } from '@circi/api'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { approveBuild, createProject, type CreatedProject } from '#src/admin.ts'
import { Repo } from '#src/git-repo.ts'
import { uploadOrThrow } from '#src/upload.ts'
import { useBrowser, useStack } from '#src/vitest.ts'

/**
 * The core loop on the real stack: the real CLI uploads a baseline on `main` and a changed build
 * from a pull request, the worker diffs, and a reviewer rejects, then approves, in the browser.
 */
describe('upload, diff and review (local-disk storage)', () => {
  const ctx = useStack({ profile: 'default', setup: true })
  const browser = useBrowser()
  let repo: Repo
  let project: CreatedProject
  let buildNumber: number

  beforeAll(async () => {
    repo = await Repo.create()
  })
  afterAll(async () => {
    await repo.destroy()
  })

  const detail = () =>
    ctx.setup.session.get<Build.Detail>(
      `/api/projects/${ctx.setup.organization.slug}/${project.slug}/builds/${buildNumber}`,
    )

  it('a baseline on main passes and a changed pull request build is held for review', async () => {
    const { stack, setup } = ctx
    project = await createProject(setup.session, setup.organization.slug, 'Web app')

    await repo.writeShots({ home: {}, login: { dot: { x: 40, y: 40 } } })
    await repo.commit('first')
    const baseline = await uploadOrThrow({ stack, token: project.token, repo, wait: true })
    // No baseline yet, so even on main the first build waits for someone to approve it.
    expect(baseline.exitCode).toBe(1)
    expect(baseline.status?.outcome).toMatchObject({ state: 'fail' })
    expect(baseline.status?.counts).toMatchObject({ added: 2, total: 2 })
    expect(
      (
        await ctx.setup.session.get<Build.Detail>(
          `/api/projects/${setup.organization.slug}/${project.slug}/builds/${baseline.build.number}`,
        )
      ).build.reviewStatus,
    ).toBe('pending')
    await approveBuild(setup.session, setup.organization.slug, project.slug, baseline.build.number)

    await repo.checkout('feature', { create: true })
    await repo.writeShots({ login: { dot: { x: 300, y: 200 } } })
    await repo.commit('move the button')
    const changed = await uploadOrThrow({
      stack,
      token: project.token,
      repo,
      wait: true,
      pr: { number: 12 },
    })
    expect(changed.exitCode).toBe(1)
    expect(changed.status?.counts).toMatchObject({ changed: 1, unchanged: 1 })
    expect(changed.status?.outcome).toMatchObject({ state: 'fail' })
    buildNumber = changed.build.number

    const d = await detail()
    expect(d.build).toMatchObject({ status: 'complete', reviewStatus: 'pending', prNumber: 12 })
    expect(d.diffs.find((x) => x.name === 'login')).toMatchObject({ status: 'changed' })
    expect(d.diffs.find((x) => x.name === 'home')).toMatchObject({ status: 'unchanged' })
  })

  it('rejecting through the UI asks first, then marks the build rejected everywhere', async () => {
    const { stack, setup } = ctx
    const page = await browser.as(setup.session)
    await page.goto(`${stack.url}/${setup.organization.slug}/${project.slug}/builds/${buildNumber}`)
    await page.getByRole('button', { name: 'Reject', exact: true }).click()

    const dialog = page
      .locator('[role=dialog], [role=alertdialog]')
      .filter({ hasText: `Reject build #${buildNumber}?` })
    await dialog.waitFor()
    // Cancelling changes nothing.
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await dialog.waitFor({ state: 'hidden' })
    expect((await detail()).build.reviewStatus).toBe('pending')

    await page.getByRole('button', { name: 'Reject', exact: true }).click()
    // A reason is required: submitting without one keeps the dialog open.
    await dialog.getByRole('button', { name: 'Reject', exact: true }).click()
    await dialog.getByRole('alert').waitFor()
    expect((await detail()).build.reviewStatus).toBe('pending')
    await dialog.getByRole('textbox', { name: 'Reason' }).fill('The header moved by 12px')
    await dialog.getByRole('button', { name: 'Reject', exact: true }).click()

    await expect.poll(async () => (await detail()).build.reviewStatus).toBe('rejected')
    const d = await detail()
    expect(d.reviews[0]).toMatchObject({
      state: 'rejected',
      source: 'ui',
      userName: setup.account.name,
    })
    await page.getByText(`Rejected by ${setup.account.name}`).first().waitFor()
    // Only the opposite decision is offered now.
    // (polled: the dialog's own Reject button is still fading out when the banner appears)
    await expect
      .poll(() => page.getByRole('button', { name: 'Reject', exact: true }).count())
      .toBe(0)
    await page.getByRole('button', { name: 'Approve all' }).waitFor()
  })

  it('approving through the UI changes the decision, and a re-run of the commit is approved at once', async () => {
    const { stack, setup } = ctx
    const page = await browser.as(setup.session)
    await page.goto(`${stack.url}/${setup.organization.slug}/${project.slug}/builds/${buildNumber}`)
    await page.getByRole('button', { name: 'Approve all' }).click()

    await expect.poll(async () => (await detail()).build.reviewStatus).toBe('approved')
    expect((await detail()).reviews.map((r) => r.state)).toEqual(['approved', 'rejected'])
    await page.getByText(`Approved by ${setup.account.name}`).first().waitFor()

    // The same commit uploaded again (a CI re-run): its exact screenshots were approved, so the
    // new build is approved at once, by "rerun", and does not block the merge.
    const again = await uploadOrThrow({
      stack,
      token: project.token,
      repo,
      wait: true,
      pr: { number: 12 },
    })
    expect(again.build.number).toBeGreaterThan(buildNumber)
    expect(again.status?.outcome).toMatchObject({ state: 'pass' })
    const rerun = await ctx.setup.session.get<Build.Detail>(
      `/api/projects/${setup.organization.slug}/${project.slug}/builds/${again.build.number}`,
    )
    expect(rerun.build.reviewStatus).toBe('approved')
    expect(rerun.reviews[0]).toMatchObject({ state: 'approved', source: 'rerun' })
    expect(again.exitCode).toBe(0)
  })
})
