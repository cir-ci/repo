import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'

import { useRejectReasonRequired } from '#features/projects/api/index.ts'
import { keys } from '#lib/query-keys.ts'
import { fakeFetch } from '#test/support/fetch.ts'
import { gate } from '#test/support/gate.ts'
import { renderPage } from '#test/support/render.tsx'

function Answer() {
  return <p>{useRejectReasonRequired('acme', 'web') ? 'reason required' : 'reason optional'}</p>
}

const settings = (requireRejectReason: boolean) => ({ settings: { requireRejectReason } })

describe('useRejectReasonRequired', () => {
  it('asks for a reason until the settings answer, and then follows them', async () => {
    const held = gate()
    const calls = fakeFetch({ 'GET /api/projects/acme/web/settings': () => held.reply })
    await renderPage(<Answer />)
    await expect.element(page.getByText('reason required')).toBeVisible()
    await expect.poll(() => calls.length).toBe(1)
    held.answer(settings(false))
    await expect.element(page.getByText('reason optional')).toBeVisible()
  })

  it('does not trust settings restored from the stored cache before the refetch answers', async () => {
    const held = gate()
    fakeFetch({ 'GET /api/projects/acme/web/settings': () => held.reply })
    const { queryClient } = await renderPage(<Answer />)
    // What a reload restores: the value from before the project began to require a reason, with
    // the time it was stored (long before this page load).
    queryClient.setQueryData(keys.projectSettings('acme', 'web'), settings(false), {
      updatedAt: Date.now() - 60 * 60 * 1000,
    })
    await expect.element(page.getByText('reason required')).toBeVisible()
    held.answer(settings(true))
    await expect.element(page.getByText('reason required')).toBeVisible()
  })

  it('takes the fetched answer over restored data once it arrives', async () => {
    const held = gate()
    fakeFetch({ 'GET /api/projects/acme/web/settings': () => held.reply })
    const { queryClient } = await renderPage(<Answer />)
    queryClient.setQueryData(keys.projectSettings('acme', 'web'), settings(true), {
      updatedAt: Date.now() - 60 * 60 * 1000,
    })
    held.answer(settings(false))
    await expect.element(page.getByText('reason optional')).toBeVisible()
  })
})
