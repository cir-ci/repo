import { expect, it } from 'vitest'
import { page } from 'vitest/browser'

import { renderPage } from './render.tsx'

it('renders a page at its route inside the theme, query client and router', async () => {
  const { router, queryClient } = await renderPage(<h1>Hello page</h1>, { route: '/hello' })
  await expect.element(page.getByRole('heading', { name: 'Hello page' })).toBeVisible()
  expect(router.state.location.pathname).toBe('/hello')
  expect(queryClient.getDefaultOptions().queries?.retry).toBe(false)
})

it('opens `url` on a route pattern, and can wrap the page in the announcer', async () => {
  const { router } = await renderPage(<h1>Params</h1>, {
    route: '/$workspace/$team',
    url: '/acme/web?x=1',
    announcer: true,
  })
  await expect.element(page.getByRole('heading', { name: 'Params' })).toBeVisible()
  expect(router.state.location.pathname).toBe('/acme/web')
  await expect.element(page.getByRole('status')).toBeInTheDocument()
})

it('fakes the API before rendering and returns the requests made', async () => {
  const { calls } = await renderPage(<h1>Api</h1>, {
    api: { 'GET /api/ping': { body: { ok: true } } },
    viewport: [800, 600],
  })
  const answer = await fetch('/api/ping')
  expect(await answer.json()).toEqual({ ok: true })
  expect(calls).toEqual([{ method: 'GET', path: '/api/ping', body: undefined }])
  expect(window.innerWidth).toBe(800)
})

it('rejects a request nobody faked, naming it', async () => {
  await expect(fetch('/api/nobody-faked-this')).rejects.toThrow(
    'Unfaked request: GET /api/nobody-faked-this',
  )
  // The setup file fails a test that made one; this test made it on purpose.
  const { takeUnfakedRequests } = await import('./fetch.ts')
  expect(takeUnfakedRequests()).toHaveLength(1)
})
