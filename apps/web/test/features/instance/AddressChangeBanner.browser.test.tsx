import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'

import { AddressChangeBanner } from '#features/instance/AddressChangeBanner.tsx'
import { fakeFetch } from '#test/support/fetch.ts'
import { renderPage } from '#test/support/render.tsx'

const change = {
  from: 'https://old.example.com',
  to: 'https://ci.example.com',
  at: '2026-11-01T00:00:00Z',
  checklist: ['Update the GitHub app’s webhook URL', 'Update CIRCI_API_URL in CI'],
}

describe('AddressChangeBanner', () => {
  it('renders nothing when the address has not changed', async () => {
    fakeFetch({ 'GET /api/instance/notices': { publicUrlChange: null } })
    await renderPage(<AddressChangeBanner />)
    await expect.element(page.getByRole('status')).not.toBeInTheDocument()
  })

  it('lists what is left to do after the move', async () => {
    fakeFetch({ 'GET /api/instance/notices': { publicUrlChange: change } })
    await renderPage(<AddressChangeBanner />)
    await expect
      .element(
        page.getByText(
          'The dashboard moved from https://old.example.com to https://ci.example.com.',
        ),
      )
      .toBeVisible()
    expect(page.getByRole('listitem').elements()).toHaveLength(2)
  })

  it('goes away once marked done', async () => {
    let notices: { publicUrlChange: typeof change | null } = { publicUrlChange: change }
    const calls = fakeFetch({
      'GET /api/instance/notices': () => notices,
      'POST /api/instance/notices/public-url/dismiss': () => {
        notices = { publicUrlChange: null }
        return new Response(null, { status: 204 })
      },
    })
    await renderPage(<AddressChangeBanner />)
    await page.getByRole('button', { name: 'Done' }).click()
    await expect.element(page.getByRole('status')).not.toBeInTheDocument()
    expect(calls.some((c) => c.method === 'POST')).toBe(true)
  })
})
