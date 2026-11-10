import type { InstanceAdmin } from '@circi/api'
import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'

import { HealthPage } from '#features/instance/HealthPage.tsx'
import { fakeApi } from '#test/support/fetch.ts'
import { renderPage } from '#test/support/render.tsx'

const show = () => renderPage(<HealthPage />, { route: '/instance/health' })

const finding = (
  over: Pick<InstanceAdmin.Finding, 'id' | 'level' | 'label' | 'detail'> &
    Partial<InstanceAdmin.Finding>,
): InstanceAdmin.Finding => ({ value: null, message: over.detail, fix: null, ...over })

const ROUTES = {
  'GET /api/instance/health/checks': {
    body: {
      warned: true,
      findings: [
        finding({
          id: 'storage',
          level: 'ok',
          label: 'Storage',
          detail: 'Local disk, writable.',
          value: '/var/lib/circi/files',
        }),
        finding({
          id: 'host:acme-sites.io',
          level: 'ok',
          label: 'Sites domain',
          detail: 'Serves nothing at its apex and sets no cookies.',
          value: 'acme-sites.io',
        }),
        finding({
          id: 'host:www.acme.io',
          level: 'warn',
          label: 'Cookies on www.acme.io',
          detail: 'Sets a cookie for the whole domain.',
          value: 'www.acme.io sets _ga with Domain=acme.io',
          fix: 'Make the cookie host-only.',
        }),
        finding({
          id: 'reminder',
          level: 'info',
          label: 'Reminder',
          detail: 'See docs/reference/static-sites.md for the rules.',
        }),
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
          retrying: 0,
          mostRetried: null,
        },
        {
          queue: 'webhook',
          pending: 1,
          running: 0,
          failed: 0,
          oldestPendingAt: '2026-11-08T11:00:00Z',
          retrying: 1,
          mostRetried: { attempt: 3, maxAttempts: 8 },
        },
      ],
    },
  },
  'GET /api/setup': { body: { needed: false } },
  'GET /api/instance/health/address-checklist': {
    body: {
      publicUrl: 'https://ci.acme.io',
      dismissed: false,
      previousHosts: ['circi.acme.dev'],
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
    await expect.element(page.getByText(/How to fix: Make the cookie host-only\./)).toBeVisible()
    // No "everything passes" line: the summary is its three counts.
    expect(document.body.textContent).not.toContain('Everything passes')
    const messages = document.body.textContent ?? ''
    expect(messages.indexOf('Cookies on www.acme.io')).toBeLessThan(
      messages.indexOf('Sites domain'),
    )
    await expect.element(page.getByText('14 waiting · 3 running · 1 failed')).toBeVisible()
    await expect.element(page.getByText(/PUBLIC_URL=https:\/\/ci\.acme\.io/)).toBeVisible()
  })

  it('groups what it finds into sections, each check a row with its badge', async () => {
    fakeApi(ROUTES)
    await show()
    await expect.element(page.getByText('Local disk, writable.')).toBeVisible()
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
    // A row is a label, a detail, a mono value and a badge.
    await expect.element(services.getByText('Storage', { exact: true })).toBeVisible()
    await expect.element(services.getByText('Local disk, writable.')).toBeVisible()
    await expect.element(services.getByText('/var/lib/circi/files')).toBeVisible()
    await expect.element(services.getByText('Passing')).toBeVisible()
    const domains = page.getByRole('region', { name: 'Domains and cookies' })
    await expect
      .element(domains.getByText('www.acme.io sets _ga with Domain=acme.io'))
      .toBeVisible()
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
    await expect.element(summary.getByText('Failing', { exact: true }).first()).toBeVisible()
    const counts = summary
      .getByRole('definition')
      .elements()
      .map((d) => d.textContent)
    // Two checks pass, one needs a look, none fail, and the reminder note is not counted.
    expect(counts).toEqual(['2', 'Passing', '1', 'Check', '0', 'Failing'])
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

  it('shows the background jobs with the oldest waiting and retrying details', async () => {
    fakeApi(ROUTES)
    await show()
    const jobs = page.getByRole('region', { name: 'Background jobs' })
    await expect.element(jobs.getByText('Retrying')).toBeVisible()
    await expect.element(jobs.getByText('webhook · attempt 3 of 8')).toBeVisible()
    const queues = page.getByRole('region', { name: 'Queues' })
    await expect.element(queues.getByText(/1 retrying \(attempt 3 of 8\)/)).toBeVisible()
  })

  it('keeps each queue’s counts on one line', async () => {
    await page.viewport(1440, 900)
    fakeApi(ROUTES)
    await show()
    const queues = page.getByRole('region', { name: 'Queues' })
    const counts = queues.getByText(/waiting · .*running · .*failed/).first()
    await expect.element(counts).toBeVisible()
    const el = counts.element()
    const lineHeight = Number.parseFloat(getComputedStyle(el).lineHeight)
    expect(el.getBoundingClientRect().height).toBeLessThan(lineHeight * 1.5)
    // And a number never parts from its word, even where the row must wrap.
    expect(el.textContent).toMatch(/\d\u00a0waiting · \d\u00a0running · \d\u00a0failed/)
  })

  it('shows no move checklist when no address change is in progress', async () => {
    fakeApi({
      ...ROUTES,
      'GET /api/instance/health/address-checklist': {
        body: { ...ROUTES['GET /api/instance/health/address-checklist'].body, previousHosts: [] },
      },
    })
    await show()
    await expect.element(page.getByRole('region', { name: 'Background jobs' })).toBeVisible()
    expect(page.getByRole('region', { name: /^Moving to/ }).elements()).toHaveLength(0)
    expect(page.getByRole('button', { name: 'Show the move checklist' }).elements()).toHaveLength(0)
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
    await expect.element(page.getByText('Local disk, writable.')).toBeVisible()
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
            finding({ id: 'storage', level: 'fail', label: 'Storage', detail: 'Not usable.' }),
            finding({
              id: 'disk',
              level: 'warn',
              label: 'Disk space',
              detail: 'The storage disk is running low.',
              value: '/data · 1.0 GB free of 8.0 GB (13%)',
              fix: 'Free space.',
            }),
            finding({
              id: 'database',
              level: 'ok',
              label: 'Database',
              detail: 'Reachable. Migrations are current.',
              value: '3 migrations',
            }),
            finding({
              id: 'mail',
              level: 'info',
              label: 'Mail',
              detail: 'Not set up: sign-in codes are off.',
              value: 'SMTP_HOST is not set',
            }),
          ],
        },
      },
    })
    await show()
    const services = page.getByRole('region', { name: 'Services' })
    await expect.element(services.getByText(/The storage disk is running low/)).toBeVisible()
    await expect.element(services.getByText(/Migrations are current/)).toBeVisible()
    await expect.element(services.getByText(/Not set up: sign-in codes are off/)).toBeVisible()
    await expect.element(services.getByText('Check', { exact: true })).toBeVisible()
    await expect.element(services.getByText('Note', { exact: true })).toBeVisible()
    // Failures, then warnings first inside the section.
    const text = services.element().textContent ?? ''
    expect(text.indexOf('Not usable')).toBeLessThan(text.indexOf('running low'))
    expect(text.indexOf('running low')).toBeLessThan(text.indexOf('Migrations are current'))
    // The disk value: its path on top, the free space on the line under it.
    const path = services.getByText('/data', { exact: true }).element().getBoundingClientRect()
    const free = services.getByText('1.0 GB free of 8.0 GB (13%)').element().getBoundingClientRect()
    expect(free.top).toBeGreaterThanOrEqual(path.bottom - 1)
  })

  it('dismisses the move checklist, and brings it back with a link', async () => {
    const api = fakeApi({
      ...ROUTES,
      'PUT /api/instance/health/address-checklist/dismissed': { status: 204 },
      'DELETE /api/instance/health/address-checklist/dismissed': { status: 204 },
    })
    await show()
    await page.getByRole('button', { name: 'Dismiss the move checklist' }).click()
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
