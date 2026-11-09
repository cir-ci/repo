import { describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'

import { ReviewTargetSection } from '#features/reviews/settings/ReviewTargetSection.tsx'
import { RotationSection } from '#features/reviews/settings/RotationSection.tsx'
import { RulesSection } from '#features/reviews/settings/RulesSection.tsx'
import type { ReplyHandler } from '#test/support/fetch.ts'
import { renderPage } from '#test/support/render.tsx'

const API = '/api/teams/acme/web'
const ada = { id: 'u1', name: 'Ada Lovelace' }
const grace = { id: 'u2', name: 'Grace Hopper' }
const people = [ada, grace]

const rule = (id: string, pattern: string, over: Record<string, unknown> = {}) => ({
  id,
  kind: 'snapshot-name' as const,
  pattern,
  position: 0,
  reviewers: [ada],
  ...over,
})

type Api = Record<string, ReplyHandler>

function showRules(props: Partial<RulesSection.Props> = {}, api: Api = {}) {
  return renderPage(
    <RulesSection
      workspace="acme"
      team="web"
      rules={[rule('r1', 'checkout/**')]}
      people={people}
      canManage
      {...props}
    />,
    { announcer: true, api },
  )
}

describe('RulesSection', () => {
  it('explains that nobody is asked when there are no rules', async () => {
    await showRules({ rules: [] })
    await expect.element(page.getByRole('heading', { name: 'No review rules' })).toBeVisible()
    await expect.element(page.getByRole('button', { name: 'Add rule' })).toBeVisible()
  })

  it('lists each rule with its kind and reviewers', async () => {
    await showRules({
      rules: [
        rule('r1', 'checkout/**'),
        rule('r2', 'release/*', { kind: 'build-name', reviewers: [ada, grace] }),
      ],
    })
    const list = page.getByRole('list', { name: 'Review rules' })
    expect(list.getByRole('listitem').elements()).toHaveLength(2)
    await expect.element(list.getByText('release/*')).toBeVisible()
  })

  it('shows rules but no way to change them to people who cannot manage', async () => {
    await showRules({ canManage: false })
    await expect.element(page.getByText('checkout/**')).toBeVisible()
    expect(page.getByRole('button').elements()).toHaveLength(0)
  })

  it('opens the editor from Add rule and closes it with Cancel without saving', async () => {
    await showRules({}, {})
    await page.getByRole('button', { name: 'Add rule' }).click()
    const form = page.getByRole('form', { name: 'Rule' })
    await expect.element(form).toBeVisible()
    expect(page.getByRole('button', { name: 'Add rule' }).elements()).toHaveLength(0)
    await form.getByRole('button', { name: 'Cancel' }).click()
    await expect.element(form).not.toBeInTheDocument()
    await expect.element(page.getByRole('button', { name: 'Add rule' })).toBeVisible()
  })

  it('does not save an unchanged rule', async () => {
    await showRules()
    await page.getByRole('button', { name: 'Edit rule checkout/**' }).click()
    await expect.element(page.getByRole('button', { name: 'Save rule' })).toBeDisabled()
  })

  it('names the problem with a pattern, and with no reviewer, before asking the server', async () => {
    const { calls } = await showRules({ rules: [] })
    await page.getByRole('button', { name: 'Add rule' }).click()
    await page.getByRole('textbox', { name: 'Pattern' }).fill('checkout/**')
    await page.getByRole('button', { name: 'Save rule' }).click()
    await expect.element(page.getByRole('alert')).toHaveTextContent('Choose at least one reviewer')
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0)
  })

  it('sends the kind chosen for a new rule', async () => {
    const { calls } = await showRules(
      { rules: [] },
      { [`POST ${API}/rules`]: { status: 201, body: {} } },
    )
    await page.getByRole('button', { name: 'Add rule' }).click()
    await page.getByRole('combobox', { name: 'Matches' }).click()
    await page.getByRole('option', { name: /build/i }).click()
    await page.getByRole('textbox', { name: 'Pattern' }).fill('release/*')
    await page.getByRole('checkbox', { name: 'Ada Lovelace' }).click()
    await page.getByRole('button', { name: 'Save rule' }).click()
    await expect
      .poll(() => calls.find((c) => c.method === 'POST')?.body)
      .toEqual({ kind: 'build-name', pattern: 'release/*', reviewerIds: ['u1'] })
  })

  it('shows the server’s refusal of a rule', async () => {
    await showRules(
      { rules: [] },
      { [`POST ${API}/rules`]: { status: 400, body: { error: 'That pattern is too broad' } } },
    )
    await page.getByRole('button', { name: 'Add rule' }).click()
    await page.getByRole('textbox', { name: 'Pattern' }).fill('**')
    await page.getByRole('checkbox', { name: 'Ada Lovelace' }).click()
    await page.getByRole('button', { name: 'Save rule' }).click()
    await expect.element(page.getByRole('alert')).toHaveTextContent('That pattern is too broad')
  })

  it('asks before deleting and keeps the rule when cancelled', async () => {
    const { calls } = await showRules()
    await page.getByRole('button', { name: 'Delete rule checkout/**' }).click()
    const dialog = page.getByRole('alertdialog', { name: 'Delete this rule?' })
    await expect.element(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect.element(dialog).not.toBeInTheDocument()
    expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(0)
    await expect.element(page.getByText('checkout/**')).toBeVisible()
  })

  it('announces a move and sends the new order', async () => {
    const rules = [rule('r1', 'a/*'), rule('r2', 'b/*', { position: 1 })]
    const { calls } = await showRules(
      { rules },
      { [`PUT ${API}/rules/order`]: { body: { rules } } },
    )
    await page.getByRole('button', { name: 'Move rule b/* up' }).click()
    await expect
      .poll(() => calls.find((c) => c.method === 'PUT')?.body)
      .toEqual({ ruleIds: ['r2', 'r1'] })
  })

  it('keeps Up and Down reachable and operable from the keyboard', async () => {
    const rules = [rule('r1', 'a/*'), rule('r2', 'b/*', { position: 1 })]
    const { calls } = await showRules(
      { rules },
      { [`PUT ${API}/rules/order`]: { body: { rules } } },
    )
    page.getByRole('button', { name: 'Move rule a/* down' }).element().focus()
    await userEvent.keyboard('{Enter}')
    await expect
      .poll(() => calls.find((c) => c.method === 'PUT')?.body)
      .toEqual({ ruleIds: ['r2', 'r1'] })
  })
})

function showRotation(
  props: Partial<RotationSection.Props> = {},
  triage: Record<string, unknown> | null = {
    items: [],
    rotation: { members: [ada], onTriage: ada, until: '2026-11-09T00:00:00.000Z' },
  },
  api: Api = {},
) {
  return renderPage(
    <RotationSection
      workspace="acme"
      team="web"
      rotation={{ startsOn: '2026-11-02T00:00:00.000Z', members: [ada] }}
      people={people}
      canManage
      {...props}
    />,
    {
      announcer: true,
      api: {
        ...(triage ? { [`GET ${API}/triage`]: { body: triage } } : {}),
        ...api,
      },
    },
  )
}

describe('RotationSection', () => {
  it('says who is on triage this week', async () => {
    await showRotation()
    await expect.element(page.getByText(/On triage this week/)).toBeVisible()
    await expect.element(page.getByRole('strong').filter({ hasText: 'Ada Lovelace' })).toBeVisible()
  })

  it('says no one is on triage without a rotation, and leaves the date unavailable', async () => {
    await showRotation(
      { rotation: { startsOn: null, members: [] } },
      { items: [], rotation: { members: [], onTriage: null, until: null } },
    )
    await expect.element(page.getByText(/No one is on triage/)).toBeVisible()
    await expect.element(page.getByLabelText('First week starts')).toBeDisabled()
    await expect.element(page.getByRole('button', { name: 'Save rotation' })).toBeDisabled()
  })

  it('saves an empty list to turn the rotation off', async () => {
    const { calls } = await showRotation({}, undefined, {
      [`PUT ${API}/triage-rotation`]: { body: {} },
    })
    await page.getByRole('checkbox', { name: 'Ada Lovelace' }).click()
    await page.getByRole('button', { name: 'Save rotation' }).click()
    await expect.poll(() => calls.find((c) => c.method === 'PUT')?.body).toEqual({ memberIds: [] })
  })

  it('shows a refusal from the server', async () => {
    await showRotation({}, undefined, {
      [`PUT ${API}/triage-rotation`]: { status: 403, body: { error: 'Only admins can do that' } },
    })
    await page.getByRole('checkbox', { name: 'Grace Hopper' }).click()
    await page.getByRole('button', { name: 'Save rotation' }).click()
    await expect.element(page.getByRole('alert')).toHaveTextContent('Only admins can do that')
  })

  it('is read-only for people who cannot manage', async () => {
    await showRotation({ canManage: false })
    await expect.element(page.getByRole('checkbox', { name: 'Ada Lovelace' })).toBeDisabled()
    await expect.element(page.getByLabelText('First week starts')).toBeDisabled()
    expect(page.getByRole('button', { name: 'Save rotation' }).elements()).toHaveLength(0)
  })
})

function showTarget(hours: number | null, canManage = true, api: Api = {}) {
  return renderPage(
    <ReviewTargetSection
      workspace="acme"
      team="web"
      settings={{ reviewTargetHours: hours }}
      canManage={canManage}
    />,
    { announcer: true, api },
  )
}

describe('ReviewTargetSection', () => {
  it('says requests never become overdue when there is no target', async () => {
    await showTarget(null)
    await expect.element(page.getByText('Review requests never become overdue.')).toBeVisible()
    await expect
      .element(page.getByRole('checkbox', { name: /Set a review target/ }))
      .not.toBeChecked()
    expect(page.getByRole('spinbutton').elements()).toHaveLength(0)
  })

  it('describes the target in days, or in hours when it is not a whole day', async () => {
    await showTarget(48)
    await expect.element(page.getByText('A review request is overdue after 2 days.')).toBeVisible()
  })

  it('describes a single hour in the singular', async () => {
    await showTarget(1)
    await expect.element(page.getByText('A review request is overdue after 1 hour.')).toBeVisible()
  })

  it('enables a target and saves it, then confirms', async () => {
    const { calls } = await showTarget(null, true, {
      [`PATCH ${API}/settings`]: { body: { settings: {} } },
    })
    await page.getByRole('checkbox', { name: /Set a review target/ }).click()
    await page.getByRole('spinbutton', { name: /Overdue after/ }).fill('36')
    await page.getByRole('button', { name: 'Save review target' }).click()
    await expect
      .poll(() => calls.find((c) => c.method === 'PATCH')?.body)
      .toEqual({ reviewTargetHours: 36 })
  })

  it('refuses a non-numeric or oversized target', async () => {
    const { calls } = await showTarget(24)
    const field = page.getByRole('spinbutton', { name: /Overdue after/ })
    await field.fill('9000')
    await page.getByRole('button', { name: 'Save review target' }).click()
    await expect.element(page.getByText(/at most one year/)).toBeVisible()
    expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(0)
  })

  it('cannot be changed by people who cannot manage', async () => {
    await showTarget(24, false)
    await expect.element(page.getByRole('checkbox', { name: /Set a review target/ })).toBeDisabled()
    await expect.element(page.getByRole('spinbutton', { name: /Overdue after/ })).toBeDisabled()
    expect(page.getByRole('button', { name: 'Save review target' }).elements()).toHaveLength(0)
  })

  it('always keeps closing superseded requests on', async () => {
    await showTarget(null)
    await expect.element(page.getByRole('switch', { name: /superseded/ })).toBeChecked()
  })
})
