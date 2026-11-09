import { beforeEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'

vi.mock('#lib/auth-client.ts', () =>
  import('#test/support/auth-client.ts').then((m) => m.authClientModule),
)

import { Button } from '@circi/ui'

import { RequestReviewPicker } from '#features/builds/RequestReviewPicker.tsx'
import { mockAuthClient } from '#test/support/auth-client.ts'
import { renderPage } from '#test/support/render.tsx'

const auth = mockAuthClient().organization

const member = (id: string, name: string, email: string) => ({
  id: `m-${id}`,
  userId: id,
  role: 'member',
  user: { name, email },
})

beforeEach(() => {
  auth.getFullOrganization.mockResolvedValue({
    data: {
      id: 'o1',
      name: 'Acme',
      slug: 'acme',
      members: [
        member('u1', 'Ada Lovelace', 'ada@example.test'),
        member('u2', 'Grace Hopper', 'grace@example.test'),
        member('u3', 'Alan Turing', 'alan@example.test'),
      ],
      invitations: [],
    },
    error: null,
  })
})

const ENDPOINT = 'POST /api/teams/acme/web/builds/7/review-requests'

function show(
  reply: { status?: number; body?: unknown } = { status: 201, body: { created: true } },
  open = true,
  events: unknown[] = [],
) {
  const onOpenChange = vi.fn<(open: boolean) => void>()
  const ready = renderPage(
    <RequestReviewPicker
      open={open}
      onOpenChange={onOpenChange}
      trigger={<Button variant="ghost">Request review</Button>}
      workspace="acme"
      team="web"
      number={7}
    />,
    {
      announcer: true,
      api: { [ENDPOINT]: reply, 'GET /api/teams/acme/web/builds/7/activity': { body: { events } } },
    },
  )
  return { ready, onOpenChange }
}

const picker = () => page.getByRole('dialog', { name: 'Request review from' })

describe('RequestReviewPicker', () => {
  it('is a popover headed "Request review from" listing the members, with no search field', async () => {
    await show().ready
    await expect.element(picker().getByText('Request review from').first()).toBeVisible()
    await expect.element(picker().getByRole('button', { name: /Grace Hopper/ })).toBeVisible()
    expect(picker().getByRole('textbox').elements()).toHaveLength(0)
    // Anchored, not a modal: the trigger stays in the page.
    await expect.element(page.getByRole('button', { name: 'Request review' })).toBeVisible()
  })

  it('leaves the signed-in user out and says why', async () => {
    await show().ready
    await expect.element(picker().getByRole('button', { name: /Grace Hopper/ })).toBeVisible()
    // Ada (u1) is the signed-in user of every page test.
    expect(
      picker()
        .getByRole('button', { name: /Ada Lovelace/ })
        .elements(),
    ).toHaveLength(0)
    await expect
      .element(picker().getByText('You can’t request a review from yourself.'))
      .toBeVisible()
  })

  it('does not load members while closed', async () => {
    await show(undefined, false).ready
    expect(auth.getFullOrganization).not.toHaveBeenCalled()
  })

  it('labels someone already asked "Requested" and choosing them does nothing', async () => {
    const { ready, onOpenChange } = show(undefined, true, [
      {
        type: 'review_requested',
        at: '2026-11-01T10:00:00.000Z',
        reviewer: { id: 'u2', name: 'Grace Hopper' },
        by: { id: 'u3', name: 'Alan Turing' },
      },
    ])
    const { calls } = await ready
    const grace = picker().getByRole('button', { name: /Grace Hopper/ })
    await expect.element(grace.getByText('Requested')).toBeVisible()
    expect(
      picker()
        .getByRole('button', { name: /Alan Turing/ })
        .getByText('Requested')
        .elements(),
    ).toHaveLength(0)
    await expect.element(grace).toHaveAttribute('aria-disabled', 'true')
    grace.element().dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 100))
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0)
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('asks the picked member and closes', async () => {
    const { ready, onOpenChange } = show()
    const { calls } = await ready
    await picker()
      .getByRole('button', { name: /Grace Hopper/ })
      .click()
    await expect
      .poll(() => calls.find((c) => c.method === 'POST')?.body)
      .toEqual({ reviewerId: 'u2' })
    await expect.poll(() => onOpenChange.mock.calls.some(([o]) => !o)).toBe(true)
  })

  it('shows the server’s refusal and stays open', async () => {
    const { ready, onOpenChange } = show({
      status: 403,
      body: { error: 'You cannot ask yourself' },
    })
    await ready
    await picker()
      .getByRole('button', { name: /Grace Hopper/ })
      .click()
    await expect.element(picker().getByRole('alert')).toHaveTextContent('You cannot ask yourself')
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
  })

  it('closes with Escape', async () => {
    const { ready, onOpenChange } = show()
    await ready
    await expect.element(picker()).toBeVisible()
    await userEvent.keyboard('{Escape}')
    await expect.poll(() => onOpenChange.mock.calls.some(([o]) => !o)).toBe(true)
  })
})
