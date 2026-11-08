import { AnnouncerProvider } from '@circi/ui'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'

const auth = vi.hoisted(() => ({ inviteMember: vi.fn<(arg: unknown) => Promise<unknown>>() }))
vi.mock('#lib/auth-client.ts', () => ({ authClient: { organization: auth } }))

import { InviteForm } from '#features/members/InviteForm.tsx'
import { renderPage } from '#test/support/render.tsx'

const show = (onInvited = vi.fn<() => Promise<unknown>>(async () => {})) =>
  renderPage(
    <AnnouncerProvider>
      <InviteForm workspaceId="workspace1" onInvited={onInvited} />
    </AnnouncerProvider>,
  ).then(() => onInvited)

beforeEach(() => vi.resetAllMocks())

describe('InviteForm', () => {
  it('sends the address and the chosen role, clears the field, and says it was sent', async () => {
    await page.viewport(1000, 800)
    auth.inviteMember.mockResolvedValue({ data: {}, error: null })
    const onInvited = await show()
    await page.getByRole('textbox', { name: 'Email' }).fill('  ada@example.test ')
    await page.getByRole('combobox', { name: 'Role' }).click()
    await page.getByRole('option', { name: 'Admin' }).click()
    await page.getByRole('button', { name: 'Send invitation' }).click()
    expect(auth.inviteMember).toHaveBeenCalledWith({
      email: 'ada@example.test',
      role: 'admin',
      organizationId: 'workspace1',
    })
    await expect.element(page.getByText('Invitation sent to ada@example.test.')).toBeVisible()
    await expect.element(page.getByRole('textbox', { name: 'Email' })).toHaveValue('')
    expect(onInvited).toHaveBeenCalledTimes(1)
  })

  it('defaults to a member', async () => {
    await page.viewport(1000, 800)
    await show()
    await expect.element(page.getByRole('combobox', { name: 'Role' })).toHaveTextContent('Member')
  })

  it('asks for an address instead of sending an empty form', async () => {
    await page.viewport(1000, 800)
    await show()
    await page.getByRole('button', { name: 'Send invitation' }).click()
    await expect.element(page.getByText('Enter an email address')).toBeVisible()
    await expect.element(page.getByRole('textbox', { name: 'Email' })).toBeInvalid()
    expect(auth.inviteMember).not.toHaveBeenCalled()
  })

  it('refuses something that is not an address, and clears the message when typing', async () => {
    await page.viewport(1000, 800)
    await show()
    const email = page.getByRole('textbox', { name: 'Email' })
    await email.fill('ada')
    await page.getByRole('button', { name: 'Send invitation' }).click()
    await expect.element(page.getByText('That doesn’t look like an email address')).toBeVisible()
    await email.fill('ada@example.test')
    expect(page.getByText('That doesn’t look like an email address').elements()).toHaveLength(0)
  })

  it('shows the server’s reason and keeps the address when sending fails', async () => {
    await page.viewport(1000, 800)
    auth.inviteMember.mockResolvedValue({ data: null, error: { message: 'Already a member' } })
    const onInvited = await show()
    await page.getByRole('textbox', { name: 'Email' }).fill('ada@example.test')
    await page.getByRole('button', { name: 'Send invitation' }).click()
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
    await page.getByRole('button', { name: 'Send invitation' }).click()
    await expect
      .element(page.getByRole('button', { name: 'Sending…' }))
      .toHaveAttribute('aria-busy', 'true')
  })
})
