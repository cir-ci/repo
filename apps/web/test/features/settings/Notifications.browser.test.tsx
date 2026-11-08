import { afterEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'

import { AppearancePage } from '../../../src/features/settings/AppearancePage.tsx'
import { NotificationsPage } from '../../../src/features/settings/NotificationsPage.tsx'
import { renderPage } from '../../support/render.tsx'
import { fakeApi, restoreFetch } from '../fetch-routes.ts'

afterEach(() => restoreFetch())

const PATH = '/api/inbox/preferences'
const requested = () => page.getByRole('switch', { name: /Review requested/ })
const overdue = () => page.getByRole('switch', { name: /Review overdue/ })

describe('NotificationsPage', () => {
  it('shows the two email kinds as saved', async () => {
    await page.viewport(1000, 800)
    fakeApi({
      [`GET ${PATH}`]: { body: { emailReviewRequested: true, emailReviewOverdue: false } },
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

  it('puts the switch back and says why when the save fails', async () => {
    await page.viewport(1000, 800)
    fakeApi({
      [`GET ${PATH}`]: { body: { emailReviewRequested: true, emailReviewOverdue: false } },
      [`PUT ${PATH}`]: { status: 500, body: { error: 'Database is down' } },
    })
    await renderPage(<NotificationsPage />)
    await overdue().click()
    await expect
      .element(page.getByRole('alert'))
      .toHaveTextContent('Couldn’t save that: Database is down')
    await expect.element(overdue()).not.toBeChecked()
  })
})

describe('AppearancePage', () => {
  it('offers system, light and dark', async () => {
    await page.viewport(1000, 800)
    await renderPage(<AppearancePage />)
    const dark = page.getByRole('button', { name: 'Dark' })
    await expect.element(dark).toBeVisible()
    await dark.click()
    await expect.element(dark).toHaveAttribute('aria-pressed', 'true')
  })
})
