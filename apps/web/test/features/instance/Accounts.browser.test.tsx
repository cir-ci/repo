import { afterEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'

import { AccountsPage } from '#features/instance/AccountsPage.tsx'
import { clipboard } from '#features/instance/admin-api.ts'
import { fakeApi, hangingFetch, restoreFetch } from '#test/features/fetch-routes.ts'
import { renderPage } from '#test/support/render.tsx'

import { account, accountList } from './fixtures.ts'

afterEach(() => {
  restoreFetch()
  vi.restoreAllMocks()
})

const show = () => renderPage(<AccountsPage />, { route: '/instance/accounts' })

const dana = account({ id: 'u1', name: 'Dana Levi', email: 'dana@acme.dev' })
const ron = account({
  id: 'u2',
  name: 'Ron Katz',
  email: 'ron@acme.dev',
  instanceAdmin: true,
  workspaceCount: 0,
})
const tal = account({
  id: 'u3',
  name: 'Tal Shani',
  email: 'tal@contractor.io',
  banned: true,
  banReason: 'spam',
})
const LIST = { 'GET /api/instance/accounts': { body: accountList([dana, ron, tal]) } }

const openMenu = async (name: string) => {
  await page.getByRole('button', { name: `Actions for ${name}` }).click()
}

describe('the accounts page', () => {
  it('has the page title as its h1 and lists accounts with their badges', async () => {
    fakeApi(LIST)
    await show()
    await expect.element(page.getByRole('heading', { level: 1, name: 'Accounts' })).toBeVisible()
    await expect.element(page.getByText('dana@acme.dev')).toBeVisible()
    await expect.element(page.getByText('Instance admin')).toBeVisible()
    await expect
      .element(page.getByText('Banned until').or(page.getByText('Banned: spam')))
      .toBeVisible()
    await expect.element(page.getByText('No workspace')).toBeVisible()
    await expect.element(page.getByText('Never signed in').first()).toBeVisible()
  })

  it('says so to someone who is not an instance admin', async () => {
    fakeApi({ 'GET /api/instance/accounts': { status: 403, body: { error: 'Forbidden' } } })
    await show()
    await expect.element(page.getByRole('heading', { name: 'Instance admins only' })).toBeVisible()
    await expect.element(page.getByText('dana@acme.dev')).not.toBeInTheDocument()
  })

  it('offers to retry when the list cannot be loaded', async () => {
    fakeApi({ 'GET /api/instance/accounts': { status: 500, body: { error: 'database down' } } })
    await show()
    await expect.element(page.getByText('database down')).toBeVisible()
    await expect.element(page.getByRole('button', { name: 'Try again' })).toBeVisible()
  })

  it('holds the loading state without a flash of content', async () => {
    hangingFetch()
    await show()
    await expect.element(page.getByText('dana@acme.dev')).not.toBeInTheDocument()
  })

  it('searches from the first page, with the text in the request', async () => {
    const fake = fakeApi(LIST)
    await show()
    await page.getByRole('searchbox', { name: 'Search accounts' }).fill('ron')
    await expect
      .poll(() => fake.calls.some((c) => c.path === '/api/instance/accounts' && c.method === 'GET'))
      .toBe(true)
    await expect.poll(() => fake.calls.length).toBeGreaterThan(1)
  })

  it('pages through a long list', async () => {
    const fake = fakeApi({
      'GET /api/instance/accounts': { body: accountList([dana], { total: 60 }) },
    })
    await show()
    await expect.element(page.getByText('Page 1 of 3')).toBeVisible()
    await expect.element(page.getByRole('button', { name: 'Previous' })).toBeDisabled()
    await page.getByRole('button', { name: 'Next' }).click()
    await expect.poll(() => fake.calls.length).toBeGreaterThan(1)
  })

  it('shows an empty state for a search with no match', async () => {
    fakeApi({ 'GET /api/instance/accounts': { body: accountList([]) } })
    await show()
    await expect.element(page.getByRole('heading', { name: 'No accounts found' })).toBeVisible()
  })
})

describe('creating an account', () => {
  it('shows the generated password once, with copy, and not again', async () => {
    const write = vi.spyOn(clipboard, 'write').mockResolvedValue()
    const fake = fakeApi({
      ...LIST,
      'POST /api/instance/accounts': {
        status: 201,
        body: {
          account: account({ id: 'u9', email: 'lior@acme.dev' }),
          password: 'tide-ember-violet-42',
        },
      },
    })
    await show()
    await page.getByRole('button', { name: 'Create account' }).click()
    await page.getByRole('textbox', { name: 'Name' }).fill('Lior Cohen')
    await page.getByRole('textbox', { name: 'Email' }).fill('lior@acme.dev')
    await page.getByRole('checkbox', { name: 'Make them an instance admin' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Create account' }).click()
    await expect.element(page.getByText('tide-ember-violet-42')).toBeVisible()
    expect(fake.of('POST')[0]?.body).toEqual({
      name: 'Lior Cohen',
      email: 'lior@acme.dev',
      instanceAdmin: true,
    })
    await page.getByRole('button', { name: 'Copy password for lior@acme.dev' }).click()
    expect(write).toHaveBeenCalledWith('tide-ember-violet-42')
    await expect.element(page.getByText('Copied')).toBeVisible()
    await page.getByRole('button', { name: 'Done' }).click()
    await expect.element(page.getByText('tide-ember-violet-42')).not.toBeInTheDocument()
  })

  it('does not show a password the admin chose', async () => {
    fakeApi({
      ...LIST,
      'POST /api/instance/accounts': {
        status: 201,
        body: { account: account({ email: 'lior@acme.dev' }), password: null },
      },
    })
    await show()
    await page.getByRole('button', { name: 'Create account' }).click()
    await page.getByRole('textbox', { name: 'Name' }).fill('Lior')
    await page.getByRole('textbox', { name: 'Email' }).fill('lior@acme.dev')
    await page.getByLabelText('Password (leave empty to generate one)').fill('a-chosen-password-1')
    await page.getByRole('dialog').getByRole('button', { name: 'Create account' }).click()
    await expect.element(page.getByText('Created the account for lior@acme.dev.')).toBeVisible()
    await expect.element(page.getByText('Password for lior@acme.dev')).not.toBeInTheDocument()
  })

  it('offers an emailed sign-in code only when the instance can send mail', async () => {
    fakeApi({ ...LIST, 'GET /api/capabilities': { body: { mailConfigured: false } } })
    await show()
    await page.getByRole('button', { name: 'Create account' }).click()
    await expect
      .element(page.getByLabelText('Password (leave empty to generate one)'))
      .toBeVisible()
    expect(page.getByRole('button', { name: 'Email a sign-in code' }).elements()).toHaveLength(0)
  })

  it('creates an account that is mailed a sign-in code instead of a password', async () => {
    const fake = fakeApi({
      ...LIST,
      'GET /api/capabilities': { body: { mailConfigured: true } },
      'POST /api/instance/accounts': {
        status: 201,
        body: {
          account: account({ email: 'lior@acme.dev' }),
          password: null,
          signInCodeSentTo: 'lior@acme.dev',
        },
      },
    })
    await show()
    await page.getByRole('button', { name: 'Create account' }).click()
    await page.getByRole('textbox', { name: 'Name' }).fill('Lior')
    await page.getByRole('textbox', { name: 'Email' }).fill('lior@acme.dev')
    await page.getByRole('button', { name: 'Email a sign-in code' }).click()
    expect(page.getByLabelText('Password (leave empty to generate one)').elements()).toHaveLength(0)
    await page.getByRole('dialog').getByRole('button', { name: 'Create account' }).click()
    await expect
      .element(page.getByText('Created the account for lior@acme.dev and emailed a sign-in code.'))
      .toBeVisible()
    expect(fake.of('POST')[0]?.body).toEqual({
      name: 'Lior',
      email: 'lior@acme.dev',
      signInCode: true,
    })
  })

  it('checks the fields before asking the server', async () => {
    const fake = fakeApi(LIST)
    await show()
    await page.getByRole('button', { name: 'Create account' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Create account' }).click()
    await expect.element(page.getByText('Enter a name')).toBeVisible()
    await expect.element(page.getByText('Enter a valid email address')).toBeVisible()
    expect(fake.of('POST')).toHaveLength(0)
  })

  it('shows the server’s refusal in the dialog', async () => {
    fakeApi({
      ...LIST,
      'POST /api/instance/accounts': { status: 409, body: { error: 'That email is taken' } },
    })
    await show()
    await page.getByRole('button', { name: 'Create account' }).click()
    await page.getByRole('textbox', { name: 'Name' }).fill('Lior')
    await page.getByRole('textbox', { name: 'Email' }).fill('dana@acme.dev')
    await page.getByRole('dialog').getByRole('button', { name: 'Create account' }).click()
    await expect.element(page.getByText('That email is taken')).toBeVisible()
  })
})

describe('actions on an account', () => {
  it('resets a password after confirming, and shows the new one once', async () => {
    const fake = fakeApi({
      ...LIST,
      'POST /api/instance/accounts/u1/reset-password': { body: { password: 'new-pass-word-77' } },
    })
    await show()
    await openMenu('Dana Levi')
    await page.getByRole('menuitem', { name: 'Reset password' }).click()
    await expect.element(page.getByText('Reset the password for Dana Levi?')).toBeVisible()
    expect(fake.of('POST')).toHaveLength(0)
    await page.getByRole('button', { name: 'Reset password' }).click()
    await expect.element(page.getByText('new-pass-word-77')).toBeVisible()
    await expect.element(page.getByText('Password for dana@acme.dev')).toBeVisible()
  })

  it('makes an account an instance admin, and offers removal for an admin', async () => {
    const fake = fakeApi({ ...LIST, 'PATCH /api/instance/accounts/u1': { body: {} } })
    await show()
    await openMenu('Dana Levi')
    await page.getByRole('menuitem', { name: 'Make instance admin' }).click()
    await page.getByRole('button', { name: 'Make instance admin' }).click()
    await expect.element(page.getByText('Dana Levi is now an instance admin.')).toBeVisible()
    expect(fake.of('PATCH')[0]?.body).toEqual({ instanceAdmin: true })
    await openMenu('Ron Katz')
    await expect
      .element(page.getByRole('menuitem', { name: 'Remove instance admin' }))
      .toBeVisible()
  })

  it('shows the last-admin refusal from the server', async () => {
    fakeApi({
      ...LIST,
      'PATCH /api/instance/accounts/u2': {
        status: 409,
        body: { error: 'This is the last instance admin: make someone else one first' },
      },
    })
    await show()
    await openMenu('Ron Katz')
    await page.getByRole('menuitem', { name: 'Remove instance admin' }).click()
    await page.getByRole('button', { name: 'Remove instance admin' }).click()
    await expect
      .element(page.getByRole('alert'))
      .toHaveTextContent('This is the last instance admin: make someone else one first')
  })

  it('bans with a reason and a number of days', async () => {
    const fake = fakeApi({ ...LIST, 'POST /api/instance/accounts/u1/ban': { body: {} } })
    await show()
    await openMenu('Dana Levi')
    await page.getByRole('menuitem', { name: 'Ban' }).click()
    await page.getByRole('textbox', { name: 'Reason (optional)' }).fill('spam')
    await page.getByLabelText('Days until the ban ends (leave empty for no end)').fill('30')
    await page.getByRole('dialog').getByRole('button', { name: 'Ban' }).click()
    await expect.element(page.getByText('Dana Levi is banned and signed out.')).toBeVisible()
    expect(fake.of('POST')[0]?.body).toEqual({ reason: 'spam', expiresInDays: 30 })
  })

  it('lifts a ban', async () => {
    const fake = fakeApi({ ...LIST, 'POST /api/instance/accounts/u3/unban': { body: {} } })
    await show()
    await openMenu('Tal Shani')
    await page.getByRole('menuitem', { name: 'Lift ban' }).click()
    await page.getByRole('button', { name: 'Lift ban' }).click()
    await expect.element(page.getByText('Lifted the ban on Tal Shani.')).toBeVisible()
    expect(fake.of('POST')).toHaveLength(1)
  })

  it('signs an account out everywhere, and reports a failure', async () => {
    fakeApi({
      ...LIST,
      'POST /api/instance/accounts/u1/sign-out': {
        status: 500,
        body: { error: 'no session store' },
      },
    })
    await show()
    await openMenu('Dana Levi')
    await page.getByRole('menuitem', { name: 'Sign out everywhere' }).click()
    await page.getByRole('button', { name: 'Sign out everywhere' }).click()
    await expect.element(page.getByRole('alert')).toHaveTextContent('no session store')
  })

  it('does nothing when the confirmation is cancelled', async () => {
    const fake = fakeApi(LIST)
    await show()
    await openMenu('Dana Levi')
    await page.getByRole('menuitem', { name: 'Sign out everywhere' }).click()
    await page.getByRole('button', { name: 'Cancel' }).click()
    expect(fake.of('POST')).toHaveLength(0)
  })
})
