import { afterEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'

import { InvitationBanner } from '#features/auth/InvitationBanner.tsx'
import { fakeFetch, json, pending } from '#test/support/fetch.ts'
import { renderPage } from '#test/support/render.tsx'

// This file drives the real better-auth client over the faked network, not the fake client `setup.ts` installs.
vi.unmock('#lib/auth-client.ts')

afterEach(() => {
  window.history.replaceState(null, '', '/')
})

const invitation = { organizationName: 'Acme', role: 'member', email: 'ada@example.com' }

describe('InvitationBanner', () => {
  it('renders nothing without an invitation link', async () => {
    await renderPage(<InvitationBanner userEmail="ada@example.com" />)
    await expect.element(page.getByRole('status')).not.toBeInTheDocument()
  })

  it('says it is checking, then who invited you to what', async () => {
    window.location.hash = '#invite=inv1'
    fakeFetch({ 'GET /api/auth/organization/get-invitation': pending })
    await renderPage(<InvitationBanner userEmail="ada@example.com" />)
    await expect.element(page.getByText('Checking your invitation…')).toBeVisible()
    await expect.element(page.getByRole('button', { name: 'Join' })).not.toBeInTheDocument()
  })

  it('joins with one click, then goes away and clears the link', async () => {
    window.location.hash = '#invite=inv1'
    const calls = fakeFetch({
      'GET /api/auth/organization/get-invitation': invitation,
      'POST /api/auth/organization/accept-invitation': { invitation: {} },
    })
    await renderPage(<InvitationBanner userEmail="Ada@Example.com" />)
    await expect.element(page.getByText("You're invited to join Acme as member.")).toBeVisible()
    await page.getByRole('button', { name: 'Join' }).click()
    await expect.element(page.getByRole('status')).not.toBeInTheDocument()
    expect(calls.find((c) => c.path.endsWith('accept-invitation'))?.body).toEqual({
      invitationId: 'inv1',
    })
    expect(window.location.hash).toBe('')
  })

  it('says when the invitation is for another address and offers no Join', async () => {
    window.location.hash = '#invite=inv1'
    fakeFetch({
      'GET /api/auth/organization/get-invitation': { ...invitation, email: 'bob@example.com' },
    })
    await renderPage(<InvitationBanner userEmail="ada@example.com" />)
    await expect.element(page.getByText(/This invitation is for bob@example.com/)).toBeVisible()
    await expect.element(page.getByRole('button', { name: 'Join' })).toBeVisible()
  })

  it('shows an unusable invitation as an alert and can be dismissed', async () => {
    window.location.hash = '#invite=inv1'
    fakeFetch({ 'GET /api/auth/organization/get-invitation': json({ message: 'x' }, 404) })
    await renderPage(<InvitationBanner userEmail="ada@example.com" />)
    await expect
      .element(
        page.getByText("This invitation isn't for this account, has expired, or was withdrawn."),
      )
      .toBeVisible()
    await page.getByRole('button', { name: 'Dismiss' }).click()
    await expect.element(page.getByRole('alert')).not.toBeInTheDocument()
  })
})
