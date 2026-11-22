import { expect, it } from 'vitest'
import { page } from 'vitest/browser'

import { deferred, fakeApi } from './fetch.ts'
import { renderPage } from './render.tsx'

it('renders a page at its route inside the theme, query client and router', async () => {
  const { router, queryClient } = await renderPage(<h1>Hello page</h1>, { route: '/hello' })
  await expect.element(page.getByRole('heading', { name: 'Hello page' })).toBeVisible()
  expect(router.state.location.pathname).toBe('/hello')
  expect(queryClient.getDefaultOptions().queries?.retry).toBe(false)
})

it('opens `url` on a route pattern, and can wrap the page in the announcer', async () => {
  const { router } = await renderPage(<h1>Params</h1>, {
    route: '/$workspace/$project',
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
  expect(calls).toEqual([
    { method: 'GET', path: '/api/ping', search: '', href: '/api/ping', body: undefined },
  ])
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

it('holds an answer until released, sends a malformed body as is, and lists the addresses asked', async () => {
  const gate = deferred()
  const fake = fakeApi({
    'GET /api/slow': { body: { ok: true }, holdUntil: gate.promise },
    'GET /api/broken': { status: 200, raw: '{not json' },
  })
  let answered = false
  const slow = fetch('/api/slow?x=1').then((r) => {
    answered = true
    return r.json()
  })
  expect(await (await fetch('/api/broken')).text()).toBe('{not json')
  expect(answered).toBe(false)
  gate.resolve()
  expect(await slow).toEqual({ ok: true })
  expect(fake.urls).toEqual(['/api/slow?x=1', '/api/broken'])
})

it('answers by pattern for what the table does not list, and 404s the rest', async () => {
  fakeApi({}, (call) =>
    call.path.startsWith('/api/items/') ? { body: { id: call.path } } : undefined,
  )
  expect(await (await fetch('/api/items/7')).json()).toEqual({ id: '/api/items/7' })
  expect((await fetch('/api/other')).status).toBe(404)
})

it('renders in the light scheme when asked', async () => {
  await renderPage(<h1>Light</h1>, { mode: 'light' })
  await expect.element(page.getByRole('heading', { name: 'Light' })).toBeVisible()
  expect(document.documentElement.dataset['circiColorScheme']).toBe('light')
})
