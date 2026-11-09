import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'

import { HealthPage } from '#features/instance/HealthPage.tsx'
import { fakeApi } from '#test/support/fetch.ts'
import { renderPage } from '#test/support/render.tsx'

const show = () => renderPage(<HealthPage />, { route: '/instance/health' })

const ROUTES = {
  'GET /api/instance/health/checks': {
    body: {
      warned: true,
      findings: [
        { id: 'db', level: 'ok', message: 'Postgres answers.', fix: null },
        {
          id: 'cookies',
          level: 'warn',
          message: 'www.acme.io sets a cookie for the whole domain.',
          fix: 'Make the cookie host-only.',
        },
      ],
    },
  },
  'GET /api/instance/health/queues': {
    body: {
      queues: [
        {
          queue: 'diff',
          pending: 14,
          running: 3,
          failed: 1,
          oldestPendingAt: '2026-11-08T11:59:18Z',
        },
        { queue: 'webhook', pending: 0, running: 0, failed: 0, oldestPendingAt: null },
      ],
    },
  },
  'GET /api/instance/health/address-checklist': {
    body: {
      publicUrl: 'https://ci.acme.io',
      steps: [
        {
          id: 'dns',
          title: 'Point DNS and TLS at CirCI',
          detail: 'Keep the old address redirecting.',
          values: ['PUBLIC_URL=https://ci.acme.io'],
        },
      ],
    },
  },
}

describe('the health page', () => {
  it('shows warnings first with their fix, the queues and the address checklist', async () => {
    fakeApi(ROUTES)
    await show()
    await expect.element(page.getByRole('heading', { level: 1, name: 'Health' })).toBeVisible()
    await expect.element(page.getByText('1 check needs attention')).toBeVisible()
    await expect.element(page.getByText('How to fix: Make the cookie host-only.')).toBeVisible()
    await expect.element(page.getByText('Check', { exact: true })).toBeVisible()
    await expect.element(page.getByText('Passing')).toBeVisible()
    const messages = document.body.textContent ?? ''
    expect(messages.indexOf('www.acme.io sets')).toBeLessThan(messages.indexOf('Postgres answers'))
    await expect.element(page.getByText('14 waiting · 3 running · 1 failed')).toBeVisible()
    await expect.element(page.getByText('PUBLIC_URL=https://ci.acme.io')).toBeVisible()
  })

  it('runs the checks again when asked', async () => {
    const fake = fakeApi(ROUTES)
    await show()
    await expect.element(page.getByText('Postgres answers.')).toBeVisible()
    const before = fake.calls.filter((c) => c.path.endsWith('/checks')).length
    await page.getByRole('button', { name: 'Run checks again' }).click()
    await expect
      .poll(() => fake.calls.filter((c) => c.path.endsWith('/checks')).length)
      .toBe(before + 1)
  })

  it('says so to someone who is not an instance admin', async () => {
    fakeApi({
      'GET /api/instance/health/checks': { status: 403, body: { error: 'Forbidden' } },
      'GET /api/instance/health/queues': { status: 403, body: { error: 'Forbidden' } },
      'GET /api/instance/health/address-checklist': { status: 403, body: { error: 'Forbidden' } },
    })
    await show()
    await expect.element(page.getByRole('heading', { name: 'Instance admins only' })).toBeVisible()
  })

  it('shows a failed check run next to what did load', async () => {
    fakeApi({
      ...ROUTES,
      'GET /api/instance/health/checks': {
        status: 501,
        body: { error: 'Health checks are not available' },
      },
    })
    await show()
    await expect.element(page.getByText('Health checks are not available')).toBeVisible()
    await expect.element(page.getByText('14 waiting · 3 running · 1 failed')).toBeVisible()
  })
})
