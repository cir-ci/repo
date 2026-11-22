import { beforeEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'

import { toastNamed } from '#test/support/toast.ts'

import { decision, detail, fakeBuildApi, renderBuild, shot } from './fake-build-api.tsx'

// The build review reads the session (avatar, reviewer picker): the fake client, signed in as
// Ada, so better-auth's own session store never refetches outside a test's fake.
beforeEach(async () => {
  await page.viewport(1280, 900)
})

// The viewer's title: the heading its section is labelled by. A toast's title is a level-2 heading
// too, so asking for the last (or first) one in the page found an open toast's, and each check
// waited for the toast to close (5 s).
const viewerTitle = () =>
  page.getByRole('region', { name: /^(?!Notifications$)/ }).getByRole('heading', { level: 2 })

describe('keyboard shortcuts', () => {
  it('walks the screenshots with j and k, stopping at the ends', async () => {
    fakeBuildApi(detail())
    await renderBuild()
    await expect.element(viewerTitle()).toHaveTextContent('checkout / payment')
    await userEvent.keyboard('k')
    await expect.element(viewerTitle()).toHaveTextContent('checkout / payment')
    await userEvent.keyboard('j')
    await expect.element(viewerTitle()).toHaveTextContent('checkout / address')
    await userEvent.keyboard('j')
    await expect.element(viewerTitle()).toHaveTextContent('home')
    await userEvent.keyboard('k')
    await expect.element(viewerTitle()).toHaveTextContent('checkout / address')
  })

  it('walks into a collapsed group through its header: j stops there, Right opens it, j enters', async () => {
    fakeBuildApi(detail())
    await renderBuild('/acme/web-app/builds/7?shot=home')
    const group = page.getByRole('button', { name: /Unchanged/ })
    await userEvent.keyboard('j')
    await expect.element(group).toHaveFocus()
    await expect.element(group).toHaveAttribute('aria-expanded', 'false')
    await expect.element(viewerTitle()).toHaveTextContent('home')
    await userEvent.keyboard('{ArrowRight}')
    await expect.element(group).toHaveAttribute('aria-expanded', 'true')
    await userEvent.keyboard('j')
    await expect.element(viewerTitle()).toHaveTextContent('pricing')
  })

  it('opens the group of a screenshot chosen in the URL', async () => {
    fakeBuildApi(detail())
    await renderBuild('/acme/web-app/builds/7?shot=pricing')
    await expect.element(viewerTitle()).toHaveTextContent('pricing')
    await expect
      .element(page.getByRole('button', { name: /Unchanged/ }))
      .toHaveAttribute('aria-expanded', 'true')
  })

  it('switches the view with 1 to 3', async () => {
    fakeBuildApi(detail())
    const { router } = await renderBuild()
    await expect.element(viewerTitle()).toBeVisible()
    await userEvent.keyboard('2')
    await vi.waitFor(() => expect(router.state.location.search).toMatchObject({ mode: 'diff' }))
    await userEvent.keyboard('3')
    await vi.waitFor(() => expect(router.state.location.search).toMatchObject({ mode: 'slider' }))
    await userEvent.keyboard('1')
    await vi.waitFor(() => expect(router.state.location.search).toMatchObject({ mode: 'side' }))
  })

  it('opens the shortcut list with ? and closes it with Escape', async () => {
    fakeBuildApi(detail())
    await renderBuild()
    await expect.element(viewerTitle()).toBeVisible()
    await userEvent.keyboard('?')
    const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' })
    await expect.element(dialog).toBeVisible()
    await expect.element(dialog.getByText('Approve screenshot')).toBeVisible()
    await expect.element(dialog.getByText('Approve all', { exact: true })).toBeVisible()
    await userEvent.keyboard('{Escape}')
    await expect.element(dialog).not.toBeInTheDocument()
  })

  it('does not take keys while a dialog is open', async () => {
    fakeBuildApi(detail())
    await renderBuild()
    await expect.element(viewerTitle()).toBeVisible()
    await userEvent.keyboard('?')
    await expect.element(page.getByRole('dialog')).toBeVisible()
    await userEvent.keyboard('j')
    await expect.element(page.getByRole('dialog')).toBeVisible()
    await userEvent.keyboard('{Escape}')
    await expect.element(viewerTitle()).toHaveTextContent('checkout / payment')
  })
})

const body = (over: object) => JSON.stringify(over)

describe('approving and rejecting', () => {
  it('approves the current snapshot with the button, says so in a toast, and moves the count', async () => {
    const api = fakeBuildApi(detail())
    await renderBuild()
    await page.getByRole('button', { name: 'Approve this screenshot' }).click()
    await vi.waitFor(() =>
      expect(api.reviews).toEqual([
        body({ snapshotNames: ['checkout / payment'], decision: 'approved' }),
      ]),
    )
    await expect.element(toastNamed('Approved checkout / payment')).toBeVisible()
    await expect.element(page.getByText('1 of 3 reviewed')).toBeVisible()
    // The build waits on the other two: still needs review, and the row's glyph follows.
    await expect.element(page.getByText('Needs review', { exact: true }).first()).toBeVisible()
    const row = page
      .getByRole('navigation', { name: 'Screenshots' })
      .getByRole('img', { name: 'Changed, approved' })
    expect(row.element().getAttribute('data-status')).toBe('approved')
    // The selection moved on to the next screenshot that needs review.
    await expect.element(viewerTitle()).toHaveTextContent('checkout / address')
  })

  it('moves to the next screenshot that needs review, skipping decided ones and wrapping round', async () => {
    const api = fakeBuildApi(
      detail(
        {},
        {
          diffs: [
            shot('a', 'changed'),
            shot('b', 'changed', { review: decision('rejected', 'no') }),
            shot('c', 'changed'),
          ],
        },
      ),
    )
    await renderBuild()
    await expect.element(viewerTitle()).toHaveTextContent('a')
    await page.getByRole('button', { name: 'Approve this screenshot' }).click()
    // b is decided, so c is next.
    await expect.element(viewerTitle()).toHaveTextContent('c')
    await page.getByRole('button', { name: 'Approve this screenshot' }).click()
    await vi.waitFor(() => expect(api.reviews).toHaveLength(2))
  })

  it('stays on the screenshot when none is left to review', async () => {
    fakeBuildApi(detail({}, { diffs: [shot('a', 'changed'), shot('b', 'changed')] }))
    await renderBuild()
    await page.getByRole('button', { name: 'Approve this screenshot' }).click()
    await expect.element(viewerTitle()).toHaveTextContent('b')
    await page.getByRole('button', { name: 'Approve this screenshot' }).click()
    await expect.element(toastNamed('Approved b')).toBeVisible()
    await expect.element(viewerTitle()).toHaveTextContent('b')
    // Everything is decided, so there is nothing left for Approve all to do (once the build reloads).
    await expect
      .poll(() => page.getByRole('button', { name: /^Approve all/ }).elements())
      .toHaveLength(0)
  })

  it('approves every undecided snapshot with the button, leaving a rejected one alone', async () => {
    const api = fakeBuildApi(
      detail(
        {},
        {
          diffs: [
            shot('a', 'changed'),
            shot('b', 'changed', { review: decision('rejected', 'no') }),
            shot('c', 'added'),
          ],
        },
      ),
    )
    await renderBuild()
    await page.getByRole('button', { name: /^Approve all/ }).click()
    await vi.waitFor(() =>
      expect(api.reviews).toEqual([body({ snapshotNames: ['a', 'c'], decision: 'approved' })]),
    )
    await expect.element(toastNamed('Approved 2 screenshots')).toBeVisible()
    await expect.element(page.getByRole('button', { name: /^Approve all/ })).not.toBeInTheDocument()
  })

  it("skips the screenshots that couldn't be read when approving all, and the toast says so", async () => {
    const api = fakeBuildApi(
      detail(
        {},
        {
          diffs: [
            shot('broken', 'failed', { errorMessage: "Couldn't read this image: not a PNG" }),
            shot('a', 'changed'),
            shot('c', 'added'),
          ],
        },
      ),
    )
    await renderBuild()
    await page.getByRole('button', { name: /^Approve all/ }).click()
    await vi.waitFor(() =>
      expect(api.reviews).toEqual([body({ snapshotNames: ['a', 'c'], decision: 'approved' })]),
    )
    await expect.element(toastNamed("Approved 2 screenshots; 1 couldn't be read")).toBeVisible()
  })

  it('asks for a reason before rejecting the snapshot, and says so in a toast', async () => {
    const api = fakeBuildApi(detail())
    await renderBuild()
    await page.getByRole('button', { name: 'Reject this screenshot' }).click()
    const dialog = page.getByRole('dialog', { name: 'Reject checkout / payment?' })
    await expect.element(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect.element(dialog).not.toBeInTheDocument()
    expect(api.reviews).toEqual([])

    await page.getByRole('button', { name: 'Reject this screenshot' }).click()
    // The reason is required: an empty one is refused with a message and nothing is sent.
    await page.getByRole('dialog').getByRole('button', { name: 'Reject', exact: true }).click()
    await expect.element(page.getByText('Say why you are rejecting it.')).toBeVisible()
    expect(api.reviews).toEqual([])

    await page.getByRole('textbox', { name: 'Reason' }).fill('The button lost its focus ring')
    await page.getByRole('dialog').getByRole('button', { name: 'Reject', exact: true }).click()
    await vi.waitFor(() =>
      expect(api.reviews).toEqual([
        body({
          snapshotNames: ['checkout / payment'],
          decision: 'rejected',
          reason: 'The button lost its focus ring',
        }),
      ]),
    )
    await expect.element(toastNamed('Rejected checkout / payment')).toBeVisible()
    await expect.element(page.getByText('Rejected', { exact: true }).first()).toBeVisible()
    const row = page
      .getByRole('navigation', { name: 'Screenshots' })
      .getByRole('img', { name: 'Changed, rejected' })
    expect(row.element().getAttribute('data-status')).toBe('rejected')
  })

  it('opens the reject dialog with r and sends it with command-enter', async () => {
    const api = fakeBuildApi(detail())
    await renderBuild()
    await expect.element(viewerTitle()).toBeVisible()
    await userEvent.keyboard('r')
    await expect
      .element(page.getByRole('dialog', { name: 'Reject checkout / payment?' }))
      .toBeVisible()
    await page.getByRole('textbox', { name: 'Reason' }).fill('Wrong colour')
    await userEvent.keyboard('{Meta>}{Enter}{/Meta}')
    await vi.waitFor(() =>
      expect(api.reviews).toEqual([
        body({
          snapshotNames: ['checkout / payment'],
          decision: 'rejected',
          reason: 'Wrong colour',
        }),
      ]),
    )
  })

  it('approves the current snapshot with a, and every undecided one with shift-a', async () => {
    const api = fakeBuildApi(detail())
    await renderBuild()
    await expect.element(viewerTitle()).toBeVisible()
    await userEvent.keyboard('a')
    await vi.waitFor(() =>
      expect(api.reviews).toEqual([
        body({ snapshotNames: ['checkout / payment'], decision: 'approved' }),
      ]),
    )
    await expect.element(toastNamed('Approved checkout / payment')).toBeVisible()
    // The selection moved on, so a approves the next one.
    await expect.element(viewerTitle()).toHaveTextContent('checkout / address')
    await userEvent.keyboard('a')
    await vi.waitFor(() =>
      expect(api.reviews[1]).toEqual(
        body({ snapshotNames: ['checkout / address'], decision: 'approved' }),
      ),
    )
    await userEvent.keyboard('{Shift>}A{/Shift}')
    await vi.waitFor(() =>
      expect(api.reviews[2]).toEqual(body({ snapshotNames: ['home'], decision: 'approved' })),
    )
    await expect.element(page.getByText('Approved', { exact: true }).first()).toBeVisible()
    await expect.element(page.getByText('3 of 3 reviewed')).toBeVisible()
  })

  it('takes an approval back with Undo on its toast', async () => {
    const api = fakeBuildApi(detail())
    await renderBuild()
    await page.getByRole('button', { name: 'Approve this screenshot' }).click()
    await expect.element(toastNamed('Approved checkout / payment')).toBeVisible()
    await expect.element(page.getByText('1 of 3 reviewed')).toBeVisible()
    await toastNamed('Approved checkout / payment').getByRole('button', { name: 'Undo' }).click()
    await vi.waitFor(() => expect(api.undos).toEqual(['undo-1']))
    await expect.element(toastNamed('Undone')).toBeVisible()
    // The page shows it undecided again.
    await expect.element(page.getByText('0 of 3 reviewed')).toBeVisible()
    await expect
      .element(page.getByRole('button', { name: 'Approve this screenshot' }))
      .toBeVisible()
  })

  it('takes a rejection back with Undo, after the reason was given', async () => {
    const api = fakeBuildApi(detail())
    await renderBuild()
    await page.getByRole('button', { name: 'Reject this screenshot' }).click()
    await page.getByRole('textbox', { name: 'Reason' }).fill('Wrong colour')
    await page.getByRole('dialog').getByRole('button', { name: 'Reject', exact: true }).click()
    await expect.element(toastNamed('Rejected checkout / payment')).toBeVisible()
    await toastNamed('Rejected checkout / payment').getByRole('button', { name: 'Undo' }).click()
    await vi.waitFor(() => expect(api.undos).toEqual(['undo-1']))
    await expect.element(toastNamed('Undone')).toBeVisible()
    await expect.element(page.getByRole('button', { name: 'Reject this screenshot' })).toBeVisible()
  })

  it('says why when the server refuses the undo, and leaves the decision as it is', async () => {
    const api = fakeBuildApi(detail())
    api.undoRefusal = "Someone changed this review since, so it can't be undone"
    await renderBuild()
    await page.getByRole('button', { name: 'Approve this screenshot' }).click()
    await toastNamed('Approved checkout / payment').getByRole('button', { name: 'Undo' }).click()
    await expect
      .element(toastNamed("Someone changed this review since, so it can't be undone"))
      .toBeVisible()
    await expect.element(page.getByText('1 of 3 reviewed')).toBeVisible()
  })

  it('shows a toast naming the failure when the decision fails', async () => {
    const api = fakeBuildApi(detail())
    api.reviewError = 'Nope'
    await renderBuild()
    await page.getByRole('button', { name: /^Approve all/ }).click()
    await expect.element(toastNamed("Couldn't review the screenshots")).toBeVisible()
  })

  it('ignores a, shift-a and r on a build that cannot be reviewed', async () => {
    const api = fakeBuildApi(detail({ conclusion: 'no_changes' }))
    await renderBuild()
    await expect.element(viewerTitle()).toBeVisible()
    await userEvent.keyboard('a')
    await userEvent.keyboard('{Shift>}A{/Shift}')
    await userEvent.keyboard('r')
    expect(page.getByRole('alertdialog').elements()).toHaveLength(0)
    expect(api.reviews).toEqual([])
  })

  it("shows the server's message when the decision fails", async () => {
    const api = fakeBuildApi(detail())
    api.reviewError = "You can't review this build"
    await renderBuild()
    await page.getByRole('button', { name: /^Approve all/ }).click()
    await expect.element(page.getByRole('alert')).toHaveTextContent("You can't review this build")
    await expect.element(page.getByRole('button', { name: /^Approve all/ })).toBeEnabled()
  })
})
