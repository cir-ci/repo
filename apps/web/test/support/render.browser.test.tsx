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
    route: '/$org/$project',
    url: '/acme/web?x=1',
    announcer: true,
  })
  await expect.element(page.getByRole('heading', { name: 'Params' })).toBeVisible()
  expect(router.state.location.pathname).toBe('/acme/web')
  await expect.element(page.getByRole('status')).toBeInTheDocument()
})
