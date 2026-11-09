import { beforeEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'

vi.mock('#lib/auth-client.ts', () =>
  import('#test/support/auth-client.ts').then((m) => m.authClientModule),
)

import { RequestReviewDialog } from '#features/builds/RequestReviewDialog.tsx'
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
) {
  const onClose = vi.fn<() => void>()
  const ready = renderPage(
    <RequestReviewDialog open={open} onClose={onClose} workspace="acme" team="web" number={7} />,
    { announcer: true, api: { [ENDPOINT]: reply } },
  )
  return { ready, onClose }
}

const dialog = () => page.getByRole('dialog', { name: 'Request a review' })

describe('RequestReviewDialog', () => {
  it('lists the workspace members with their emails', async () => {
    await show().ready
    await expect.element(dialog().getByRole('button', { name: /Grace Hopper/ })).toBeVisible()
    await expect.element(dialog().getByText('grace@example.test')).toBeVisible()
    expect(
      dialog()
        .getByRole('button', { name: /Lovelace|Hopper|Turing/ })
        .elements(),
    ).toHaveLength(3)
  })

  it('does not load members while closed', async () => {
    await show(undefined, false).ready
    expect(auth.getFullOrganization).not.toHaveBeenCalled()
  })

  it('filters by what is typed and says when no one matches', async () => {
    await show().ready
    const field = dialog().getByRole('textbox', { name: 'Find a member' })
    await field.fill('gra')
    expect(
      dialog()
        .getByRole('button', { name: /Lovelace|Hopper|Turing/ })
        .elements(),
    ).toHaveLength(1)
    await field.fill('nobody-here')
    await expect.element(dialog().getByText('No one matches.')).toBeVisible()
  })

  it('asks the picked member and closes', async () => {
    const { ready, onClose } = show()
    const { calls } = await ready
    await dialog()
      .getByRole('button', { name: /Grace Hopper/ })
      .click()
    await expect
      .poll(() => calls.find((c) => c.method === 'POST')?.body)
      .toEqual({ reviewerId: 'u2' })
    await expect.poll(() => onClose.mock.calls.length).toBe(1)
  })

  it('asks the first match when Enter is pressed in the search field', async () => {
    const { ready, onClose } = show()
    const { calls } = await ready
    await dialog().getByRole('textbox', { name: 'Find a member' }).fill('turing')
    await userEvent.keyboard('{Enter}')
    await expect
      .poll(() => calls.find((c) => c.method === 'POST')?.body)
      .toEqual({ reviewerId: 'u3' })
    await expect.poll(() => onClose.mock.calls.length).toBe(1)
  })

  it('shows the server’s refusal and stays open', async () => {
    const { ready, onClose } = show({ status: 403, body: { error: 'You cannot ask yourself' } })
    await ready
    await dialog()
      .getByRole('button', { name: /Ada Lovelace/ })
      .click()
    await expect.element(dialog().getByRole('alert')).toHaveTextContent('You cannot ask yourself')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('closes with Escape', async () => {
    const { ready, onClose } = show()
    await ready
    await expect.element(dialog()).toBeVisible()
    await userEvent.keyboard('{Escape}')
    await expect.poll(() => onClose.mock.calls.length).toBe(1)
  })
})
