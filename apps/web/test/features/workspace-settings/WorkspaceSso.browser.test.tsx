import { AnnouncerProvider, SettingsSection } from '@circi/ui'
import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'

import { WorkspaceSso } from '#features/workspace-settings/WorkspaceSso.tsx'
import { fakeFetch, pending } from '#test/support/fetch.ts'
import { renderPage } from '#test/support/render.tsx'

const BASE = '/api/workspaces/acme/sso'
const provider = {
  providerId: 'p1',
  issuer: 'https://login.acme.test',
  redirectUri: 'https://circi.test/api/auth/sso/callback/p1',
}

const show = () =>
  renderPage(
    <AnnouncerProvider>
      <SettingsSection title="Sign-in methods">
        <WorkspaceSso workspace="acme" />
      </SettingsSection>
    </AnnouncerProvider>,
  )

const configure = () => page.getByRole('button', { name: 'Configure' }).click()

const fill = async (issuer: string, clientId: string, clientSecret: string) => {
  if (issuer) await page.getByRole('textbox', { name: 'Issuer address' }).fill(issuer)
  if (clientId) await page.getByRole('textbox', { name: 'Client id' }).fill(clientId)
  if (clientSecret) await page.getByLabelText('Client secret').fill(clientSecret)
}

describe('WorkspaceSso', () => {
  it('is a row with Configure disabled while loading', async () => {
    await page.viewport(1000, 800)
    fakeFetch({ [`GET ${BASE}`]: () => pending() })
    await show()
    await expect.element(page.getByText('Single sign-on', { exact: true })).toBeVisible()
    await expect.element(page.getByRole('button', { name: 'Configure' })).toBeDisabled()
  })

  it('offers Configure with the form behind it when nothing is connected', async () => {
    await page.viewport(1000, 800)
    fakeFetch({ [`GET ${BASE}`]: { providers: [] } })
    await show()
    expect(page.getByText('Connected').elements()).toHaveLength(0)
    expect(page.getByRole('textbox').elements()).toHaveLength(0)
    await configure()
    await expect.element(page.getByText(/with “acme” and join as members/)).toBeVisible()
    await expect.element(page.getByRole('textbox', { name: 'Issuer address' })).toBeVisible()
    await expect.element(page.getByLabelText('Client secret')).toHaveAttribute('type', 'password')
    // A password manager must not fill in the user's own login here.
    await expect
      .element(page.getByLabelText('Client secret'))
      .toHaveAttribute('autocomplete', 'new-password')
    await expect.element(page.getByLabelText('Client id')).toHaveAttribute('autocomplete', 'off')
  })

  it('shows Connected on the row, and the provider and its redirect address under Configure', async () => {
    await page.viewport(1000, 800)
    fakeFetch({ [`GET ${BASE}`]: { providers: [provider] } })
    await show()
    await expect.element(page.getByText('Connected')).toBeVisible()
    await expect.element(page.getByText(/https:\/\/login.acme.test\. Signs people/)).toBeVisible()
    await configure()
    await expect.element(page.getByText(provider.redirectUri)).toBeVisible()
    expect(page.getByRole('textbox').elements()).toHaveLength(0)
  })

  it('says it could not load, and tries again', async () => {
    await page.viewport(1000, 800)
    let ok = false
    fakeFetch({
      [`GET ${BASE}`]: () =>
        ok ? { providers: [provider] } : Response.json({ error: 'Down for now' }, { status: 500 }),
    })
    await show()
    await expect.element(page.getByRole('alert').getByText(/Down for now/)).toBeVisible()
    // No form is offered while it is unknown whether a provider exists.
    expect(page.getByRole('button', { name: 'Configure' }).elements()).toHaveLength(0)
    ok = true
    await page.getByRole('button', { name: 'Try again' }).click()
    await expect.element(page.getByText('Connected')).toBeVisible()
  })

  it('names every empty field and sends nothing', async () => {
    await page.viewport(1000, 800)
    const calls = fakeFetch({ [`GET ${BASE}`]: { providers: [] } })
    await show()
    await configure()
    await page.getByRole('button', { name: 'Connect provider' }).click()
    await expect.element(page.getByText('Enter the issuer address')).toBeVisible()
    await expect.element(page.getByText('Enter the client id')).toBeVisible()
    await expect.element(page.getByText('Enter the client secret')).toBeVisible()
    await expect.element(page.getByRole('textbox', { name: 'Client id' })).toBeInvalid()
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0)
  })

  it('wants a full address for the issuer, and clears a message when that field is edited', async () => {
    await page.viewport(1000, 800)
    const calls = fakeFetch({ [`GET ${BASE}`]: { providers: [] } })
    await show()
    await configure()
    await fill('login.acme.test', 'id', 's3cret')
    await page.getByRole('button', { name: 'Connect provider' }).click()
    await expect
      .element(page.getByText('Enter a full address, like https://login.example.com'))
      .toBeVisible()
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0)
    await page.getByRole('textbox', { name: 'Issuer address' }).fill('https://login.acme.test')
    expect(page.getByText('Enter a full address', { exact: false }).elements()).toHaveLength(0)
  })

  it('connects a provider with trimmed values, closes the dialog and shows Connected', async () => {
    await page.viewport(1000, 800)
    let providers: unknown[] = []
    const calls = fakeFetch({
      [`GET ${BASE}`]: () => ({ providers }),
      [`POST ${BASE}`]: () => {
        providers = [provider]
        return { provider }
      },
    })
    await show()
    await configure()
    await fill(' https://login.acme.test ', ' client-1 ', 's3cret')
    await page.getByRole('button', { name: 'Connect provider' }).click()
    await expect.element(page.getByText('Connected')).toBeVisible()
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      issuer: 'https://login.acme.test',
      clientId: 'client-1',
      clientSecret: 's3cret',
    })
  })

  it('shows the server’s refusal and keeps the form filled in', async () => {
    await page.viewport(1000, 800)
    fakeFetch({
      [`GET ${BASE}`]: { providers: [] },
      [`POST ${BASE}`]: () =>
        Response.json({ error: 'Couldn’t reach that issuer' }, { status: 400 }),
    })
    await show()
    await configure()
    await fill('https://login.acme.test', 'id', 's3cret')
    await page.getByRole('button', { name: 'Connect provider' }).click()
    await expect.element(page.getByRole('alert')).toHaveTextContent('Couldn’t reach that issuer')
    await expect.element(page.getByRole('textbox', { name: 'Client id' })).toHaveValue('id')
  })

  it('disconnects the provider only after confirming, and offers the form again', async () => {
    await page.viewport(1000, 800)
    let providers = [provider]
    const calls = fakeFetch({
      [`GET ${BASE}`]: () => ({ providers }),
      [`DELETE ${BASE}/p1`]: () => {
        providers = []
        return new Response(null, { status: 204 })
      },
    })
    await show()
    await configure()
    await page.getByRole('button', { name: 'Remove https://login.acme.test' }).click()
    const dialog = page.getByRole('alertdialog', { name: 'Disconnect single sign-on?' })
    await expect.element(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false)

    await page.getByRole('button', { name: 'Remove https://login.acme.test' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Remove provider' }).click()
    await expect
      .poll(() => calls.some((c) => c.method === 'DELETE' && c.path === `${BASE}/p1`))
      .toBe(true)
    await expect.element(page.getByRole('button', { name: 'Configure' })).toBeVisible()
    expect(page.getByText('Connected').elements()).toHaveLength(0)
  })
})
