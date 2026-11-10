import type { Build, Flaky } from '@circi/api'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { approveBuild, createTeam, type CreatedTeam } from '#clients/admin.ts'
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
 * it already had on the default branch (3 returns in the last 10 commits, the team default) is
 * flagged (API, team page banner, "Flaky" group of a build review); pull request builds never
 * count; the flag goes away when the returns roll out of the window. `wobble` flips between two
 * spots (A, B, A, B, A), `steady` never moves.
 */
describe('flaky screenshots', () => {
  const ctx = useStack({ profile: 'default', setup: true })
  const browser = useBrowser()
  let repo: Repo
  let team: CreatedTeam
  let mainBuilds = 0

  beforeAll(async () => {
    repo = await Repo.create()
  })
  afterAll(async () => {
    await repo.destroy()
  })

  const workspace = () => ctx.setup.workspace.slug
  const report = () =>
    ctx.setup.session.get<Flaky.Report>(`/api/teams/${workspace()}/${team.slug}/flaky`)

  /** A build on main; `wobble` is at spot A or B (`B` unless `still`, which holds it at A). */
  async function mainBuild(options: { still?: boolean; spot?: 'A' | 'B' } = {}) {
    mainBuilds += 1
    if (mainBuilds > 1) await repo.checkout('main')
    await repo.writeShots({
      steady: { dot: { x: 40, y: 40 } },
      wobble: { dot: { x: options.still || options.spot === 'A' ? 10 : 370, y: 100 } },
    })
    await repo.commit(`main ${mainBuilds}`)
    const up = await uploadOrThrow({ stack: ctx.stack, token: team.token, repo, wait: true })
    // The first build has no baseline and is never approved automatically; later main builds are.
    if (mainBuilds === 1)
      await approveBuild(ctx.setup.session, workspace(), team.slug, up.build.number)
    return up
  }

  it('two returns to an earlier image are not flaky yet; the third flags it, the steady one never', async () => {
    team = await createTeam(ctx.setup.session, workspace(), 'Flicker')
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

  it('the team page warns, naming the screenshot and the count but not the steady one', async () => {
    const { stack, setup } = ctx
    const page = await browser.as(setup.session)
    await page.goto(`${stack.url}/${workspace()}/${team.slug}`)
    const banner = page.getByText('These screenshots are flaky on main:').locator('..')
    await banner.waitFor()
    const text = (await banner.innerText()).replace(/\s+/g, ' ')
    expect(text).toContain('wobble (came back to an earlier image 3 times)')
    expect(text).not.toContain('circi admin ignore add')
    await page.getByRole('link', { name: 'wobble' }).waitFor()
    expect(text).not.toContain('steady')
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
      token: team.token,
      repo,
      wait: true,
      pr: { number: 7 },
    })
    expect(up.status?.counts).toMatchObject({ changed: 2 })
    // The API reports both as changed: "flaky" is the dashboard's grouping, not a status.
    const detail = await setup.session.get<Build.Detail>(
      `/api/teams/${workspace()}/${team.slug}/builds/${up.build.number}`,
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
    await page.goto(`${stack.url}/${workspace()}/${team.slug}/builds/${up.build.number}`)
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
      await uploadOrThrow({ stack, token: team.token, repo, wait: true, pr: { number: 7 } })
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
      token: team.token,
      repo,
      wait: true,
      pr: { number: 8 },
    })
    expect(up.status?.counts).toMatchObject({ changed: 1 })
    expect(up.status?.outcome).toMatchObject({ state: 'fail' })
    expect(up.exitCode).toBe(1)
  })

  it('stays flagged through stable builds, and clears only when the returns leave the 10-commit window', async () => {
    for (let n = 6; n <= 12; n++) {
      // oxlint-disable-next-line no-await-in-loop -- builds are sequential
      await mainBuild({ still: true }) // stable: the image is A every time
    }
    // Builds 3 to 12: the returns at builds 3, 4 and 5 are all still inside.
    expect(await report()).toEqual({ builds: 10, flaky: [flakyWobble(3)] })
    await mainBuild({ still: true }) // build 3 leaves the window: two returns left
    expect((await report()).flaky).toEqual([])
  })

  it('the team page banner is gone once nothing is flaky', async () => {
    const { stack, setup } = ctx
    const page = await browser.as(setup.session)
    await page.goto(`${stack.url}/${workspace()}/${team.slug}`)
    // The team page has loaded once its build list is there.
    await page.getByRole('heading', { name: team.name }).first().waitFor()
    expect(await page.getByText('are flaky on').count()).toBe(0)
  })
})
