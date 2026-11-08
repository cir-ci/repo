import type { Build, Flaky } from '@circi/api'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { approveBuild, createProject, type CreatedProject } from '#src/admin.ts'
import { Repo } from '#src/git-repo.ts'
import { uploadOrThrow } from '#src/upload.ts'
import { useBrowser, useStack } from '#src/vitest.ts'

/**
 * Flaky screenshot detection on the real stack: a screenshot that shows as changed in 3 or more of
 * the last 10 default-branch builds is flagged (API, project page banner, "Flaky" group of a build
 * review); pull request builds never count; the flag goes away when the changes roll out of the
 * window. `wobble` moves to a new spot at every build, `steady` never does.
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

  const org = () => ctx.setup.organization.slug
  const report = () =>
    ctx.setup.session.get<Flaky.Report>(`/api/projects/${org()}/${project.slug}/flaky`)

  /** A build on main; `wobble` moves to a spot it never had, unless `still`. */
  async function mainBuild(options: { still?: boolean } = {}) {
    mainBuilds += 1
    if (mainBuilds > 1) await repo.checkout('main')
    await repo.writeShots({
      steady: { dot: { x: 40, y: 40 } },
      wobble: { dot: { x: options.still ? 370 : 10 + (mainBuilds % 12) * 30, y: 100 } },
    })
    await repo.commit(`main ${mainBuilds}`)
    const up = await uploadOrThrow({ stack: ctx.stack, token: project.token, repo, wait: true })
    // The first build has no baseline and is never approved automatically; later main builds are.
    if (mainBuilds === 1)
      await approveBuild(ctx.setup.session, org(), project.slug, up.build.number)
    return up
  }

  it('twice changed is not flaky yet; the third change flags it, the steady one never', async () => {
    project = await createProject(ctx.setup.session, org(), 'Flicker')
    await mainBuild()
    await mainBuild()
    const third = await mainBuild()
    expect(third.status?.counts).toMatchObject({ changed: 1, unchanged: 1 })
    expect(await report()).toEqual({ builds: 3, flaky: [] })

    const fourth = await mainBuild()
    expect(fourth.status?.counts).toMatchObject({ changed: 1, unchanged: 1 })
    expect(await report()).toEqual({ builds: 4, flaky: [{ name: 'wobble', changedIn: 3 }] })
  })

  it('the project page warns, naming the screenshot and the count but not the steady one', async () => {
    const { stack, setup } = ctx
    const page = await browser.as(setup.session)
    await page.goto(`${stack.url}/${org()}/${project.slug}`)
    const banner = page.getByText('These screenshots keep changing on main:').locator('..')
    await banner.waitFor()
    const text = (await banner.innerText()).replace(/\s+/g, ' ')
    expect(text).toContain('wobble (3 of the last 4 builds)')
    expect(text).toContain('circi admin ignore add')
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
      token: project.token,
      repo,
      wait: true,
      pr: { number: 7 },
    })
    expect(up.status?.counts).toMatchObject({ changed: 2 })
    // The API reports both as changed: "flaky" is the dashboard's grouping, not a status.
    const detail = await setup.session.get<Build.Detail>(
      `/api/projects/${org()}/${project.slug}/builds/${up.build.number}`,
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
    await page.goto(`${stack.url}/${org()}/${project.slug}/builds/${up.build.number}`)
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
    expect(await report()).toEqual({ builds: 4, flaky: [{ name: 'wobble', changedIn: 3 }] })
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

  it('stays flagged through stable builds, and clears only when the changes leave the 10-build window', async () => {
    await mainBuild({ still: true }) // 5th: changed (jumps to the still spot)
    await mainBuild({ still: true }) // 6th: stable
    expect((await report()).flaky).toEqual([{ name: 'wobble', changedIn: 4 }])
    for (let n = 7; n <= 11; n++) {
      // oxlint-disable-next-line no-await-in-loop -- builds are sequential
      await mainBuild({ still: true })
    }
    expect(await report()).toEqual({ builds: 10, flaky: [{ name: 'wobble', changedIn: 4 }] })
    await mainBuild({ still: true }) // build 2 leaves the window
    expect((await report()).flaky).toEqual([{ name: 'wobble', changedIn: 3 }])
    await mainBuild({ still: true }) // build 3 leaves: two changes left
    expect((await report()).flaky).toEqual([])
  })

  it('the project page banner is gone once nothing is flaky', async () => {
    const { stack, setup } = ctx
    const page = await browser.as(setup.session)
    await page.goto(`${stack.url}/${org()}/${project.slug}`)
    await page.getByText('Screenshot builds from CI.').waitFor()
    expect(await page.getByText('keep changing on').count()).toBe(0)
  })
})
