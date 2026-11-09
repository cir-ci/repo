import { AnnouncerProvider } from '@circi/ui'
import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'

import { EmailDomains } from '#features/workspace-settings/EmailDomains.tsx'
import { fakeFetch, pending as hang } from '#test/support/fetch.ts'
import { renderPage } from '#test/support/render.tsx'

const BASE = '/api/workspaces/acme/domains'
const verified = { id: 'd1', domain: 'acme.test', verified: true }
const pending = {
  id: 'd2',
  domain: 'mail.acme.test',
  verified: false,
  dnsName: '_circi.mail.acme.test',
  dnsValue: 'circi-verify=abc',
}

const show = () =>
  renderPage(
    <AnnouncerProvider>
      <EmailDomains workspace="acme" />
    </AnnouncerProvider>,
  )

describe('EmailDomains', () => {
  it('shows a skeleton while loading', async () => {
    await page.viewport(1000, 800)
    fakeFetch({ [`GET ${BASE}`]: () => hang() })
    await show()
    await expect.element(page.getByRole('heading', { name: 'Email domains' })).toBeVisible()
    expect(document.querySelector('[data-slot="skeleton-list"]')).not.toBeNull()
  })

  it('lists verified domains, and the DNS record for one that is not verified yet', async () => {
    await page.viewport(1000, 800)
    fakeFetch({ [`GET ${BASE}`]: { domains: [verified, pending] } })
    await show()
    await expect.element(page.getByText('acme.test', { exact: true })).toBeVisible()
    await expect.element(page.getByText('Verified')).toBeVisible()
    await expect.element(page.getByText('Not verified')).toBeVisible()
    await expect.element(page.getByText('Add this DNS TXT record, then check:')).toBeVisible()
    await expect.element(page.getByText('_circi.mail.acme.test TXT circi-verify=abc')).toBeVisible()
    // Only the unverified one can be checked.
    expect(page.getByRole('button', { name: 'Check now' }).elements()).toHaveLength(1)
  })

  it('shows just the form when there are no domains', async () => {
    await page.viewport(1000, 800)
    fakeFetch({ [`GET ${BASE}`]: { domains: [] } })
    await show()
    await expect.element(page.getByRole('textbox', { name: 'Domain' })).toBeVisible()
    expect(page.getByRole('button', { name: /^Remove/ }).elements()).toHaveLength(0)
  })

  it('says it could not load, and tries again', async () => {
    await page.viewport(1000, 800)
    let ok = false
    fakeFetch({
      [`GET ${BASE}`]: () =>
        ok ? { domains: [verified] } : Response.json({ error: 'Down for now' }, { status: 500 }),
    })
    await show()
    await expect.element(page.getByRole('alert').getByText(/Down for now/)).toBeVisible()
    ok = true
    await page.getByRole('button', { name: 'Try again' }).click()
    await expect.element(page.getByText('acme.test', { exact: true })).toBeVisible()
  })

  it('adds a domain, clears the field and lists again', async () => {
    await page.viewport(1000, 800)
    let domains = [verified]
    const calls = fakeFetch({
      [`GET ${BASE}`]: () => ({ domains }),
      [`POST ${BASE}`]: () => {
        domains = [...domains, pending]
        return { domain: pending }
      },
    })
    await show()
    await page.getByRole('textbox', { name: 'Domain' }).fill(' mail.acme.test ')
    await page.getByRole('button', { name: 'Add domain' }).click()
    await expect.element(page.getByText('Not verified')).toBeVisible()
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ domain: 'mail.acme.test' })
    await expect.element(page.getByRole('textbox', { name: 'Domain' })).toHaveValue('')
  })

  it('validates the domain before sending', async () => {
    await page.viewport(1000, 800)
    const calls = fakeFetch({ [`GET ${BASE}`]: { domains: [] } })
    await show()
    await page.getByRole('button', { name: 'Add domain' }).click()
    await expect.element(page.getByText('Enter a domain, like example.com')).toBeVisible()
    await page.getByRole('textbox', { name: 'Domain' }).fill('https://acme.test')
    await page.getByRole('button', { name: 'Add domain' }).click()
    await expect.element(page.getByText('Enter just the domain, like example.com')).toBeVisible()
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0)
  })

  it('shows the server’s refusal and keeps what was typed', async () => {
    await page.viewport(1000, 800)
    fakeFetch({
      [`GET ${BASE}`]: { domains: [] },
      [`POST ${BASE}`]: () =>
        Response.json({ error: 'That domain is already claimed' }, { status: 409 }),
    })
    await show()
    await page.getByRole('textbox', { name: 'Domain' }).fill('acme.test')
    await page.getByRole('button', { name: 'Add domain' }).click()
    await expect
      .element(page.getByRole('alert'))
      .toHaveTextContent('That domain is already claimed')
    await expect.element(page.getByRole('textbox', { name: 'Domain' })).toHaveValue('acme.test')
  })

  it('checks a domain, and says when the record is not found yet', async () => {
    await page.viewport(1000, 800)
    const calls = fakeFetch({
      [`GET ${BASE}`]: { domains: [pending] },
      [`POST ${BASE}/d2/verify`]: { verified: false },
    })
    await show()
    await page.getByRole('button', { name: 'Check now' }).click()
    await expect
      .element(page.getByText('Not found yet. DNS can take a few minutes to spread.'))
      .toBeVisible()
    expect(calls.some((c) => c.method === 'POST' && c.path === `${BASE}/d2/verify`)).toBe(true)
  })

  it('shows a domain as verified once the check passes', async () => {
    await page.viewport(1000, 800)
    let done = false
    fakeFetch({
      [`GET ${BASE}`]: () => ({ domains: [done ? { ...pending, verified: true } : pending] }),
      [`POST ${BASE}/d2/verify`]: () => {
        done = true
        return { verified: true }
      },
    })
    await show()
    await page.getByRole('button', { name: 'Check now' }).click()
    await expect.element(page.getByText('Verified')).toBeVisible()
    expect(page.getByText('Not found yet', { exact: false }).elements()).toHaveLength(0)
    expect(page.getByRole('button', { name: 'Check now' }).elements()).toHaveLength(0)
  })

  it('removes a domain only after confirming', async () => {
    await page.viewport(1000, 800)
    let domains = [verified]
    const calls = fakeFetch({
      [`GET ${BASE}`]: () => ({ domains }),
      [`DELETE ${BASE}/d1`]: () => {
        domains = []
        return new Response(null, { status: 204 })
      },
    })
    await show()
    await page.getByRole('button', { name: 'Remove acme.test' }).click()
    const dialog = page.getByRole('alertdialog', { name: 'Remove acme.test?' })
    await expect.element(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false)

    await page.getByRole('button', { name: 'Remove acme.test' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Remove' }).click()
    await expect.element(page.getByRole('alertdialog')).not.toBeInTheDocument()
    await expect.element(page.getByText('Verified')).not.toBeInTheDocument()
    expect(calls.some((c) => c.method === 'DELETE' && c.path === `${BASE}/d1`)).toBe(true)
  })
})
