import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'

// The auth client is the edge to better-auth: a fake stands in for it.
const auth = vi.hoisted(() => ({
  getFullOrganization: vi.fn<(arg: unknown) => Promise<unknown>>(),
}))
vi.mock('#lib/auth-client.ts', () => ({ authClient: { organization: auth } }))

import { ReviewsSettingsPage } from '#features/settings/ReviewsSettingsPage.tsx'
import { fakeApi, type ReplyHandler, restoreFetch } from '#test/features/fetch-routes.ts'
import { renderPage } from '#test/support/render.tsx'

const API = '/api/projects/acme/web'

const settings = {
  name: 'Web App',
  defaultBranch: 'main',
  diffThreshold: 0,
  autoApproveDefaultBranch: false,
  blockMergeOnChanges: true,
  flakyBlocksMerge: null,
  retentionDays: 30,
  reviewTargetHours: 24 as number | null,
  staticHostingEnabled: false,
}
const ada = { id: 'u1', name: 'Ada Lovelace' }
const grace = { id: 'u2', name: 'Grace Hopper' }
const rules = (over: Record<string, unknown> = {}) => ({
  canManage: true,
  rules: [
    {
      id: 'r1',
      kind: 'snapshot-name',
      pattern: 'checkout/**',
      position: 0,
      reviewers: [ada],
    },
  ],
  rotation: { startsOn: '2026-11-02T00:00:00.000Z', members: [ada] },
  ...over,
})

function api(over: Record<string, unknown> = {}, extra: Record<string, ReplyHandler> = {}) {
  return fakeApi({
    [`GET ${API}/settings`]: { body: { canManage: true, settings } },
    [`GET ${API}/rules`]: { body: rules(over) },
    [`GET ${API}/triage`]: {
      body: {
        items: [],
        rotation: { members: [ada], onTriage: ada, until: '2026-11-09T00:00:00.000Z' },
      },
    },
    [`PATCH ${API}/settings`]: { body: { settings } },
    ...extra,
  })
}

const show = async () => {
  await page.viewport(1000, 1400)
  await renderPage(<ReviewsSettingsPage />, {
    route: '/$org/$project/settings/reviews',
    url: '/acme/web/settings/reviews',
  })
}

beforeEach(() => {
  auth.getFullOrganization.mockResolvedValue({
    data: {
      id: 'o1',
      name: 'Acme',
      slug: 'acme',
      members: [
        { id: 'm1', userId: 'u1', role: 'owner', user: { name: ada.name, email: 'a@x.test' } },
        { id: 'm2', userId: 'u2', role: 'member', user: { name: grace.name, email: 'g@x.test' } },
      ],
      invitations: [],
    },
    error: null,
  })
})
afterEach(() => restoreFetch())

describe('ReviewsSettingsPage', () => {
  it('shows the target, the rules and who is on triage', async () => {
    api()
    await show()
    await expect.element(page.getByRole('checkbox', { name: /Set a review target/ })).toBeChecked()
    await expect.element(page.getByRole('spinbutton', { name: /Overdue after/ })).toHaveValue(24)
    await expect.element(page.getByText('checkout/**')).toBeVisible()
    await expect.element(page.getByText('Ada Lovelace', { exact: true })).toBeVisible()
    const superseded = page.getByRole('switch', { name: /superseded/ })
    await expect.element(superseded).toBeChecked()
    await expect.element(superseded).toHaveAttribute('data-disabled')
  })

  it('saves the review target, and null when turned off', async () => {
    const calls = api()
    await show()
    const save = page.getByRole('button', { name: 'Save review target' })
    await expect.element(save).toBeDisabled()
    await page.getByRole('spinbutton', { name: /Overdue after/ }).fill('48')
    await save.click()
    await expect.poll(() => calls.of('PATCH')[0]?.body).toEqual({ reviewTargetHours: 48 })
    await page.getByRole('checkbox', { name: /Set a review target/ }).click()
    await save.click()
    await expect.poll(() => calls.of('PATCH')[1]?.body).toEqual({ reviewTargetHours: null })
  })

  it('refuses an invalid target without asking the server', async () => {
    const calls = api()
    await show()
    await page.getByRole('spinbutton', { name: /Overdue after/ }).fill('0')
    await page.getByRole('button', { name: 'Save review target' }).click()
    await expect.element(page.getByText(/whole number of hours/)).toBeVisible()
    expect(calls.of('PATCH')).toHaveLength(0)
  })

  it('adds a rule with a pattern and reviewers', async () => {
    const calls = api({}, { [`POST ${API}/rules`]: { status: 201, body: {} } })
    await show()
    await page.getByRole('button', { name: 'Add rule' }).click()
    await page.getByRole('textbox', { name: 'Pattern' }).fill('settings/*')
    await page.getByRole('checkbox', { name: 'Grace Hopper' }).first().click()
    await page.getByRole('button', { name: 'Save rule' }).click()
    await expect
      .poll(() => calls.of('POST')[0]?.body)
      .toEqual({ kind: 'snapshot-name', pattern: 'settings/*', reviewerIds: ['u2'] })
  })

  it('asks for a pattern and a reviewer before adding', async () => {
    const calls = api({}, { [`POST ${API}/rules`]: { status: 201, body: {} } })
    await show()
    await page.getByRole('button', { name: 'Add rule' }).click()
    await page.getByRole('button', { name: 'Save rule' }).click()
    await expect.element(page.getByText(/Enter a pattern/)).toBeVisible()
    expect(calls.of('POST')).toHaveLength(0)
  })

  it('edits and deletes a rule', async () => {
    const calls = api(
      {},
      {
        [`PUT ${API}/rules/r1`]: { body: {} },
        [`DELETE ${API}/rules/r1`]: { status: 204 },
      },
    )
    await show()
    await page.getByRole('button', { name: 'Edit rule checkout/**' }).click()
    await page.getByRole('textbox', { name: 'Pattern' }).fill('checkout/*')
    await page.getByRole('button', { name: 'Save rule' }).click()
    await expect
      .poll(() => calls.of('PUT')[0]?.body)
      .toEqual({ kind: 'snapshot-name', pattern: 'checkout/*', reviewerIds: ['u1'] })
    await page.getByRole('button', { name: 'Delete rule checkout/**' }).click()
    await page.getByRole('button', { name: 'Delete rule', exact: true }).click()
    await expect.poll(() => calls.of('DELETE')).toHaveLength(1)
  })

  it('saves the rotation with members and a start date', async () => {
    const calls = api({}, { [`PUT ${API}/triage-rotation`]: { body: {} } })
    await show()
    await page.getByRole('checkbox', { name: 'Grace Hopper' }).last().click()
    await page.getByRole('button', { name: 'Save rotation' }).click()
    await expect
      .poll(() => calls.of('PUT')[0]?.body)
      .toEqual({
        memberIds: ['u1', 'u2'],
        startsOn: '2026-11-02T00:00:00.000Z',
      })
  })

  it('shows a refusal from the server', async () => {
    api(
      {},
      {
        [`PATCH ${API}/settings`]: {
          status: 403,
          body: { error: 'Only owners and admins can change settings' },
        },
      },
    )
    await show()
    await page.getByRole('spinbutton', { name: /Overdue after/ }).fill('12')
    await page.getByRole('button', { name: 'Save review target' }).click()
    await expect
      .element(page.getByRole('alert'))
      .toHaveTextContent('Only owners and admins can change settings')
  })

  it('is read-only for members, with a note', async () => {
    api({ canManage: false })
    await show()
    await expect
      .element(page.getByText('Only owners and admins can change these settings.'))
      .toBeVisible()
    await expect.element(page.getByRole('checkbox', { name: /Set a review target/ })).toBeDisabled()
    expect(page.getByRole('button', { name: 'Add rule' }).elements()).toHaveLength(0)
    expect(page.getByRole('button', { name: 'Save rotation' }).elements()).toHaveLength(0)
    await expect.element(page.getByText('checkout/**')).toBeVisible()
  })
})
