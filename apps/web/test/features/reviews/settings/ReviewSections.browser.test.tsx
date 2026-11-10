import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'

import { RulesSection } from '#features/reviews/settings/RulesSection.tsx'
import { expectEmptyState } from '#test/support/empty-state.ts'
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

/** The page's header holds "Add rule" and asks the section to open its dialog: a stand-in button does the same. */
function WithHeaderButton(props: RulesSection.Props) {
  const [requests, setRequests] = useState(0)
  return (
    <>
      {props.canManage ? (
        <button type="button" onClick={() => setRequests((n) => n + 1)}>
          Add rule
        </button>
      ) : null}
      <RulesSection {...props} addRequests={requests} />
    </>
  )
}

function showRules(props: Partial<RulesSection.Props> = {}, api: Api = {}) {
  return renderPage(
    <WithHeaderButton
      workspace="acme"
      team="web"
      teamName="Web App"
      rules={[rule('r1', 'checkout/**')]}
      rotation={{ startsOn: null, members: [] }}
      people={people}
      canManage
      {...props}
    />,
    { announcer: true, api },
  )
}

const openActions = (pattern: string) =>
  page.getByRole('button', { name: `Actions for rule ${pattern}` }).click()

describe('RulesSection', () => {
  it('explains that nobody is asked when there are no rules', async () => {
    await showRules({ rules: [] })
    await expectEmptyState('No review rules', {
      body: 'Add a rule to ask people to review changed screenshots automatically.',
    })
    // No button of its own: the page header's Add rule opens the dialog.
    await page.getByRole('button', { name: 'Add rule' }).click()
    await expect.element(page.getByRole('dialog', { name: 'Add rule' })).toBeVisible()
  })

  it('tells people who cannot manage that nobody is asked, without a button', async () => {
    await showRules({ rules: [], canManage: false })
    await expectEmptyState('No review rules', { body: 'Nobody is asked to review automatically.' })
  })

  it('lists each rule as the board does: what it matches, then who it asks', async () => {
    await showRules({
      rules: [
        rule('r1', 'checkout/**'),
        rule('r2', 'release/*', { kind: 'build-name', reviewers: [ada, grace] }),
      ],
    })
    const list = page.getByRole('list', { name: 'Review rules' })
    // The two rules and the fallback row.
    expect(list.getByRole('listitem').elements()).toHaveLength(3)
    await expect.element(list.getByText(/Screenshot matches/)).toBeVisible()
    await expect.element(list.getByText(/Build name is/)).toBeVisible()
    await expect.element(list.getByText('release/*')).toBeVisible()
    await expect.element(list.getByText('Grace Hopper')).toBeVisible()
    await expect.element(list.getByText('Otherwise')).toBeVisible()
    await expect.element(list.getByText('Nobody is asked')).toBeVisible()
  })

  it('says who the rotation gives the rest to, one per build', async () => {
    await showRules({ rotation: { startsOn: '2026-11-02T00:00:00.000Z', members: [ada, grace] } })
    await expect.element(page.getByText('Rotate through')).toBeVisible()
    await expect.element(page.getByText('one per build')).toBeVisible()
  })

  it('has no inline form and no line about saving as you edit', async () => {
    await showRules()
    await expect.element(page.getByText(/save as you edit/i)).not.toBeInTheDocument()
    await page.getByRole('button', { name: 'Add rule' }).click()
    expect(page.getByRole('form', { name: 'Rule' }).elements()).toHaveLength(0)
    await expect.element(page.getByRole('dialog', { name: 'Add rule' })).toBeVisible()
  })

  it('shows rules but no way to change them to people who cannot manage', async () => {
    await showRules({ canManage: false })
    await expect.element(page.getByText('checkout/**')).toBeVisible()
    expect(page.getByRole('button').elements()).toHaveLength(0)
  })

  it('closes the dialog with Cancel without saving', async () => {
    const { calls } = await showRules({}, {})
    await page.getByRole('button', { name: 'Add rule' }).click()
    const dialog = page.getByRole('dialog', { name: 'Add rule' })
    await expect.element(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect.element(dialog).not.toBeInTheDocument()
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0)
  })

  it('does not save an unchanged rule', async () => {
    await showRules()
    await openActions('checkout/**')
    await page.getByRole('menuitem', { name: 'Edit' }).click()
    await expect.element(page.getByRole('button', { name: 'Save rule' })).toBeDisabled()
  })

  it('adds a rule from the dialog as soon as it is confirmed', async () => {
    const { calls } = await showRules(
      { rules: [] },
      { [`POST ${API}/rules`]: { status: 201, body: {} } },
    )
    await page.getByRole('button', { name: 'Add rule' }).click()
    await page.getByRole('textbox', { name: 'Pattern' }).fill('settings/*')
    await page.getByRole('checkbox', { name: 'Grace Hopper' }).click()
    await page
      .getByRole('dialog', { name: 'Add rule' })
      .getByRole('button', { name: 'Add rule' })
      .click()
    await expect
      .poll(() => calls.find((c) => c.method === 'POST')?.body)
      .toEqual({ kind: 'snapshot-name', pattern: 'settings/*', reviewerIds: ['u2'] })
    await expect.element(page.getByRole('dialog', { name: 'Add rule' })).not.toBeInTheDocument()
  })

  it('edits a rule in the dialog, starting from its values', async () => {
    const { calls } = await showRules({}, { [`PUT ${API}/rules/r1`]: { body: {} } })
    await openActions('checkout/**')
    await page.getByRole('menuitem', { name: 'Edit' }).click()
    const pattern = page.getByRole('textbox', { name: 'Pattern' })
    await expect.element(pattern).toHaveValue('checkout/**')
    await expect.element(page.getByRole('checkbox', { name: 'Ada Lovelace' })).toBeChecked()
    await pattern.fill('checkout/*')
    await page.getByRole('button', { name: 'Save rule' }).click()
    await expect
      .poll(() => calls.find((c) => c.method === 'PUT')?.body)
      .toEqual({ kind: 'snapshot-name', pattern: 'checkout/*', reviewerIds: ['u1'] })
  })

  it('names the problem with a pattern, and with no reviewer, before asking the server', async () => {
    const { calls } = await showRules({ rules: [] })
    await page.getByRole('button', { name: 'Add rule' }).click()
    await page.getByRole('textbox', { name: 'Pattern' }).fill('checkout/**')
    await page
      .getByRole('dialog', { name: 'Add rule' })
      .getByRole('button', { name: 'Add rule' })
      .click()
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
    await page
      .getByRole('dialog', { name: 'Add rule' })
      .getByRole('button', { name: 'Add rule' })
      .click()
    await expect
      .poll(() => calls.find((c) => c.method === 'POST')?.body)
      .toEqual({ kind: 'build-name', pattern: 'release/*', reviewerIds: ['u1'] })
  })

  it("shows the server's refusal of a rule in the dialog", async () => {
    await showRules(
      { rules: [] },
      { [`POST ${API}/rules`]: { status: 400, body: { error: 'That pattern is too broad' } } },
    )
    await page.getByRole('button', { name: 'Add rule' }).click()
    await page.getByRole('textbox', { name: 'Pattern' }).fill('**')
    await page.getByRole('checkbox', { name: 'Ada Lovelace' }).click()
    await page
      .getByRole('dialog', { name: 'Add rule' })
      .getByRole('button', { name: 'Add rule' })
      .click()
    await expect.element(page.getByRole('alert')).toHaveTextContent('That pattern is too broad')
    await expect.element(page.getByRole('dialog', { name: 'Add rule' })).toBeVisible()
  })

  it('asks before deleting and keeps the rule when cancelled', async () => {
    const { calls } = await showRules()
    await openActions('checkout/**')
    await page.getByRole('menuitem', { name: 'Delete' }).click()
    const dialog = page.getByRole('alertdialog', { name: 'Delete this rule?' })
    await expect.element(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect.element(dialog).not.toBeInTheDocument()
    expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(0)
    await expect.element(page.getByText('checkout/**')).toBeVisible()
  })

  it('deletes the rule once confirmed', async () => {
    const { calls } = await showRules({}, { [`DELETE ${API}/rules/r1`]: { status: 204 } })
    await openActions('checkout/**')
    await page.getByRole('menuitem', { name: 'Delete' }).click()
    await page.getByRole('button', { name: 'Delete rule', exact: true }).click()
    await expect.poll(() => calls.filter((c) => c.method === 'DELETE')).toHaveLength(1)
  })

  it('moves a rule from its menu and sends the new order', async () => {
    const rules = [rule('r1', 'a/*'), rule('r2', 'b/*', { position: 1 })]
    const { calls } = await showRules(
      { rules },
      { [`PUT ${API}/rules/order`]: { body: { rules } } },
    )
    await openActions('b/*')
    await page.getByRole('menuitem', { name: 'Move up' }).click()
    await expect
      .poll(() => calls.find((c) => c.method === 'PUT')?.body)
      .toEqual({ ruleIds: ['r2', 'r1'] })
  })

  it('offers no move beyond the ends of the list', async () => {
    const rules = [rule('r1', 'a/*'), rule('r2', 'b/*', { position: 1 })]
    await showRules({ rules })
    await openActions('a/*')
    await expect
      .element(page.getByRole('menuitem', { name: 'Move up' }))
      .toHaveAttribute('aria-disabled', 'true')
    await userEvent.keyboard('{Escape}')
    await openActions('b/*')
    await expect
      .element(page.getByRole('menuitem', { name: 'Move down' }))
      .toHaveAttribute('aria-disabled', 'true')
  })
})
