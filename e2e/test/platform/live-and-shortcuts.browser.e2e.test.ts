import type { Build } from '@circi/api'
import type { Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { signIn } from '#clients/admin.ts'
import { type PendingBuildFixture, seedPendingBuild } from '#clients/seed-builds.ts'
import { useBrowser, useStack } from '#stack/vitest.ts'

/**
 * Two things only a real browser against the real server can prove: the page updates by itself
 * when something happens outside it (the server's event stream, through the built image), and the
 * personal "Single-key shortcuts" switch really turns the letters off.
 */
describe('live updates and shortcuts', () => {
  const ctx = useStack({ profile: 'default', setup: true })
  const browser = useBrowser()
  let fixture: PendingBuildFixture

  beforeAll(async () => {
    const { stack, setup } = ctx
    fixture = await seedPendingBuild(stack, setup.session, setup.workspace.slug, 'Live app')
  })
  afterAll(async () => {
    await fixture.destroy()
  })

  const detail = () =>
    ctx.setup.session.get<Build.Detail>(
      `/api/projects/${ctx.setup.workspace.slug}/${fixture.project.slug}/builds/${fixture.buildNumber}`,
    )

  /** Opens `path` and returns once the page's event stream is connected. */
  const openLive = async (path: string): Promise<Page> => {
    const { stack, setup } = ctx
    const own = await signIn(stack, setup.account.email, setup.account.password)
    const page = await browser.as(own)
    const connected = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/live')
    await page.goto(`${stack.url}${path}`)
    const stream = await connected
    expect(stream.headers()['content-type']).toContain('text/event-stream')
    return page
  }

  it('a review made from outside shows on the open build page without a reload', async () => {
    const { setup } = ctx
    const page = await openLive(fixture.path)
    await page.getByRole('button', { name: 'Approve this screenshot' }).waitFor()
    // A navigation would reload the page's document: mark it, and check the mark survives.
    await page.evaluate<unknown>('window.stillHere = true')

    // Someone else approves it (the API session, as a CI integration or another reviewer would).
    await setup.session.post(
      `/api/projects/${setup.workspace.slug}/${fixture.project.slug}/builds/${fixture.buildNumber}/review`,
      { state: 'approved' },
    )
    // Well inside the 30 second safety-net poll, so it is the event stream that did it.
    await page.getByText(`Approved by ${setup.account.name}`).first().waitFor({ timeout: 10_000 })
    expect(await page.evaluate<boolean>("'stillHere' in window")).toBe(true)
    expect((await detail()).build.reviewStatus).toBe('approved')
  }, 60_000)

  it('a build uploaded by the CLI appears in the open project page without a reload', async () => {
    const { setup } = ctx
    const page = await openLive(fixture.projectPath)
    await page
      .getByRole('link', { name: new RegExp(`#${fixture.buildNumber}\\b`) })
      .first()
      .waitFor()
    await page.evaluate<unknown>('window.stillHere = true')

    const next = await fixture.uploadAnother(13)
    expect(next).toBeGreaterThan(fixture.buildNumber)
    await page
      .getByRole('link', { name: new RegExp(`#${next}\\b`) })
      .first()
      .waitFor({ timeout: 10_000 })
    expect(await page.evaluate<boolean>("'stillHere' in window")).toBe(true)
    expect(setup.workspace.slug).toBeTruthy()
  }, 90_000)

  it('with single-key shortcuts off the letters do nothing and ⌘K still works; on again, they work', async () => {
    const { stack, setup } = ctx
    // A build of its own that is still pending (the first test approved the other one).
    const pending = await fixture.uploadAnother(14)
    const buildPath = `${fixture.projectPath}/builds/${pending}`
    const status = async () =>
      (
        await setup.session.get<Build.Detail>(
          `/api/projects/${setup.workspace.slug}/${fixture.project.slug}/builds/${pending}`,
        )
      ).build.reviewStatus

    const own = await signIn(stack, setup.account.email, setup.account.password)
    const page = await browser.as(own)
    await page.goto(`${stack.url}/account/shortcuts`)
    const toggle = page.getByRole('switch', { name: 'Single-key shortcuts' })
    await toggle.waitFor()
    await toggle.click()
    await page.getByText('Single-key shortcuts off').first().waitFor()

    await page.goto(`${stack.url}${buildPath}`)
    await page.getByRole('button', { name: 'Approve this screenshot' }).waitFor()
    // The choice is this browser's: it is still off after a full load.
    await page.locator('body').click({ position: { x: 5, y: 5 } })
    await page.keyboard.press('a')
    await page.keyboard.press('j')
    await page.keyboard.press('?')
    // ⌘/Ctrl shortcuts are not single keys: this one opens the menu, and by then the keys
    // before it have been handled (key events arrive in order).
    await page.keyboard.press('Control+k')
    await page.getByRole('combobox').waitFor()
    expect(await status()).toBe('pending')
    await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' }).count()).resolves.toBe(0)
    await page.keyboard.press('Escape')
    await page.getByRole('combobox').waitFor({ state: 'hidden' })

    // Switched on again, the same key approves.
    await page.goto(`${stack.url}/account/shortcuts`)
    await page.getByRole('switch', { name: 'Single-key shortcuts' }).click()
    await page.getByText('Single-key shortcuts on').first().waitFor()
    await page.goto(`${stack.url}${buildPath}`)
    await page.getByRole('button', { name: 'Approve this screenshot' }).waitFor()
    await page.locator('body').click({ position: { x: 5, y: 5 } })
    await page.keyboard.press('a')
    await expect.poll(status, { timeout: 10_000 }).toBe('approved')
  }, 90_000)
})
