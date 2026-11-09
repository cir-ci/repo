import { AnnouncerProvider } from '@circi/ui'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'

// The auth client is the edge to better-auth: a fake stands in for it.
vi.mock('#lib/auth-client.ts', () =>
  import('#test/support/auth-client.ts').then((m) => m.authClientModule),
)

import { InviteForm } from '#features/members/InviteForm.tsx'
import { mockAuthClient } from '#test/support/auth-client.ts'
import { renderPage } from '#test/support/render.tsx'

const show = (onInvited = vi.fn<() => Promise<unknown>>(async () => {})) =>
  renderPage(
    <AnnouncerProvider>
      <InviteForm workspaceId="workspace1" onInvited={onInvited} />
    </AnnouncerProvider>,
  ).then(() => onInvited)

const auth = mockAuthClient().organization

beforeEach(() => vi.resetAllMocks())

describe('InviteForm', () => {
  it('sends the address and the chosen role, clears the field, and says it was sent', async () => {
    await page.viewport(1000, 800)
    auth.inviteMember.mockResolvedValue({ data: {}, error: null })
    const onInvited = await show()
    await page.getByRole('textbox', { name: 'Email' }).fill('  ada@example.test ')
    await page.getByRole('combobox', { name: 'Role' }).click()
    await page.getByRole('option', { name: 'Admin' }).click()
    await page.getByRole('button', { name: 'Send invite' }).click()
    expect(auth.inviteMember).toHaveBeenCalledWith({
      email: 'ada@example.test',
      role: 'admin',
      organizationId: 'workspace1',
    })
    await expect.element(page.getByText('Invitation sent to ada@example.test.')).toBeVisible()
    await expect.element(page.getByRole('textbox', { name: 'Email' })).toHaveValue('')
    expect(onInvited).toHaveBeenCalledTimes(1)
  })

  it('says it replaced the earlier invitation when the address already had one pending', async () => {
    await page.viewport(1000, 800)
    auth.inviteMember.mockResolvedValue({
      data: { id: 'i2', replaced: true, replacedRole: 'member' },
      error: null,
    })
    await renderPage(
      <AnnouncerProvider>
        <InviteForm workspaceId="workspace1" onInvited={async () => {}} />
      </AnnouncerProvider>,
    )
    await page.getByRole('textbox', { name: 'Email' }).fill('Grace@Example.test')
    await page.getByRole('button', { name: 'Send invite' }).click()
    await expect
      .element(
        page.getByText(
          'Invitation sent to Grace@Example.test. Replaced the earlier invitation (member) to Grace@Example.test; its link no longer works.',
        ),
      )
      .toBeVisible()
  })

  it('does not mention a replacement for a new address', async () => {
    await page.viewport(1000, 800)
    auth.inviteMember.mockResolvedValue({ data: { id: 'i3' }, error: null })
    await renderPage(
      <AnnouncerProvider>
        <InviteForm workspaceId="workspace1" onInvited={async () => {}} />
      </AnnouncerProvider>,
    )
    await page.getByRole('textbox', { name: 'Email' }).fill('ada@example.test')
    await page.getByRole('button', { name: 'Send invite' }).click()
    await expect.element(page.getByText('Invitation sent to ada@example.test.')).toBeVisible()
    expect(page.getByText(/Replaced the earlier/).elements()).toHaveLength(0)
  })

  it('defaults to a member', async () => {
    await page.viewport(1000, 800)
    await show()
    await expect.element(page.getByRole('combobox', { name: 'Role' })).toHaveTextContent('Member')
  })

  it('asks for an address instead of sending an empty form', async () => {
    await page.viewport(1000, 800)
    await show()
    await page.getByRole('button', { name: 'Send invite' }).click()
    await expect.element(page.getByText('Enter an email address')).toBeVisible()
    await expect.element(page.getByRole('textbox', { name: 'Email' })).toBeInvalid()
    expect(auth.inviteMember).not.toHaveBeenCalled()
  })

  it('refuses something that is not an address, and clears the message when typing', async () => {
    await page.viewport(1000, 800)
    await show()
    const email = page.getByRole('textbox', { name: 'Email' })
    await email.fill('ada')
    await page.getByRole('button', { name: 'Send invite' }).click()
    await expect.element(page.getByText('That doesn’t look like an email address')).toBeVisible()
    await email.fill('ada@example.test')
    expect(page.getByText('That doesn’t look like an email address').elements()).toHaveLength(0)
  })

  it('shows the server’s reason and keeps the address when sending fails', async () => {
    await page.viewport(1000, 800)
    auth.inviteMember.mockResolvedValue({ data: null, error: { message: 'Already a member' } })
    const onInvited = await show()
    await page.getByRole('textbox', { name: 'Email' }).fill('ada@example.test')
    await page.getByRole('button', { name: 'Send invite' }).click()
    await expect.element(page.getByRole('alert')).toHaveTextContent('Already a member')
    await expect
      .element(page.getByRole('textbox', { name: 'Email' }))
      .toHaveValue('ada@example.test')
    expect(onInvited).not.toHaveBeenCalled()
  })

  it('shows a busy button while sending', async () => {
    await page.viewport(1000, 800)
    auth.inviteMember.mockReturnValue(new Promise(() => {}))
    await show()
    await page.getByRole('textbox', { name: 'Email' }).fill('ada@example.test')
    await page.getByRole('button', { name: 'Send invite' }).click()
    await expect
      .element(page.getByRole('button', { name: 'Sending…' }))
      .toHaveAttribute('aria-busy', 'true')
  })
})
