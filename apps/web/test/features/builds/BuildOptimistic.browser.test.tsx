import { beforeEach, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'

import { toastNamed } from '#test/support/toast.ts'

import { detail, fakeBuildApi, renderBuild } from './fake-build-api.tsx'

beforeEach(async () => {
  await page.viewport(1400, 900)
})

describe('Build optimistic updates', () => {
  it('shows an approval before the server answers, and takes it back when the server refuses', async () => {
    const api = fakeBuildApi(detail())
    await renderBuild()
    const held = api.holdPost('/snapshots/review')
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
    const held = api.holdPost('/comments')
    await userEvent.keyboard('{Meta>}{Enter}{/Meta}')
    await expect.element(comments.getByText('Spacing looks off')).toBeVisible()
    expect(api.commentPosts).toEqual([])
    held.refuse()
    await expect.element(toastNamed(/Couldn't add the comment/)).toBeVisible()
    await expect.element(comments.getByText('Spacing looks off')).not.toBeInTheDocument()
  })
})
