import { describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'

// The auth client is the edge to better-auth: a fake stands in for it.
vi.mock('#lib/auth-client.ts', () =>
  import('#test/support/auth-client.ts').then((m) => m.authClientModule),
)

import { ReviewsSettingsPage } from '#features/reviews/settings/ReviewsSettingsPage.tsx'
import { mockAuthClient } from '#test/support/auth-client.ts'
import { fakeApi, type ReplyHandler } from '#test/support/fetch.ts'
import { renderPage } from '#test/support/render.tsx'

mockAuthClient()

const API = '/api/teams/acme/web'

const settings = {
  name: 'Web App',
  defaultBranch: 'main',
  diffThreshold: 0,
  autoApproveDefaultBranch: false,
  blockMergeOnChanges: true,
  flakyBlocksMerge: null,
  retentionDays: 30,
  reviewTargetHours: 24 as number | null,
  reviewOverdueNotifyUserId: null as string | null,
  closeReviewsOnNewerBuild: true,
  reRequestOnNewerBuild: true,
  autoApproveNoChanges: true,
  requireRejectReason: false,
  flakyAfterChanges: 3,
  snoozeDefaultDays: 7,
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
    [`GET ${API}/members`]: {
      body: {
        members: [ada, grace].map((m) => ({
          id: m.id,
          name: m.name,
          email: `${m.id}@x.test`,
          image: null,
          role: 'member',
          addedAt: '2026-11-01T00:00:00.000Z',
        })),
        canManage: true,
      },
    },
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
  return renderPage(<ReviewsSettingsPage />, {
    route: '/$workspace/$team/settings/reviews',
    url: '/acme/web/settings/reviews',
    otherRoutes: ['/$workspace/$team', '/$workspace/$team/settings/members'],
  })
}

describe('ReviewsSettingsPage', () => {
  it('shows the target, the automation, the rules and the rotation', async () => {
    api()
    await show()
    await expect.element(page.getByRole('textbox', { name: /Overdue after/ })).toHaveValue('24')
    await expect.element(page.getByText('Counting working days.')).toBeVisible()
    await expect
      .element(page.getByText('Example: a request made Friday 16:00 becomes overdue Monday 16:00.'))
      .toBeVisible()
    await expect.element(page.getByText('checkout/**')).toBeVisible()
    // The four automation settings are checkboxes that wait for Save, none of them fixed.
    expect(page.getByRole('switch').elements()).toHaveLength(0)
    expect(page.getByText('Always on', { exact: true }).elements()).toHaveLength(0)
    await expect
      .element(page.getByRole('checkbox', { name: /Close review requests/ }))
      .toBeChecked()
    await expect.element(page.getByRole('checkbox', { name: /Re-request the same/ })).toBeChecked()
    await expect
      .element(page.getByRole('checkbox', { name: /Approve builds with no changes/ }))
      .toBeChecked()
    await expect.element(page.getByRole('checkbox', { name: /Ask for a reason/ })).not.toBeChecked()
    // The rotation, in order, with its cadence.
    await expect.element(page.getByText(/weekly, Mondays/)).toBeVisible()
    await expect
      .element(page.getByRole('textbox', { name: 'Returns to an earlier image before flaky' }))
      .toHaveValue('3')
    await expect
      .element(page.getByText(/returns to an earlier image in the last 10 builds on main/))
      .toBeVisible()
    await expect
      .element(page.getByRole('combobox', { name: 'Snoozed items come back after' }))
      .toHaveTextContent('7 days')
  })

  it("follows the board's order and ends with one Save", async () => {
    api()
    await show()
    await expect
      .poll(() =>
        page
          .getByRole('heading', { level: 2 })
          .elements()
          .map((h) => h.textContent),
      )
      .toEqual(['Review rules', 'Review target', 'Automation', 'Triage', 'Notify a channel'])
    expect(page.getByRole('button', { name: 'Save changes' }).elements()).toHaveLength(1)
    await expect
      .element(page.getByRole('link', { name: 'webhooks' }))
      .toHaveAttribute('href', '/acme/web/settings/webhooks')
  })

  it('saves the review target, and null when it is emptied', async () => {
    const calls = api()
    await show()
    const save = page.getByRole('button', { name: 'Save changes' })
    await expect.element(save).toBeDisabled()
    await page.getByRole('textbox', { name: /Overdue after/ }).fill('48')
    await save.click()
    await expect.poll(() => calls.of('PATCH')[0]?.body).toEqual({ reviewTargetHours: 48 })
    await expect.element(page.getByText('Settings saved.')).toBeVisible()
    await page.getByRole('textbox', { name: /Overdue after/ }).fill('')
    await expect.element(page.getByText('No target: requests never become overdue.')).toBeVisible()
    await save.click()
    await expect.poll(() => calls.of('PATCH')[1]?.body).toEqual({ reviewTargetHours: null })
  })

  it('saves who else is told when a target is missed, and nobody', async () => {
    const calls = api({}, { [`PATCH ${API}/settings`]: { body: { settings } } })
    await show()
    await page.getByRole('combobox', { name: "When it's missed, also tell" }).click()
    await page.getByRole('option', { name: 'Grace Hopper' }).click()
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect.poll(() => calls.of('PATCH')[0]?.body).toEqual({ reviewOverdueNotifyUserId: 'u2' })
  })

  it('saves the automation checkboxes with Save, not as they are clicked', async () => {
    const calls = api()
    await show()
    await page.getByRole('checkbox', { name: /Ask for a reason/ }).click()
    await page.getByRole('checkbox', { name: /Approve builds with no changes/ }).click()
    expect(calls.of('PATCH')).toHaveLength(0)
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect
      .poll(() => calls.of('PATCH')[0]?.body)
      .toEqual({ requireRejectReason: true, autoApproveNoChanges: false })
  })

  it('turns re-requesting off with closing, since there is nothing to re-request', async () => {
    api()
    await show()
    await page.getByRole('checkbox', { name: /Close review requests/ }).click()
    const again = page.getByRole('checkbox', { name: /Re-request the same/ })
    await expect.element(again).toBeDisabled()
    await expect.element(again).not.toBeChecked()
  })

  it('saves the flaky threshold and the snooze default', async () => {
    const calls = api()
    await show()
    await page.getByRole('textbox', { name: 'Returns to an earlier image before flaky' }).fill('5')
    await page.getByRole('combobox', { name: 'Snoozed items come back after' }).click()
    await page.getByRole('option', { name: '14 days' }).click()
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect
      .poll(() => calls.of('PATCH')[0]?.body)
      .toEqual({ flakyAfterChanges: 5, snoozeDefaultDays: 14 })
  })

  it('refuses an invalid target or threshold without asking the server', async () => {
    const calls = api()
    await show()
    await page.getByRole('textbox', { name: /Overdue after/ }).fill('0')
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect.element(page.getByText(/whole number of hours/)).toBeVisible()
    expect(calls.of('PATCH')).toHaveLength(0)
    await page.getByRole('textbox', { name: /Overdue after/ }).fill('720')
    await expect.element(page.getByText(/whole number of hours/)).not.toBeInTheDocument()
    await page.getByRole('textbox', { name: 'Returns to an earlier image before flaky' }).fill('')
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect.element(page.getByText(/Enter a whole number from 2 to 8/)).toBeVisible()
    expect(calls.of('PATCH')).toHaveLength(0)
  })

  it('saves the target and the rotation from one Save, one after the other', async () => {
    const calls = api({}, { [`PUT ${API}/triage-rotation`]: { body: {} } })
    await show()
    await page.getByRole('textbox', { name: /Overdue after/ }).fill('36')
    await page.getByRole('checkbox', { name: 'Grace Hopper' }).last().click()
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect.poll(() => calls.of('PUT')).toHaveLength(1)
    expect(calls.of('PATCH')[0]?.body).toEqual({ reviewTargetHours: 36 })
    expect(calls.of('PUT')[0]?.body).toEqual({
      memberIds: ['u1', 'u2'],
      startsOn: '2026-11-02T00:00:00.000Z',
    })
  })

  it('sends only what changed, and Discard puts the saved values back', async () => {
    const calls = api()
    await show()
    const field = page.getByRole('textbox', { name: /Overdue after/ })
    await field.fill('12')
    await page.getByRole('button', { name: 'Discard' }).click()
    await expect.element(field).toHaveValue('24')
    await expect.element(page.getByRole('button', { name: 'Save changes' })).toBeDisabled()
    expect(calls.of('PATCH')).toHaveLength(0)
  })

  it('refuses a typed date that does not exist, on the field, instead of falling back to now', async () => {
    const calls = api({}, { [`PUT ${API}/triage-rotation`]: { body: {} } })
    await show()
    const date = page.getByLabelText('First week starts')
    await expect.element(date).toHaveValue('2026-11-02')
    // A date input holds nothing for 31 February: its value goes empty, but its text stays.
    date.element().focus()
    await userEvent.keyboard('02312026')
    await expect.element(page.getByText('Enter a valid date')).toBeVisible()
    await page.getByRole('button', { name: 'Save changes' }).click()
    expect(calls.of('PUT')).toHaveLength(0)
    expect(calls.of('PATCH')).toHaveLength(0)
    // Typing a real day clears it, and Discard also puts the saved date back.
    await date.fill('2026-02-28')
    await expect.element(page.getByText('Enter a valid date')).not.toBeInTheDocument()
  })

  it('refuses a typed impossible date in an empty field, on blur and on Save', async () => {
    const calls = api(
      { rotation: { startsOn: null, members: [ada] } },
      { [`PUT ${API}/triage-rotation`]: { body: {} } },
    )
    await show()
    const date = page.getByLabelText('First week starts')
    await expect.element(date).toHaveValue('')
    // 31 February: the value stays empty (no change event), but validity.badInput is true.
    date.element().focus()
    await userEvent.keyboard('31022026')
    const el = date.element()
    if (!(el instanceof HTMLInputElement)) throw new Error('not an input')
    expect(el.validity.badInput).toBe(true)
    el.blur()
    await expect.element(page.getByText('Enter a valid date')).toBeVisible()
    await page.getByRole('button', { name: 'Save changes' }).click()
    expect(calls.of('PUT')).toHaveLength(0)
    await expect.element(page.getByText('Settings saved.')).not.toBeInTheDocument()
  })

  it('turns the rotation off by saving an empty list', async () => {
    const calls = api({}, { [`PUT ${API}/triage-rotation`]: { body: {} } })
    await show()
    await page.getByRole('checkbox', { name: 'Ada Lovelace' }).last().click()
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect.poll(() => calls.of('PUT')[0]?.body).toEqual({ memberIds: [] })
  })

  it('adds, edits and deletes rules in dialogs, each applying when confirmed', async () => {
    const calls = api(
      {},
      {
        [`POST ${API}/rules`]: { status: 201, body: {} },
        [`PUT ${API}/rules/r1`]: { body: {} },
        [`DELETE ${API}/rules/r1`]: { status: 204 },
      },
    )
    await show()
    await page.getByRole('button', { name: 'Add rule' }).click()
    await page.getByRole('textbox', { name: 'Pattern' }).fill('settings/*')
    await page.getByRole('checkbox', { name: 'Grace Hopper' }).first().click()
    await page
      .getByRole('dialog', { name: 'Add rule' })
      .getByRole('button', { name: 'Add rule' })
      .click()
    await expect
      .poll(() => calls.of('POST')[0]?.body)
      .toEqual({ kind: 'snapshot-name', pattern: 'settings/*', reviewerIds: ['u2'] })

    await page.getByRole('button', { name: 'Actions for rule checkout/**' }).click()
    await page.getByRole('menuitem', { name: 'Edit' }).click()
    await page.getByRole('textbox', { name: 'Pattern' }).fill('checkout/*')
    await page.getByRole('button', { name: 'Save rule' }).click()
    await expect
      .poll(() => calls.of('PUT')[0]?.body)
      .toEqual({ kind: 'snapshot-name', pattern: 'checkout/*', reviewerIds: ['u1'] })

    await page.getByRole('button', { name: 'Actions for rule checkout/**' }).click()
    await page.getByRole('menuitem', { name: 'Delete' }).click()
    await page.getByRole('button', { name: 'Delete rule', exact: true }).click()
    await expect.poll(() => calls.of('DELETE')).toHaveLength(1)
    // Rules never wait for the page's Save.
    await expect.element(page.getByRole('button', { name: 'Save changes' })).toBeDisabled()
  })

  it('asks for a pattern and a reviewer before adding', async () => {
    const calls = api({}, { [`POST ${API}/rules`]: { status: 201, body: {} } })
    await show()
    await page.getByRole('button', { name: 'Add rule' }).click()
    await page
      .getByRole('dialog', { name: 'Add rule' })
      .getByRole('button', { name: 'Add rule' })
      .click()
    await expect.element(page.getByText(/Enter a pattern/)).toBeVisible()
    expect(calls.of('POST')).toHaveLength(0)
  })

  it('moves a rule from its menu', async () => {
    const two = {
      rules: [
        { id: 'r1', kind: 'snapshot-name', pattern: 'checkout/**', position: 0, reviewers: [ada] },
        { id: 'r2', kind: 'build-name', pattern: 'release/*', position: 1, reviewers: [grace] },
      ],
    }
    const calls = api(two, { [`PUT ${API}/rules/order`]: { body: { rules: two.rules } } })
    await show()
    await page.getByRole('button', { name: 'Actions for rule checkout/**' }).click()
    await page.getByRole('menuitem', { name: 'Move down' }).click()
    await expect.poll(() => calls.of('PUT')[0]?.body).toEqual({ ruleIds: ['r2', 'r1'] })
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
    await page.getByRole('textbox', { name: /Overdue after/ }).fill('12')
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect
      .element(page.getByRole('alert'))
      .toHaveTextContent('Only owners and admins can change settings')
  })

  it("sends members to the team's Members tab instead of showing the rules", async () => {
    api({ canManage: false }, { [`GET ${API}/settings`]: { body: { canManage: false, settings } } })
    const { router } = await show()
    await expect.poll(() => router.state.location.pathname).toBe('/acme/web/settings/members')
    expect(page.getByText('checkout/**').elements()).toHaveLength(0)
  })
})
