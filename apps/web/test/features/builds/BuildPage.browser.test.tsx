import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type Locator, page, userEvent } from 'vitest/browser'

import { decision, detail, fakeBuildApi, renderBuild, shot } from './fake-build-api.tsx'

// The build review reads the session (avatar, reviewer picker): the fake client, signed in as
// Ada, so better-auth's own session store never refetches outside a test's fake.
vi.mock('#lib/auth-client.ts', () =>
  import('#test/support/auth-client.ts').then((m) => m.authClientModule),
)

beforeEach(async () => {
  await page.viewport(1280, 900)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/** The exact text of an element once it's there (the browser matcher can't take a pattern). */
async function hasText(locator: Locator, pattern: RegExp) {
  await expect.element(locator).toBeVisible()
  expect(locator.element().textContent).toMatch(pattern)
}

const viewerTitle = () => page.getByRole('heading', { level: 2 })

const filed = (snapshotName: string | null) => ({
  id: `i-${snapshotName}`,
  key: snapshotName ? 'WEB-9' : 'WEB-1',
  url: 'https://x.test/WEB-9',
  title: 'Visual regression',
  tracker: 'jira',
  snapshotName,
  createdAt: new Date().toISOString(),
  createdBy: 'Dana',
})

describe('issues on a snapshot', () => {
  it("shows a link row under the selected snapshot's header, and not under another", async () => {
    const api = fakeBuildApi(detail())
    api.issues = { issues: [filed('checkout / payment')], trackers: [] }
    await renderBuild()
    const row = page.getByRole('list', { name: 'Issues for this screenshot' })
    const link = row.getByRole('link', { name: 'WEB-9 · Jira' })
    await expect.element(link).toHaveAttribute('href', 'https://x.test/WEB-9')
    await expect.element(link).toHaveAttribute('target', '_blank')
    // No toast: the row is the whole confirmation.
    expect(
      page
        .getByRole('status')
        .elements()
        .map((el) => el.textContent),
    ).not.toContain(expect.stringContaining('WEB-9'))
    // The viewer follows the keys: the next snapshot has no issue.
    await userEvent.keyboard('j')
    await expect.element(viewerTitle()).toHaveTextContent('checkout / address')
    expect(page.getByRole('list', { name: 'Issues for this screenshot' }).elements()).toHaveLength(
      0,
    )
  })
})

describe('BuildPage states', () => {
  it('shows the breadcrumb at once and nothing else while loading', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => {})),
    )
    await renderBuild()
    const crumbs = page.getByRole('navigation', { name: 'Breadcrumb' })
    // Display names stand in as slugs until the teams list arrives; Workspace / Team / Builds / Build #N.
    await expect
      .element(crumbs.getByRole('link', { name: 'acme' }))
      .toHaveAttribute('href', '/inbox')
    await expect.element(crumbs.getByRole('link', { name: 'web-app' })).toBeVisible()
    await expect.element(crumbs.getByRole('link', { name: 'Builds' })).toBeVisible()
    await expect.element(crumbs.getByText('Build #7')).toBeVisible()
    expect(page.getByRole('button', { name: /^Approve all/ }).elements()).toHaveLength(0)
  })

  it("says so in the page's own words when the build doesn't exist", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(new Response(JSON.stringify({ error: 'nope' }), { status: 404 })),
      ),
    )
    await renderBuild()
    await expect.element(page.getByText("This build doesn't exist")).toBeVisible()
  })

  it('offers a retry when the build could not be loaded', async () => {
    const fetchSpy = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response(JSON.stringify({ error: 'database down' }), { status: 500 })),
    )
    vi.stubGlobal('fetch', fetchSpy)
    await renderBuild()
    await expect.element(page.getByText('database down')).toBeVisible()
    const before = fetchSpy.mock.calls.length
    await page.getByRole('button', { name: 'Try again' }).click()
    await vi.waitFor(() => expect(fetchSpy.mock.calls.length).toBeGreaterThan(before))
  })

  it('shows the header, counts, the list and the first change that needs a decision', async () => {
    fakeBuildApi(detail())
    await renderBuild()
    await expect.element(page.getByText('Needs review', { exact: true }).first()).toBeVisible()
    await expect.element(page.getByText('2 changed')).toBeVisible()
    await expect.element(page.getByText('1 added')).toBeVisible()
    await expect.element(page.getByText('PR #42')).toBeVisible()
    await expect.element(page.getByRole('button', { name: 'Copy branch name' })).toBeVisible()
    await expect.element(page.getByRole('button', { name: /^Approve all/ })).toBeVisible()
    await expect.element(page.getByRole('button', { name: 'Approve', exact: true })).toBeVisible()
    await expect.element(page.getByRole('button', { name: 'Reject' })).toBeVisible()
    await expect.element(page.getByText('0 of 3 reviewed')).toBeVisible()
    await expect.element(viewerTitle()).toHaveTextContent('checkout / payment')
    // Both images of the comparison, the baseline first.
    await expect.element(page.getByRole('img', { name: 'Baseline · #6 on main' })).toBeVisible()
    await expect.element(page.getByRole('img', { name: 'This build · 0123456' })).toBeVisible()
  })

  it.each([
    ['pending', 'needs-review', 'Changed'],
    ['approved', 'approved', 'Changed, approved'],
    ['rejected', 'rejected', 'Changed, rejected'],
  ] as const)(
    'a %s build shows %s glyphs on its list rows and count chips, unchanged ones stay neutral',
    async (reviewStatus, glyph, rowName) => {
      // A rejected build is rejected because its snapshots were; give them the decision.
      const diffs =
        reviewStatus === 'rejected'
          ? [
              shot('a', 'changed', { review: decision('rejected') }),
              shot('b', 'changed', { review: decision('rejected') }),
              shot('c', 'added', { review: decision('rejected') }),
              shot('d', 'unchanged'),
              shot('e', 'unchanged'),
            ]
          : undefined
      fakeBuildApi(detail({ reviewStatus }, diffs ? { diffs } : {}))
      await renderBuild()
      const list = page.getByRole('navigation', { name: 'Screenshots' })
      await expect.element(list.getByRole('img', { name: rowName }).first()).toBeVisible()
      const rows = list.getByRole('img', { name: rowName }).elements()
      expect(rows).toHaveLength(2)
      for (const row of rows) expect(row.getAttribute('data-status')).toBe(glyph)
      const added = list.getByRole('img', {
        name: `Added${reviewStatus === 'pending' ? '' : `, ${reviewStatus}`}`,
      })
      const addedGlyph = reviewStatus === 'pending' ? 'added' : glyph
      expect(added.element().getAttribute('data-status')).toBe(addedGlyph)
      // The chips read as their text only (the glyph is hidden), and follow the review too.
      for (const text of ['2 changed', '1 added']) {
        const chip = page.getByText(text).element()
        expect(chip.textContent).toBe(text)
        expect(chip.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
        const expected = text === '1 added' && reviewStatus === 'pending' ? 'added' : glyph
        expect(chip.querySelector('svg')?.getAttribute('data-status')).toBe(expected)
      }
      expect(
        page.getByText('2 unchanged').element().querySelector('svg')?.getAttribute('data-status'),
      ).toBe('neutral')
      // The viewer's header follows it as well.
      const title = viewerTitle().element().parentElement?.querySelector('svg')
      expect(title?.getAttribute('data-status')).toBe(glyph)
    },
  )

  it('keeps a failed screenshot rejected whatever the review', async () => {
    fakeBuildApi(
      detail(
        { reviewStatus: 'approved' },
        { diffs: [shot('broken', 'failed'), shot('a', 'changed')] },
      ),
    )
    await renderBuild()
    const failed = page
      .getByRole('navigation', { name: 'Screenshots' })
      .getByRole('img', { name: 'Failed' })
    await expect.element(failed).toBeVisible()
    expect(failed.element().getAttribute('data-status')).toBe('rejected')
    expect(
      page.getByText('1 failed').element().querySelector('svg')?.getAttribute('data-status'),
    ).toBe('rejected')
  })

  it('calls a build with nothing to compare against "No baseline" and explains it', async () => {
    fakeBuildApi(detail({}, { baseline: null, diffs: [shot('home', 'added')] }))
    await renderBuild()
    await expect.element(page.getByText('No baseline', { exact: true }).first()).toBeVisible()
    await expect
      .element(page.getByText(/This is the first build, so every screenshot is new/))
      .toBeVisible()
    await expect.element(page.getByRole('img', { name: 'New in this build' })).toBeVisible()
  })

  it('warns when the baseline is a fallback', async () => {
    fakeBuildApi(detail({ baselineSource: 'fallback' }))
    await renderBuild()
    await expect.element(page.getByText(/latest on the default branch/)).toBeVisible()
  })

  it('says a decision carried over from an earlier build of the commit was automatic, with its real outcome', async () => {
    fakeBuildApi(
      detail(
        { reviewStatus: 'rejected' },
        {
          reviews: [
            {
              state: 'rejected',
              source: 'rerun',
              reason: null,
              userName: null,
              createdAt: new Date().toISOString(),
            },
          ],
        },
      ),
    )
    await renderBuild()
    await expect
      .element(
        page.getByText(
          'Rejected automatically: an earlier build of this commit, with the same screenshots, was rejected.',
        ),
      )
      .toBeVisible()
    expect(page.getByText(/Approved automatically/).elements()).toHaveLength(0)
  })

  it('says an expired build has expired and offers no decision', async () => {
    fakeBuildApi(detail({ status: 'expired', conclusion: null }))
    await renderBuild()
    await expect.element(page.getByText('This build has expired')).toBeVisible()
    await expect.element(page.getByText('Expired', { exact: true })).toBeVisible()
    expect(page.getByRole('button', { name: /^Approve all/ }).elements()).toHaveLength(0)
    expect(page.getByRole('navigation', { name: 'Screenshots' }).elements()).toHaveLength(0)
  })

  it('shows a banner while processing, and no empty state', async () => {
    fakeBuildApi(detail({ status: 'processing', conclusion: null }, { diffs: [] }))
    await renderBuild()
    await expect.element(page.getByText(/Processing screenshots/)).toBeVisible()
    await expect.element(page.getByText('Processing', { exact: true })).toBeVisible()
    expect(page.getByText('No screenshots in this build').elements()).toHaveLength(0)
  })

  it('says when a finished build has no screenshots', async () => {
    fakeBuildApi(detail({ conclusion: 'no_changes' }, { diffs: [] }))
    await renderBuild()
    await expect.element(page.getByText('No screenshots in this build')).toBeVisible()
  })

  it('shows why a build failed, and why a screenshot did', async () => {
    fakeBuildApi(
      detail(
        { status: 'error', conclusion: null, errorMessage: 'Upload was incomplete' },
        { diffs: [shot('login', 'failed', { errorMessage: 'Not a PNG' })] },
      ),
    )
    await renderBuild()
    await expect.element(page.getByText('Upload was incomplete')).toBeVisible()
    await expect.element(page.getByText('Not a PNG')).toBeVisible()
  })

  it('shows an added screenshot without view modes', async () => {
    fakeBuildApi(detail({}, { diffs: [shot('home', 'added')] }))
    await renderBuild()
    expect(page.getByRole('group', { name: 'View' }).elements()).toHaveLength(0)
  })

  it('sets a known-flaky change aside in a collapsed Flaky group', async () => {
    const api = fakeBuildApi(detail())
    api.flaky = [{ name: 'checkout / address', changedIn: 6 }]
    await renderBuild()
    const list = page.getByRole('navigation', { name: 'Screenshots' })
    await expect
      .element(list.getByRole('button', { name: /Flaky/ }))
      .toHaveAttribute('aria-expanded', 'false')
    await hasText(list.getByRole('button', { name: /Changed/ }), /Changed\s*1$/)
  })
})

describe('the screenshot list', () => {
  it('has the groups with their counts, Unchanged collapsed, and opens and closes them', async () => {
    fakeBuildApi(detail())
    await renderBuild()
    const list = page.getByRole('navigation', { name: 'Screenshots' })
    await hasText(list.getByRole('button', { name: /Changed/ }), /Changed\s*2$/)
    await hasText(list.getByRole('button', { name: /Added/ }), /Added\s*1$/)
    const unchanged = list.getByRole('button', { name: /Unchanged/ })
    await expect.element(unchanged).toHaveAttribute('aria-expanded', 'false')
    expect(list.getByRole('link', { name: /pricing/ }).elements()).toHaveLength(0)
    await unchanged.click()
    await expect.element(list.getByRole('link', { name: /pricing/ })).toBeVisible()
    await unchanged.click()
    await expect.element(list.getByRole('link', { name: /pricing/ })).not.toBeInTheDocument()
  })

  it('names each row by its status and name, with the diff percentage', async () => {
    fakeBuildApi(detail())
    await renderBuild()
    const row = page.getByRole('link', { name: /checkout \/ payment/ })
    await hasText(row, /1\.2%$/)
    await expect.element(row.getByRole('img', { name: 'Changed' })).toBeVisible()
    await expect
      .element(page.getByRole('link', { name: /home/ }).getByRole('img', { name: 'Added' }))
      .toBeVisible()
  })

  it('selects a screenshot through the search params and marks it current', async () => {
    fakeBuildApi(detail())
    const { router } = await renderBuild()
    await page.getByRole('link', { name: /checkout \/ address/ }).click()
    expect(router.state.location.search).toMatchObject({ shot: 'checkout / address' })
    await expect.element(viewerTitle()).toHaveTextContent('checkout / address')
    await expect
      .element(page.getByRole('link', { name: /checkout \/ address/ }))
      .toHaveAttribute('aria-current', 'page')
  })

  it('opens a screenshot named in the URL, even in a collapsed group', async () => {
    fakeBuildApi(detail())
    await renderBuild('/acme/web-app/builds/7?shot=pricing')
    await expect.element(viewerTitle()).toHaveTextContent('pricing')
    await expect
      .element(
        page
          .getByRole('navigation', { name: 'Screenshots' })
          .getByRole('button', { name: /Unchanged/ }),
      )
      .toHaveAttribute('aria-expanded', 'true')
  })

  it('lets the open group be collapsed again', async () => {
    fakeBuildApi(detail())
    await renderBuild('/acme/web-app/builds/7?shot=pricing')
    const unchanged = page.getByRole('button', { name: /Unchanged/ })
    await expect.element(unchanged).toHaveAttribute('aria-expanded', 'true')
    await unchanged.click()
    await expect.element(unchanged).toHaveAttribute('aria-expanded', 'false')
  })
})

describe('view modes', () => {
  it('defaults to side by side and follows ?mode=', async () => {
    fakeBuildApi(detail())
    await renderBuild()
    await expect
      .element(page.getByRole('button', { name: 'Side by side' }))
      .toHaveAttribute('aria-pressed', 'true')
    await expect.element(page.getByRole('img', { name: 'This build · 0123456' })).toBeVisible()
  })

  it('switches mode through the search params', async () => {
    fakeBuildApi(detail())
    const { router } = await renderBuild()
    await page.getByRole('button', { name: 'Overlay' }).click()
    expect(router.state.location.search).toMatchObject({ mode: 'overlay' })
    await expect
      .element(page.getByRole('img', { name: 'checkout / payment in this build' }))
      .toBeVisible()
    await expect.element(page.getByRole('slider', { name: 'Diff layer' })).toBeVisible()
    await page.getByRole('button', { name: 'Diff', exact: true }).click()
    expect(router.state.location.search).toMatchObject({ mode: 'diff' })
    await expect.element(page.getByRole('img', { name: 'Changed pixels in red' })).toBeVisible()
    await page.getByRole('button', { name: 'Slider' }).click()
    expect(router.state.location.search).toMatchObject({ mode: 'slider' })
    await expect
      .element(page.getByRole('img', { name: 'checkout / payment in the baseline' }))
      .toBeVisible()
  })

  it('moves the slider divider with the keyboard', async () => {
    fakeBuildApi(detail())
    await renderBuild('/acme/web-app/builds/7?mode=slider')
    const slider = page.getByRole('slider', { name: 'Slider position' })
    await expect.element(slider).toHaveAttribute('aria-valuenow', '50')
    const head = page.getByRole('img', { name: 'checkout / payment in this build' })
    await expect.element(head).toHaveStyle({ clipPath: 'inset(0px 0px 0px 50%)' })
    slider.element().focus()
    await userEvent.keyboard('{ArrowRight}{ArrowRight}')
    await expect.element(slider).toHaveAttribute('aria-valuenow', '52')
    await expect.element(head).toHaveStyle({ clipPath: 'inset(0px 0px 0px 52%)' })
    await userEvent.keyboard('{Home}')
    await expect.element(slider).toHaveAttribute('aria-valuenow', '0')
    await userEvent.keyboard('{End}')
    await expect.element(slider).toHaveAttribute('aria-valuenow', '100')
  })
})

describe('zoom and stepping', () => {
  it('fits by default, then shows the real size and steps', async () => {
    fakeBuildApi(detail())
    await renderBuild()
    await expect
      .element(page.getByRole('button', { name: 'Fit' }))
      .toHaveAttribute('aria-pressed', 'true')
    await page.getByRole('button', { name: '100%' }).click()
    await expect
      .element(page.getByRole('img', { name: 'This build · 0123456' }))
      .toHaveStyle({ width: '400px' })
    await page.getByRole('button', { name: 'Zoom in' }).click()
    await expect.element(page.getByText('150%')).toBeVisible()
    await expect
      .element(page.getByRole('img', { name: 'This build · 0123456' }))
      .toHaveStyle({ width: '600px' })
    await page.getByRole('button', { name: 'Fit' }).click()
    expect(page.getByText('150%').elements()).toHaveLength(0)
  })

  it('steps with the previous and next buttons, disabled at the ends', async () => {
    fakeBuildApi(detail())
    await renderBuild()
    await expect.element(page.getByRole('button', { name: 'Previous screenshot' })).toBeDisabled()
    await page.getByRole('button', { name: 'Next screenshot' }).click()
    await expect.element(viewerTitle()).toHaveTextContent('checkout / address')
    await expect.element(page.getByRole('button', { name: 'Previous screenshot' })).toBeEnabled()
  })
})

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

  it('switches the view with 1 to 4', async () => {
    fakeBuildApi(detail())
    const { router } = await renderBuild()
    await expect.element(viewerTitle()).toBeVisible()
    await userEvent.keyboard('2')
    await vi.waitFor(() => expect(router.state.location.search).toMatchObject({ mode: 'overlay' }))
    await userEvent.keyboard('4')
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
  it('approves the current snapshot with the button, announces it, and moves the count', async () => {
    const api = fakeBuildApi(detail())
    await renderBuild()
    await page.getByRole('button', { name: 'Approve', exact: true }).click()
    await vi.waitFor(() =>
      expect(api.reviews).toEqual([
        body({ snapshotNames: ['checkout / payment'], decision: 'approved' }),
      ]),
    )
    await expect.element(page.getByText('checkout / payment approved.')).toBeInTheDocument()
    await expect.element(page.getByText('1 of 3 reviewed')).toBeVisible()
    // The build waits on the other two: still needs review, and the row's glyph follows.
    await expect.element(page.getByText('Needs review', { exact: true }).first()).toBeVisible()
    const row = page
      .getByRole('navigation', { name: 'Screenshots' })
      .getByRole('img', { name: 'Changed, approved' })
    expect(row.element().getAttribute('data-status')).toBe('approved')
    // This snapshot is decided: it can only be rejected now.
    expect(page.getByRole('button', { name: 'Approve', exact: true }).elements()).toHaveLength(0)
    await expect.element(page.getByRole('button', { name: 'Reject' })).toBeVisible()
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
    await expect.element(page.getByText('2 screenshots approved.')).toBeInTheDocument()
    expect(page.getByRole('button', { name: /^Approve all/ }).elements()).toHaveLength(0)
  })

  it('asks for a reason before rejecting the snapshot, and announces the rejection', async () => {
    const api = fakeBuildApi(detail())
    await renderBuild()
    await page.getByRole('button', { name: 'Reject' }).click()
    const dialog = page.getByRole('dialog', { name: 'Reject checkout / payment?' })
    await expect.element(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect.element(dialog).not.toBeInTheDocument()
    expect(api.reviews).toEqual([])

    await page.getByRole('button', { name: 'Reject' }).click()
    // The reason is required: an empty one is refused with a message and nothing is sent.
    await page.getByRole('dialog').getByRole('button', { name: 'Reject' }).click()
    await expect.element(page.getByText('Say why you are rejecting it.')).toBeVisible()
    expect(api.reviews).toEqual([])

    await page.getByRole('textbox', { name: 'Reason' }).fill('The button lost its focus ring')
    await page.getByRole('dialog').getByRole('button', { name: 'Reject' }).click()
    await vi.waitFor(() =>
      expect(api.reviews).toEqual([
        body({
          snapshotNames: ['checkout / payment'],
          decision: 'rejected',
          reason: 'The button lost its focus ring',
        }),
      ]),
    )
    await expect.element(page.getByText('checkout / payment rejected.')).toBeInTheDocument()
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
    await expect.element(page.getByText('checkout / payment approved.')).toBeInTheDocument()
    // Already approved: a does nothing more.
    await userEvent.keyboard('a')
    expect(api.reviews).toHaveLength(1)
    await userEvent.keyboard('{Shift>}A{/Shift}')
    await vi.waitFor(() =>
      expect(api.reviews[1]).toEqual(
        body({ snapshotNames: ['checkout / address', 'home'], decision: 'approved' }),
      ),
    )
    await expect.element(page.getByText('Approved', { exact: true }).first()).toBeVisible()
    await expect.element(page.getByText('3 of 3 reviewed')).toBeVisible()
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

describe('layout', () => {
  it('puts the list beside the viewer on a wide screen, 240px wide', async () => {
    fakeBuildApi(detail())
    await renderBuild()
    await expect.element(viewerTitle()).toBeVisible()
    const list = page
      .getByRole('navigation', { name: 'Screenshots' })
      .element()
      .getBoundingClientRect()
    const viewer = page.getByRole('region').element().getBoundingClientRect()
    expect(list.width).toBe(240)
    expect(viewer.left).toBeGreaterThanOrEqual(list.right)
  })

  it('stacks the list above the viewer below 820px', async () => {
    await page.viewport(390, 800)
    fakeBuildApi(detail())
    await renderBuild()
    await expect.element(viewerTitle()).toBeVisible()
    const list = page
      .getByRole('navigation', { name: 'Screenshots' })
      .element()
      .getBoundingClientRect()
    const viewer = page.getByRole('region').element().getBoundingClientRect()
    expect(viewer.top).toBeGreaterThanOrEqual(list.bottom - 1)
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390)
  })
})

describe('the linked Figma frame', () => {
  const figma = {
    fileKey: 'FileKey12345',
    nodeId: '1:2',
    url: 'https://www.figma.com/design/FileKey12345?node-id=1-2',
    frameName: 'Payment',
  }

  it('shows a Figma frame link in the snapshot header when the snapshot has one', async () => {
    fakeBuildApi(
      detail(
        {},
        { diffs: [shot('checkout / payment', 'changed', { figma }), shot('home', 'added')] },
      ),
    )
    await renderBuild()
    const chip = page.getByRole('link', { name: 'Figma frame: Payment' })
    await expect.element(chip).toHaveAttribute('href', figma.url)
    await expect.element(chip).toHaveAttribute('target', '_blank')
  })

  it('shows none for a snapshot without a link', async () => {
    fakeBuildApi(detail({}, { diffs: [shot('home', 'added')] }))
    await renderBuild()
    await expect.element(viewerTitle()).toBeVisible()
    expect(page.getByRole('link', { name: /Figma frame/ }).elements()).toHaveLength(0)
  })
})

const frames = () => ({
  baseline: page
    .getByRole('img', { name: /^Baseline/ })
    .element()
    .getBoundingClientRect(),
  build: page
    .getByRole('img', { name: /^This build/ })
    .element()
    .getBoundingClientRect(),
})

describe('side by side', () => {
  it('puts the baseline and this build next to each other at desktop widths', async () => {
    await page.viewport(1512, 900)
    fakeBuildApi(detail())
    await renderBuild()
    await expect.element(viewerTitle()).toBeVisible()
    // Measured once layout settles (images load and the container query applies after the title).
    await expect
      .poll(
        () => {
          const { baseline, build } = frames()
          return Math.abs(baseline.top - build.top) < 2 && build.left > baseline.right
        },
        { timeout: 5000 },
      )
      .toBe(true)
  })

  it('stacks them only when the viewer has no room for two', async () => {
    await page.viewport(420, 900)
    fakeBuildApi(detail())
    await renderBuild()
    await expect.element(viewerTitle()).toBeVisible()
    await expect
      .poll(
        () => {
          const { baseline, build } = frames()
          return build.top > baseline.bottom
        },
        { timeout: 5000 },
      )
      .toBe(true)
  })
})
