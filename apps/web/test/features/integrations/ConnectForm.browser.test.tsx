import type { Integration } from '@circi/api'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'

import { ConnectForm } from '#features/integrations/ConnectForm.tsx'
import { navigation } from '#features/integrations/generic-api.ts'
import { fakeApi } from '#test/support/fetch.ts'
import { renderPage } from '#test/support/render.tsx'

import { entry } from './fixtures.ts'

afterEach(() => {
  vi.restoreAllMocks()
})

const FIELDS: Integration.CredentialField[] = [
  { name: 'site', label: 'Site', placeholder: 'acme.example.com', secret: false, optional: false },
  {
    name: 'email',
    label: 'Account email',
    description: 'Who the token belongs to',
    secret: false,
    optional: false,
  },
  { name: 'token', label: 'API token', secret: true, optional: false },
  { name: 'note', label: 'Note', secret: false, optional: true },
]

const definition = entry({
  kind: 'tokenchat',
  name: 'Token chat',
  group: 'chat',
  credentials: FIELDS,
})

const show = (e = definition) =>
  renderPage(<ConnectForm entry={e} workspace="acme" onDone={() => {}} />, {
    route: '/workspaces/$workspace/settings/integrations',
    url: '/workspaces/acme/settings/integrations',
  })

describe('ConnectForm', () => {
  it('renders every credential field of the spec, secrets as password fields', async () => {
    await page.viewport(1000, 900)
    await show()
    for (const field of FIELDS) {
      // eslint-disable-next-line no-await-in-loop -- one field at a time
      await expect.element(page.getByLabelText(field.label, { exact: false })).toBeVisible()
    }
    expect(page.getByLabelText('API token').element().getAttribute('type')).toBe('password')
    expect(page.getByLabelText('Site').element().getAttribute('type')).not.toBe('password')
    await expect.element(page.getByText('Who the token belongs to')).toBeVisible()
    expect(page.getByLabelText('Site').element().getAttribute('placeholder')).toBe(
      'acme.example.com',
    )
  })

  it('connects with the typed values, leaving an empty optional field out', async () => {
    await page.viewport(1000, 900)
    const fake = fakeApi({
      'POST /api/workspaces/acme/integrations/tokenchat/connect': { body: { id: 'new-id' } },
    })
    await show()
    const submit = page.getByRole('button', { name: 'Connect Token chat' })
    await expect.element(submit).toBeDisabled()
    await page.getByLabelText('Site').fill(' acme.example.com ')
    await page.getByLabelText('Account email').fill('a@acme.test')
    await page.getByLabelText('API token').fill('secret-token')
    await submit.click()
    await expect.poll(() => fake.of('POST')).toHaveLength(1)
    expect(fake.of('POST')[0]?.body).toEqual({
      site: 'acme.example.com',
      email: 'a@acme.test',
      token: 'secret-token',
    })
  })

  it('shows the server’s reason when the provider refuses the credentials', async () => {
    await page.viewport(1000, 900)
    fakeApi({
      'POST /api/workspaces/acme/integrations/tokenchat/connect': {
        status: 400,
        body: { error: 'Token chat did not accept that token' },
      },
    })
    await show()
    await page.getByLabelText('Site').fill('x.example.com')
    await page.getByLabelText('Account email').fill('a@acme.test')
    await page.getByLabelText('API token').fill('nope')
    await page.getByRole('button', { name: 'Connect Token chat' }).click()
    await expect.element(page.getByText('Token chat did not accept that token')).toBeVisible()
  })

  it('offers the install too when the integration has OAuth', async () => {
    await page.viewport(1000, 900)
    const assign = vi.spyOn(navigation, 'assign').mockImplementation(() => {})
    fakeApi({
      'GET /api/workspaces/acme/integrations/tokenchat/install': {
        body: { url: 'https://chat.test/oauth' },
      },
    })
    await show({ ...definition, oauth: true })
    await page.getByRole('button', { name: 'Install Token chat instead' }).click()
    await expect.poll(() => assign.mock.calls).toEqual([['https://chat.test/oauth']])
  })
})
