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
        { id: 'storage', level: 'ok', message: 'Storage (disk) is writable.', fix: null },
        { id: 'host:acme-sites.io', level: 'ok', message: 'acme-sites.io: no cookies.', fix: null },
        {
          id: 'host:www.acme.io',
          level: 'warn',
          message: 'www.acme.io sets a cookie for the whole domain.',
          fix: 'Make the cookie host-only.',
        },
        {
          id: 'reminder',
          level: 'info',
          message: 'See docs/reference/static-sites.md for the rules.',
          fix: null,
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
  'GET /api/setup': { body: { needed: false } },
  'GET /api/instance/health/address-checklist': {
    body: {
      publicUrl: 'https://ci.acme.io',
      dismissed: false,
      steps: [
        {
          id: 'dns',
          title: 'Point DNS and TLS at CirCI',
          detail: 'Keep the old address redirecting.',
          values: ['PUBLIC_URL=https://ci.acme.io', 'PREVIOUS_PUBLIC_URLS=circi.acme.dev'],
        },
        { id: 'sessions', title: 'People sign in again once', detail: 'Cookies.', values: [] },
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
    const messages = document.body.textContent ?? ''
    expect(messages.indexOf('www.acme.io sets')).toBeLessThan(messages.indexOf('acme-sites.io: no'))
    await expect.element(page.getByText('14 waiting · 3 running · 1 failed')).toBeVisible()
    await expect.element(page.getByText(/PUBLIC_URL=https:\/\/ci\.acme\.io/)).toBeVisible()
  })

  it('groups what it finds into sections, each check a row with its badge', async () => {
    fakeApi(ROUTES)
    await show()
    await expect.element(page.getByText('Storage (disk) is writable.')).toBeVisible()
    const sections = page.getByRole('heading', { level: 2 }).elements()
    expect(sections.map((h) => h.textContent)).toEqual([
      'Summary',
      'Services',
      'Domains and cookies',
      'Moving to ci.acme.io',
      'Background jobs',
      'Queues',
      'Setup code',
    ])
    const services = page.getByRole('region', { name: 'Services' })
    await expect.element(services.getByText('Storage (disk) is writable.')).toBeVisible()
    await expect.element(services.getByText('Passing')).toBeVisible()
    const domains = page.getByRole('region', { name: 'Domains and cookies' })
    await expect.element(domains.getByText('www.acme.io', { exact: true })).toBeVisible()
    await expect.element(domains.getByText('Check', { exact: true })).toBeVisible()
    await expect.element(domains.getByText('Passing')).toBeVisible()
    // The page says its own piece about cookies; the developer path in the doctor's reminder is gone.
    expect(document.body.textContent).not.toContain('docs/reference')
    await expect.element(domains.getByText(/may live on the sites domain/)).toBeVisible()
  })

  it('summarises the checks as counts with their badges', async () => {
    fakeApi(ROUTES)
    await show()
    const summary = page.getByRole('region', { name: 'Summary' })
    await expect.element(summary.getByText('Need a look')).toBeVisible()
    const counts = summary
      .getByRole('definition')
      .elements()
      .map((d) => d.textContent)
    // Two checks pass, one needs a look, and the reminder note is not counted.
    expect(counts).toEqual(['2', 'Passing', '1', 'Check', '0', 'Note'])
  })

  it('turns the move into numbered steps, Done where the configuration shows it', async () => {
    fakeApi(ROUTES)
    await show()
    const move = page.getByRole('region', { name: 'Moving to ci.acme.io' })
    await expect.element(move.getByText('Point DNS and TLS at CirCI')).toBeVisible()
    await expect.element(move.getByText('Done', { exact: true })).toBeVisible()
    await expect.element(move.getByText('To do', { exact: true })).toBeVisible()
    await expect.element(move.getByText('1', { exact: true })).toBeVisible()
    await expect.element(move.getByText('2', { exact: true })).toBeVisible()
  })

  it('shows whether the setup page is still open', async () => {
    fakeApi({ ...ROUTES, 'GET /api/setup': { body: { needed: true } } })
    await show()
    const setup = page.getByRole('region', { name: 'Setup code' })
    await expect.element(setup.getByText('open', { exact: true })).toBeVisible()
    await expect.element(setup.getByText('Not set up')).toBeVisible()
  })

  it('runs the checks again when asked', async () => {
    const fake = fakeApi(ROUTES)
    await show()
    await expect.element(page.getByText('Storage (disk) is writable.')).toBeVisible()
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

  it('lists Mail, Database and Disk with the storage check under Services, each with a badge', async () => {
    fakeApi({
      ...ROUTES,
      'GET /api/instance/health/checks': {
        body: {
          warned: true,
          findings: [
            { id: 'storage', level: 'ok', message: 'Storage (fs) is writable.', fix: null },
            {
              id: 'disk',
              level: 'warn',
              message: 'Storage disk is running low: 1.0 GB free of 8.0 GB (13%).',
              fix: 'Free space.',
            },
            {
              id: 'database',
              level: 'ok',
              message: 'The database is reachable and all 3 migrations are applied.',
              fix: null,
            },
            {
              id: 'mail',
              level: 'info',
              message: 'Mail is not set up (SMTP_HOST is not set).',
              fix: null,
            },
          ],
        },
      },
    })
    await show()
    const services = page.getByRole('region', { name: 'Services' })
    await expect.element(services.getByText(/Storage disk is running low/)).toBeVisible()
    await expect.element(services.getByText(/all 3 migrations are applied/)).toBeVisible()
    await expect.element(services.getByText(/Mail is not set up/)).toBeVisible()
    await expect.element(services.getByText('Check', { exact: true })).toBeVisible()
    await expect.element(services.getByText('Note', { exact: true })).toBeVisible()
    // Warnings first inside the section.
    const text = services.element().textContent ?? ''
    expect(text.indexOf('running low')).toBeLessThan(text.indexOf('Storage (fs)'))
  })

  it('dismisses the move checklist, and brings it back with a link', async () => {
    const api = fakeApi({
      ...ROUTES,
      'PUT /api/instance/health/address-checklist/dismissed': { status: 204 },
      'DELETE /api/instance/health/address-checklist/dismissed': { status: 204 },
    })
    await show()
    await page.getByRole('button', { name: 'Dismiss' }).click()
    await expect.poll(() => api.of('PUT')).toHaveLength(1)

    api.set('GET /api/instance/health/address-checklist', {
      body: { ...ROUTES['GET /api/instance/health/address-checklist'].body, dismissed: true },
    })
    await page.getByRole('button', { name: 'Run checks again' }).click()
    await expect
      .element(page.getByRole('button', { name: 'Show the move checklist' }))
      .toBeVisible()
    expect(page.getByRole('region', { name: 'Moving to ci.acme.io' }).elements()).toHaveLength(0)

    api.set('GET /api/instance/health/address-checklist', {
      body: ROUTES['GET /api/instance/health/address-checklist'].body,
    })
    await page.getByRole('button', { name: 'Show the move checklist' }).click()
    await expect.poll(() => api.of('DELETE')).toHaveLength(1)
    await expect.element(page.getByRole('region', { name: 'Moving to ci.acme.io' })).toBeVisible()
  })
})
