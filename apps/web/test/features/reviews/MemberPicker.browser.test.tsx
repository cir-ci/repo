import { describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'

vi.mock('#lib/auth-client.ts', () =>
  import('#test/support/auth-client.ts').then((m) => m.authClientModule),
)

import { MemberPicker } from '#features/reviews/MemberPicker.tsx'
import { mockAuthClient } from '#test/support/auth-client.ts'
import { renderPage } from '#test/support/render.tsx'

const auth = mockAuthClient().organization

const member = (id: string, name: string) => ({
  id: `m-${id}`,
  userId: id,
  role: 'member',
  user: { name, email: `${id}@example.test` },
})

describe('MemberPicker', () => {
  it('leaves the signed-in user out of the choices and says why', async () => {
    // Ada (u1) is the signed-in user of every page test.
    auth.getFullOrganization.mockResolvedValue({
      data: {
        id: 'o1',
        name: 'Acme',
        slug: 'acme',
        members: [member('u1', 'Ada Lovelace'), member('u2', 'Grace Hopper')],
        invitations: [],
      },
      error: null,
    })
    const onPick = vi.fn<(m: { id: string; name: string }) => void>()
    await renderPage(<MemberPicker workspace="acme" open onOpenChange={() => {}} onPick={onPick} />)
    const dialog = page.getByRole('dialog', { name: 'Request a review from' })
    await expect.element(dialog.getByRole('button', { name: /Grace Hopper/ })).toBeVisible()
    expect(dialog.getByRole('button', { name: /Ada Lovelace/ }).elements()).toHaveLength(0)
    await expect
      .element(dialog.getByText("You can't request a review from yourself."))
      .toBeVisible()
    await dialog.getByRole('button', { name: /Grace Hopper/ }).click()
    expect(onPick).toHaveBeenCalledWith({ id: 'u2', name: 'Grace Hopper' })
  })

  it("offers only the project's members when it is asked for a project", async () => {
    const onPick = vi.fn<(m: { id: string; name: string }) => void>()
    await renderPage(
      <MemberPicker workspace="acme" project="web" open onOpenChange={() => {}} onPick={onPick} />,
      {
        api: {
          'GET /api/projects/acme/web/members': {
            body: {
              members: [
                {
                  id: 'u1',
                  name: 'Ada Lovelace',
                  email: 'a@x.test',
                  image: null,
                  role: 'owner',
                  addedAt: '2026-11-01T00:00:00.000Z',
                },
                {
                  id: 'u3',
                  name: 'Alan Turing',
                  email: 't@x.test',
                  image: null,
                  role: 'member',
                  addedAt: '2026-11-01T00:00:00.000Z',
                },
              ],
              canManage: false,
            },
          },
        },
      },
    )
    const dialog = page.getByRole('dialog', { name: 'Request a review from' })
    await expect.element(dialog.getByRole('button', { name: /Alan Turing/ })).toBeVisible()
    // Grace is in the workspace but not the project: never offered.
    expect(dialog.getByRole('button', { name: /Grace Hopper/ }).elements()).toHaveLength(0)
    await dialog.getByRole('button', { name: /Alan Turing/ }).click()
    expect(onPick).toHaveBeenCalledWith({ id: 'u3', name: 'Alan Turing' })
  })
})
