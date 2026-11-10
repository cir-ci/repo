import { describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'

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

  it("shows the server's refusal of a rule", async () => {
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
