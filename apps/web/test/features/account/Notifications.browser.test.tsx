import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'

import { AppearancePage } from '#features/account/AppearancePage.tsx'
import { NotificationsPage } from '#features/account/NotificationsPage.tsx'
import { fakeApi } from '#test/support/fetch.ts'
import { renderPage } from '#test/support/render.tsx'

const PATH = '/api/inbox/preferences'
const MAIL = { body: { mailConfigured: true } }
const NO_MAIL = { body: { mailConfigured: false } }
const requested = () => page.getByRole('switch', { name: /Review requested/ })
const overdue = () => page.getByRole('switch', { name: /Review overdue/ })

describe('NotificationsPage', () => {
  it('shows the two email kinds as saved', async () => {
    await page.viewport(1000, 800)
    fakeApi({
      [`GET ${PATH}`]: { body: { emailReviewRequested: true, emailReviewOverdue: false } },
      'GET /api/capabilities': MAIL,
    })
    await renderPage(<NotificationsPage />)
    await expect.element(requested()).toBeChecked()
    await expect.element(overdue()).not.toBeChecked()
    expect(page.getByRole('switch').elements()).toHaveLength(2)
  })

  it('saves a switch as it flips, with only that field', async () => {
    await page.viewport(1000, 800)
    let prefs = { emailReviewRequested: true, emailReviewOverdue: false }
    const api = fakeApi({
      [`GET ${PATH}`]: () => ({ body: prefs }),
      'GET /api/capabilities': MAIL,
      [`PUT ${PATH}`]: () => {
        prefs = { ...prefs, emailReviewOverdue: true }
        return { body: prefs }
      },
    })
    await renderPage(<NotificationsPage />)
    await overdue().click()
    await expect.element(overdue()).toBeChecked()
    expect(api.of('PUT')[0]?.body).toEqual({ emailReviewOverdue: true })
  })

  it('says Saved next to the switch once it is saved, with no Save button', async () => {
    await page.viewport(1000, 800)
    fakeApi({
      [`GET ${PATH}`]: { body: { emailReviewRequested: true, emailReviewOverdue: false } },
      'GET /api/capabilities': MAIL,
      [`PUT ${PATH}`]: { body: { emailReviewRequested: true, emailReviewOverdue: true } },
    })
    await renderPage(<NotificationsPage />)
    await overdue().click()
    await expect.element(page.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible()
    expect(page.getByRole('button', { name: /^Save/ }).elements()).toHaveLength(0)
  })

  it('puts the switch back and says why when the save fails', async () => {
    await page.viewport(1000, 800)
    fakeApi({
      [`GET ${PATH}`]: { body: { emailReviewRequested: true, emailReviewOverdue: false } },
      'GET /api/capabilities': MAIL,
      [`PUT ${PATH}`]: { status: 500, body: { error: 'Database is down' } },
    })
    await renderPage(<NotificationsPage />)
    await overdue().click()
    await expect.element(page.getByRole('alert')).toHaveTextContent('Database is down')
    await expect.element(overdue()).not.toBeChecked()
  })

  it('says email is off, with no switches, when the server can’t send mail', async () => {
    await page.viewport(1000, 800)
    fakeApi({
      [`GET ${PATH}`]: { body: { emailReviewRequested: true, emailReviewOverdue: true } },
      'GET /api/capabilities': NO_MAIL,
    })
    await renderPage(<NotificationsPage />)
    await expect.element(page.getByText(/can’t send mail yet/)).toBeVisible()
    expect(page.getByRole('switch').elements()).toHaveLength(0)
  })

  it('lists what always lands in the Inbox, and names the page', async () => {
    await page.viewport(1000, 800)
    fakeApi({
      [`GET ${PATH}`]: { body: { emailReviewRequested: true, emailReviewOverdue: true } },
      'GET /api/capabilities': MAIL,
    })
    await renderPage(<NotificationsPage />)
    await expect.element(page.getByRole('heading', { name: 'In your Inbox' })).toBeVisible()
    await expect.element(page.getByText('Flaky snapshot detected')).toBeVisible()
    await expect.element(page.getByRole('navigation', { name: 'Breadcrumb' })).toBeVisible()
  })
})

describe('AppearancePage', () => {
  it('offers system, light and dark as radio cards and applies the choice', async () => {
    await page.viewport(1000, 800)
    await renderPage(<AppearancePage />)
    const group = page.getByRole('group', { name: 'Theme' })
    await expect.element(group).toBeVisible()
    const dark = page.getByRole('radio', { name: /Dark/ })
    const light = page.getByRole('radio', { name: /Light/ })
    await expect.element(page.getByRole('radio', { name: /System/ })).toBeChecked()
    await dark.click()
    await expect.element(dark).toBeChecked()
    expect(document.documentElement.getAttribute('data-circi-color-scheme')).toBe('dark')
    await light.click()
    await expect.element(light).toBeChecked()
    expect(document.documentElement.getAttribute('data-circi-color-scheme')).toBe('light')
  })

  it('says Saved at once after a choice: there is no Save button for a theme', async () => {
    await page.viewport(1000, 800)
    await renderPage(<AppearancePage />, { announcer: true })
    expect(
      page
        .getByRole('status')
        .filter({ hasText: /^Saved$/ })
        .elements(),
    ).toHaveLength(0)
    await page.getByRole('radio', { name: /Dark/ }).click()
    await expect.element(page.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible()
    expect(page.getByRole('button', { name: /^Save/ }).elements()).toHaveLength(0)
  })
})
