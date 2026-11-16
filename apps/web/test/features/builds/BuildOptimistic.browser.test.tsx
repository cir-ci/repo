import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'

import { toastNamed } from '#test/support/toast.ts'

import { detail, fakeBuildApi, type FakeApi, renderBuild } from './fake-build-api.tsx'

beforeEach(async () => {
  await page.viewport(1400, 900)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const noop = () => {}

/** Holds back the answer to every POST whose path ends with `suffix` until `release()`, or `refuse()`. */
function holdPost(api: FakeApi, suffix: string) {
  const real = api.fetch.getMockImplementation()
  let release: (answer: 'ok' | 'refused') => void = noop
  const held = new Promise<'ok' | 'refused'>((resolve) => {
    release = resolve
  })
  api.fetch.mockImplementation(async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), 'http://localhost')
    if ((init?.method ?? 'GET') === 'POST' && url.pathname.endsWith(suffix)) {
      if ((await held) === 'refused') {
        return new Response(JSON.stringify({ error: 'Not allowed' }), { status: 500 })
      }
    }
    if (!real) throw new Error('no fake')
    return real(input, init)
  })
  return { release: () => release('ok'), refuse: () => release('refused') }
}

describe('Build optimistic updates', () => {
  it('shows an approval before the server answers, and takes it back when the server refuses', async () => {
    const api = fakeBuildApi(detail())
    await renderBuild()
    const held = holdPost(api, '/snapshots/review')
    await page.getByRole('button', { name: 'Approve this screenshot' }).click()
    // Nothing has answered yet: the count already moved.
    await expect.element(page.getByText('1 of 3 reviewed')).toBeVisible()
    expect(api.reviews).toEqual([])
    held.refuse()
    await expect.element(toastNamed(/Couldn't review the screenshots/)).toBeVisible()
    await expect.element(page.getByText('0 of 3 reviewed')).toBeVisible()
  })

  it('shows a new comment before the server answers, and drops it when the server refuses', async () => {
    const api = fakeBuildApi(detail())
    await renderBuild()
    await expect
      .element(page.getByRole('heading', { level: 2, name: 'checkout / payment' }))
      .toBeVisible()
    await userEvent.keyboard('c')
    const field = page.getByRole('textbox', { name: 'Comment' })
    await field.fill('Spacing looks off')
    const comments = page.getByRole('list', { name: 'Comments' })
    const held = holdPost(api, '/comments')
    await userEvent.keyboard('{Meta>}{Enter}{/Meta}')
    await expect.element(comments.getByText('Spacing looks off')).toBeVisible()
    expect(api.commentPosts).toEqual([])
    held.refuse()
    await expect.element(toastNamed(/Couldn't add the comment/)).toBeVisible()
    await expect.element(comments.getByText('Spacing looks off')).not.toBeInTheDocument()
  })
})
