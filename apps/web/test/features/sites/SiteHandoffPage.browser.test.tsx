import { describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'

import { SiteHandoffPage } from '#features/sites/SiteHandoffPage.tsx'
import { fakeFetch, json, pending } from '#test/support/fetch.ts'
import { renderPage } from '#test/support/render.tsx'

const open = (search: string) =>
  renderPage(<SiteHandoffPage />, { route: '/_sso/site', url: `/_sso/site${search}` })

describe('SiteHandoffPage', () => {
  it('shows that it is opening the site while access is being asked for', async () => {
    const calls = fakeFetch({ 'POST /api/site-handoff': pending })
    await open('?host=acme--web.sites.test&return=%2Fdocs')
    await expect.element(page.getByRole('heading', { name: 'Opening the site…' })).toBeVisible()
    await vi.waitFor(() =>
      expect(calls[0]?.body).toEqual({ label: 'acme--web.sites.test', returnPath: '/docs' }),
    )
  })

  it('is "not found" without an address, and asks for nothing', async () => {
    const calls = fakeFetch({})
    await open('')
    await expect.element(page.getByRole('heading', { name: 'Not found' })).toBeVisible()
    await expect
      .element(page.getByText('This address doesn’t exist, or you don’t have access to it.'))
      .toBeVisible()
    expect(calls).toHaveLength(0)
  })

  it('is the same "not found" when access is refused, with a way back', async () => {
    fakeFetch({ 'POST /api/site-handoff': json({ error: 'nope' }, 404) })
    await open('?host=other.sites.test')
    await expect.element(page.getByRole('heading', { name: 'Not found' })).toBeVisible()
    await expect
      .element(page.getByRole('link', { name: 'Go to teams' }))
      .toHaveAttribute('href', '/')
  })
})
