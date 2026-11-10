import { beforeEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'

import { menuItemNames } from '#test/support/menu.ts'
import { toastNamed } from '#test/support/toast.ts'

import { decision, detail, fakeBuildApi, renderBuild, shot } from './fake-build-api.tsx'

// The build review reads the session: the fake client, signed in as Ada.
vi.mock('#lib/auth-client.ts', () =>
  import('#test/support/auth-client.ts').then((m) => m.authClientModule),
)

beforeEach(async () => {
  await page.viewport(1280, 900)
})

const row = (name: RegExp) =>
  page.getByRole('navigation', { name: 'Screenshots' }).getByRole('link', { name })

describe('right-click menu on a screenshot row', () => {
  it('offers the row actions of a changed screenshot, baseline included', async () => {
    fakeBuildApi(detail())
    await renderBuild()
    await row(/checkout \/ address/).click({ button: 'right' })
    expect(menuItemNames()).toEqual([
      'Open',
      'Open in new tab',
      'Copy link',
      'Copy name',
      'Approve',
      'Reject',
      'View baseline',
    ])
    await expect
      .element(page.getByRole('menuitem', { name: 'Reject' }))
      .toHaveAttribute('data-tone', 'danger')
  })

  it('has no baseline for an added screenshot and no decision for an unchanged one', async () => {
    fakeBuildApi(detail())
    await renderBuild()
    await row(/home/).click({ button: 'right' })
    await expect.element(page.getByRole('menuitem', { name: 'Open' })).toBeVisible()
    expect(menuItemNames()).not.toContain('View baseline')
    await page.getByRole('menuitem', { name: 'Open' }).click()
    await row(/pricing/).click({ button: 'right' })
    await expect.element(page.getByRole('menuitem', { name: 'Open' })).toBeVisible()
    expect(menuItemNames()).not.toContain('Approve')
    expect(menuItemNames()).not.toContain('Reject')
  })

  it('hides Reject on a screenshot that is already rejected', async () => {
    fakeBuildApi(
      detail(
        {},
        {
          diffs: [
            shot('checkout / payment', 'changed', { review: decision('rejected', 'Too tight') }),
            shot('checkout / address', 'changed'),
          ],
        },
      ),
    )
    await renderBuild()
    await row(/checkout \/ payment/).click({ button: 'right' })
    await expect.element(page.getByRole('menuitem', { name: 'Approve' })).toBeVisible()
    expect(menuItemNames()).not.toContain('Reject')
  })

  it('approves that screenshot, not the selected one, with an Undo toast', async () => {
    const api = fakeBuildApi(detail())
    await renderBuild()
    await row(/checkout \/ address/).click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Approve' }).click()
    await vi.waitFor(() =>
      expect(api.reviews).toEqual([
        JSON.stringify({ snapshotNames: ['checkout / address'], decision: 'approved' }),
      ]),
    )
    await expect.element(toastNamed('Approved checkout / address')).toBeVisible()
    await expect
      .element(toastNamed('Approved checkout / address').getByRole('button', { name: 'Undo' }))
      .toBeVisible()
  })

  it('rejects that screenshot through the reason dialog, which names it', async () => {
    const api = fakeBuildApi(detail())
    await renderBuild()
    await row(/checkout \/ address/).click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Reject' }).click()
    const dialog = page.getByRole('dialog', { name: 'Reject checkout / address?' })
    await expect.element(dialog).toBeVisible()
    await dialog.getByRole('textbox', { name: /Reason/ }).fill('Too tight')
    await dialog.getByRole('button', { name: 'Reject', exact: true }).click()
    await vi.waitFor(() => expect(api.reviews).toHaveLength(1))
    expect(JSON.parse(api.reviews[0] ?? '{}')).toMatchObject({
      snapshotNames: ['checkout / address'],
      decision: 'rejected',
    })
  })
})
