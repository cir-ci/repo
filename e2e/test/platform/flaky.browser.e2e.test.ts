import type { Build, Flaky } from '@circi/api'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { approveBuild, createProject, type CreatedProject } from '#clients/admin.ts'
import { uploadOrThrow } from '#clients/upload.ts'
import { Repo } from '#github/git-repo.ts'
import { useBrowser, useStack } from '#stack/vitest.ts'

const flakyWobble = (changedIn: number) => ({
  name: 'wobble',
  changedIn,
  reason: expect.objectContaining({
    kind: 'flip_flop',
    flipFlop: expect.objectContaining({ count: 3, threshold: 3 }),
  }),
})

/**
 * Flaky screenshot detection on the real stack: a screenshot whose image keeps coming back to one
 * it already had on the default branch (3 returns in the last 10 commits, the project default) is
 * flagged (API, project page banner, "Flaky" group of a build review); pull request builds never
 * count; the flag goes away when the returns roll out of the window. `wobble` flips between two
 * spots (A, B, A, B, A), `steady` never moves.
 */
describe('flaky screenshots', () => {
  const ctx = useStack({ profile: 'default', setup: true })
  const browser = useBrowser()
  let repo: Repo
  let project: CreatedProject
  let mainBuilds = 0

  beforeAll(async () => {
    repo = await Repo.create()
  })
  afterAll(async () => {
    await repo.destroy()
  })

  const workspace = () => ctx.setup.workspace.slug
  const report = () =>
    ctx.setup.session.get<Flaky.Report>(`/api/projects/${workspace()}/${project.slug}/flaky`)

  /** A build on main; `wobble` is at spot A or B (`B` unless `still`, which holds it at A). */
  async function mainBuild(options: { still?: boolean; spot?: 'A' | 'B' } = {}) {
    mainBuilds += 1
    if (mainBuilds > 1) await repo.checkout('main')
    await repo.writeShots({
      steady: { dot: { x: 40, y: 40 } },
      wobble: { dot: { x: options.still || options.spot === 'A' ? 10 : 370, y: 100 } },
    })
    await repo.commit(`main ${mainBuilds}`)
    const up = await uploadOrThrow({ stack: ctx.stack, token: project.token, repo, wait: true })
    // The first build has no baseline and is never approved automatically; later main builds are.
    if (mainBuilds === 1)
      await approveBuild(ctx.setup.session, workspace(), project.slug, up.build.number)
    return up
  }

  it('two returns to an earlier image are not flaky yet; the third flags it, the steady one never', async () => {
    project = await createProject(ctx.setup.session, workspace(), 'Flicker')
    await mainBuild({ spot: 'A' })
    // A redesign (B, then C) never counts: only coming back does.
    const second = await mainBuild({ spot: 'B' })
    expect(second.status?.counts).toMatchObject({ changed: 1, unchanged: 1 })
    await mainBuild({ spot: 'A' })
    await mainBuild({ spot: 'B' })
    expect(await report()).toEqual({ builds: 4, flaky: [] })

    const fifth = await mainBuild({ spot: 'A' })
    expect(fifth.status?.counts).toMatchObject({ changed: 1, unchanged: 1 })
    expect(await report()).toEqual({ builds: 5, flaky: [flakyWobble(4)] })
  })

  it('the project page warns with the count and a way to Triage, counting only the wobbling one', async () => {
    const { stack, setup } = ctx
    const page = await browser.as(setup.session)
    await page.goto(`${stack.url}/${workspace()}/${project.slug}`)
    // One line: "1 flaky screenshot" (not the steady one) and "Open Triage"; the names are in Triage.
    await page.getByText('1 flaky screenshot', { exact: true }).waitFor()
    await page.getByRole('link', { name: 'Open Triage' }).waitFor()
    expect(await page.getByText('2 flaky screenshots').count()).toBe(0)
  })

  it('a pull request build lists it in the Flaky group, apart from the real change, and the viewer renders it', async () => {
    const { stack, setup } = ctx
    await repo.checkout('feature', { create: true })
    await repo.writeShots({
      steady: { dot: { x: 300, y: 200 } },
      wobble: { dot: { x: 350, y: 250 } },
    })
    await repo.commit('feature change')
    const up = await uploadOrThrow({
      stack,
      token: project.token,
      repo,
      wait: true,
      pr: { number: 7 },
    })
    expect(up.status?.counts).toMatchObject({ changed: 2 })
    // The API reports both as changed: "flaky" is the dashboard's grouping, not a status.
    const detail = await setup.session.get<Build.Detail>(
      `/api/projects/${workspace()}/${project.slug}/builds/${up.build.number}`,
    )
    expect(
      detail.diffs
        .map((d) => [d.name, d.status])
        .toSorted((a, b) => String(a[0]).localeCompare(String(b[0]))),
    ).toEqual([
      ['steady', 'changed'],
      ['wobble', 'changed'],
    ])

    const page = await browser.as(setup.session)
    await page.goto(`${stack.url}/${workspace()}/${project.slug}/builds/${up.build.number}`)
    const list = page.getByRole('navigation', { name: 'Screenshots' })
    await list.waitFor()
    await list.getByRole('button', { name: /^Changed/ }).waitFor()
    const flakyGroup = list.getByRole('button', { name: /^Flaky/ })
    await flakyGroup.waitFor()
    expect(await flakyGroup.innerText()).toContain('1')
    expect(await list.getByRole('link', { name: /steady/ }).count()).toBe(1)
    // Flaky starts collapsed.
    expect(await list.getByRole('link', { name: /wobble/ }).count()).toBe(0)
    await flakyGroup.click()
    await list.getByRole('link', { name: /wobble/ }).click()
    await page.waitForURL(/shot=wobble/)
    await expect
      .poll(() =>
        page.evaluate<number>(
          '[...document.images].filter((i) => i.complete && i.naturalWidth > 0).length',
        ),
      )
      .toBeGreaterThan(0)
  })

  it('pull request builds do not make a screenshot flaky', async () => {
    const { stack } = ctx
    for (let i = 0; i < 4; i++) {
      // oxlint-disable-next-line no-await-in-loop -- builds are sequential
      await repo.writeShots({ steady: { dot: { x: 100 + i * 40, y: 200 } } })
      // oxlint-disable-next-line no-await-in-loop
      await repo.commit(`feature ${i}`)
      // oxlint-disable-next-line no-await-in-loop
      await uploadOrThrow({ stack, token: project.token, repo, wait: true, pr: { number: 7 } })
    }
    expect(await report()).toEqual({ builds: 5, flaky: [flakyWobble(4)] })
  })

  it('flaky is a hint, not an exemption: a change to only the flaky screenshot still blocks the merge', async () => {
    const { stack } = ctx
    await repo.checkout('main')
    await repo.checkout('feature-2', { create: true })
    await repo.writeShots({ wobble: { dot: { x: 330, y: 270 } } })
    await repo.commit('only the flaky one changes')
    const up = await uploadOrThrow({
      stack,
      token: project.token,
      repo,
      wait: true,
      pr: { number: 8 },
    })
    expect(up.status?.counts).toMatchObject({ changed: 1 })
    expect(up.status?.outcome).toMatchObject({ state: 'fail' })
    expect(up.exitCode).toBe(1)
  })

  it('stays flagged through stable builds, and clears once the first returns leave the 10-commit window', async () => {
    for (let n = 6; n <= 10; n++) {
      // oxlint-disable-next-line no-await-in-loop -- builds are sequential
      await mainBuild({ still: true }) // stable: the image is A every time
    }
    // Builds 1 to 10: the returns at builds 3, 4 and 5 are all inside, and so are the images they
    // went back to (a return only counts when the earlier image is in the window too).
    expect(await report()).toEqual({ builds: 10, flaky: [flakyWobble(4)] })
    await mainBuild({ still: true }) // build 1 leaves the window: the return at 3 has nothing to go back to
    expect((await report()).flaky).toEqual([])
  })

  it('the project page banner is gone once nothing is flaky', async () => {
    const { stack, setup } = ctx
    const page = await browser.as(setup.session)
    await page.goto(`${stack.url}/${workspace()}/${project.slug}`)
    // The project page has loaded once its build list is there.
    await page.getByRole('heading', { name: project.name }).first().waitFor()
    expect(await page.getByText('are flaky on').count()).toBe(0)
  })
})
