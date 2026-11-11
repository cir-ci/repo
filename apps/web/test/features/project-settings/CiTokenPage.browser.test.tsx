import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'

import { CiTokenPage } from '#features/project-settings/CiTokenPage.tsx'
import { fakeApi } from '#test/support/fetch.ts'
import { renderPage } from '#test/support/render.tsx'

const API = '/api/projects/acme/web'

const info = (over: Record<string, unknown> = {}) => ({
  canManage: true,
  hint: 'circi_AbC1…',
  createdAt: new Date(Date.now() - 3_600_000).toISOString(),
  createdBy: { id: 'u1', name: 'Dana Levi' },
  lastUsedAt: new Date(Date.now() - 240_000).toISOString(),
  ...over,
})

const settings = (link: unknown = null) => ({
  canManage: true,
  settings: { name: 'Web App' },
  appearance: { color: 'slate', icon: null },
  workspace: { flakyBlocksMerge: true },
  webhooks: [],
  webhookEvents: [],
  github: { configured: true, webhookUrl: '', link },
  sitesConfigured: false,
})

function api(token = info(), settingsBody: unknown = settings(), extra = {}) {
  return fakeApi({
    [`GET ${API}/settings`]: { body: settingsBody },
    [`GET ${API}/token`]: { body: token },
    ...extra,
  })
}

const show = () =>
  renderPage(<CiTokenPage />, {
    route: '/$workspace/$project/settings/token',
    url: '/acme/web/settings/token',
    announcer: true,
    otherRoutes: ['/$workspace/$project', '/$workspace/$project/settings'],
  })

describe('CiTokenPage', () => {
  it("shows the token's hint, who made it and when it was last used", async () => {
    api()
    await show()
    await expect.element(page.getByText('circi_AbC1…')).toBeVisible()
    await expect.element(page.getByText(/by Dana Levi/)).toBeVisible()
    await expect.element(page.getByText('4 minutes ago')).toBeVisible()
    expect(document.title).toBe('CI token · web · CirCI')
  })

  it('lays Token, Created and Last used out as a key column and values', async () => {
    api()
    await show()
    await expect.element(page.getByText('Last used', { exact: true })).toBeVisible()
    const keys = ['Token', 'Created', 'Last used'].map(
      (k) => page.getByText(k, { exact: true }).element().getBoundingClientRect().width,
    )
    expect(new Set(keys).size).toBe(1)
  })

  it('puts the rotate note under the box and the code sample before the exit codes', async () => {
    api()
    await show()
    await expect.element(page.getByText(/Rotating makes a new token/)).toBeVisible()
    await expect.element(page.getByText('Upload or processing error.')).toBeVisible()
    const note = page.getByText(/Rotating makes a new token/).element()
    const box = page.getByText('Last used', { exact: true }).element()
    expect(note.getBoundingClientRect().top).toBeGreaterThan(box.getBoundingClientRect().bottom)
    const code = page.getByLabelText('CI configuration').element()
    const exit = page.getByText('Upload or processing error.').element()
    expect(code.getBoundingClientRect().bottom).toBeLessThan(exit.getBoundingClientRect().top)
  })

  it('shows the whole code sample: as tall as its lines, nothing clipped', async () => {
    api()
    await show()
    await expect.element(page.getByText(/npx circi upload/)).toBeVisible()
    const code = page.getByLabelText('CI configuration').element()
    // Four lines (token, address, a blank line, the command): no vertical clipping.
    expect(code.scrollHeight).toBeLessThanOrEqual(code.clientHeight + 1)
    const lineHeight = Number.parseFloat(getComputedStyle(code).lineHeight)
    expect(code.clientHeight).toBeGreaterThanOrEqual(lineHeight * 4)
  })

  it('says when the token was never used', async () => {
    api(info({ lastUsedAt: null }))
    await show()
    await expect.element(page.getByText('Not used yet')).toBeVisible()
  })

  it('explains CI usage and the exit codes', async () => {
    api()
    await show()
    await expect.element(page.getByRole('heading', { name: 'Use it in CI' })).toBeVisible()
    await expect.element(page.getByText(/npx circi upload/)).toBeVisible()
    await expect.element(page.getByText('Upload or processing error.')).toBeVisible()
  })

  it('says the check is the gate when the project is linked to a repository', async () => {
    api(info(), settings({ installationId: '1', repoRef: 'acme/web', attention: null }))
    await show()
    await expect.element(page.getByText(/is linked to/)).toBeVisible()
    await expect
      .element(page.getByText(/so the CirCI check on the pull request is the gate/))
      .toBeVisible()
  })

  it('rotates only after confirming, and shows the new token once with a copy button', async () => {
    const fake = api(info(), settings(), {
      [`POST ${API}/token`]: {
        body: { token: 'circi_brand_new', info: info({ hint: 'circi_Zz9y…', lastUsedAt: null }) },
      },
    })
    await show()
    await page.getByRole('button', { name: 'Rotate token' }).click()
    const dialog = page.getByRole('alertdialog', { name: 'Rotate the CI token?' })
    await expect.element(dialog).toBeVisible()
    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect.element(dialog).not.toBeInTheDocument()
    expect(fake.of('POST')).toHaveLength(0)
    await page.getByRole('button', { name: 'Rotate token' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Rotate token' }).click()
    await expect.element(page.getByText('circi_brand_new')).toBeVisible()
    await expect.element(page.getByRole('button', { name: 'Copy CI token' })).toBeVisible()
    await expect.element(page.getByText('circi_Zz9y…')).toBeVisible()
    expect(fake.of('POST')).toHaveLength(1)
  })

  it("shows the server's refusal to rotate", async () => {
    api(info(), settings(), {
      [`POST ${API}/token`]: { status: 500, body: { error: 'could not issue a token' } },
    })
    await show()
    await page.getByRole('button', { name: 'Rotate token' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Rotate token' }).click()
    await expect.element(page.getByRole('alert')).toHaveTextContent('could not issue a token')
  })

  it("sends members to the project's settings hub instead of showing the token", async () => {
    api(info({ canManage: false }), { ...settings(), canManage: false })
    const { router } = await show()
    await expect.poll(() => router.state.location.pathname).toBe('/acme/web/settings')
    expect(page.getByText('circi_AbC1…').elements()).toHaveLength(0)
  })

  it('shows a failed load and retries', async () => {
    const fake = api()
    fake.set(`GET ${API}/token`, { status: 500, body: { error: 'db down' } })
    await show()
    await expect.element(page.getByText('db down')).toBeVisible()
    fake.set(`GET ${API}/token`, { body: info() })
    await page.getByRole('button', { name: 'Try again' }).click()
    await expect.element(page.getByText('circi_AbC1…')).toBeVisible()
  })
})
