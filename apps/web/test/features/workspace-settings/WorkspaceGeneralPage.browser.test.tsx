import { describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'

import { WorkspaceGeneralPage } from '#features/workspace-settings/WorkspaceGeneralPage.tsx'
import { fakeApi } from '#test/support/fetch.ts'
import { expectNoSidewaysScroll } from '#test/support/overflow.ts'
import { renderPage } from '#test/support/render.tsx'
import { toastNamed } from '#test/support/toast.ts'

const ROUTE = {
  route: '/workspaces/$workspace/settings/general',
  url: '/workspaces/acme/settings/general',
  otherRoutes: [
    '/workspaces/$workspace/settings',
    '/workspaces/$workspace/settings/members',
    '/$workspace/$project/settings/general',
    '/$workspace/$project/settings/reviews',
  ],
}
const general = (canManage = true, over: object = {}) => ({
  canManage,
  isOwner: canManage,
  name: 'Acme Inc',
  slug: 'acme',
  picture: null,
  ...over,
})
const project = (slug: string, name: string, over: object = {}) => ({
  slug,
  name,
  color: 'slate',
  icon: null,
  flakyBlocksMerge: null,
  assignTriageToOnCall: null,
  ...over,
})
const settings = (canManage = true, projects?: object[]) => ({
  canManage,
  settings: { flakyBlocksMerge: true, assignTriageToOnCall: false, retentionDays: 90 },
  projects: projects ?? [
    project('web', 'Web app'),
    project('marketing', 'marketing-site', { flakyBlocksMerge: false }),
  ],
})
const open = async (projects: object[]) => {
  await page.viewport(1000, 900)
  fakeApi({
    'GET /api/workspaces/acme': { body: general() },
    'GET /api/workspaces/acme/settings': { body: settings(true, projects) },
  })
  return renderPage(<WorkspaceGeneralPage />, ROUTE)
}
const merge = () => page.getByRole('region', { name: 'Merge gate defaults' })
const triage = () => page.getByRole('region', { name: 'Triage defaults' })
const inherit = (n: number) =>
  Array.from({ length: n }, (_, i) => project(`project-${i + 1}`, `Project ${i + 1}`))
const openPicture = () => page.getByRole('button', { name: 'Change picture' }).click()
const name = () => page.getByRole('textbox', { name: 'Display name' })
const slug = () => page.getByRole('textbox', { name: 'URL slug' })
// The ✓ beside each identity field, there only while its text differs from what is saved.
const saveName = () => page.getByRole('button', { name: 'Save Display name' })
const saveSlug = () => page.getByRole('button', { name: 'Save URL slug' })
// Save changes belongs to the build settings below (merge gate and triage defaults).
const save = () => page.getByRole('button', { name: 'Save changes' })
const flaky = () => page.getByRole('checkbox', { name: /Flaky-only changes block merging/ })
const SLUG_HELP = 'Where the workspace lives in CirCI. Changing it breaks existing links.'

const openAs = (instanceAdmin: boolean) => {
  fakeApi({
    'GET /api/capabilities': {
      body: { instanceAdmin, manageableWorkspaces: [], refusingWorkspaces: [] },
    },
    'GET /api/workspaces/acme': { body: general() },
    'GET /api/workspaces/acme/settings': { body: settings() },
  })
  return renderPage(<WorkspaceGeneralPage />, ROUTE)
}

describe('WorkspaceGeneralPage, the way up', () => {
  it.each([true, false])(
    'has no in-page way up, whoever opens it (instance admin: %s)',
    async (admin) => {
      await page.viewport(1000, 900)
      await openAs(admin)
      await expect.element(page.getByRole('textbox', { name: 'Display name' })).toBeVisible()
      expect(page.getByRole('link', { name: 'Acme Inc' }).elements()).toHaveLength(0)
    },
  )
})

describe('WorkspaceGeneralPage', () => {
  it('keeps the picture in a popover on the avatar: Upload for a manager, no Remove without one', async () => {
    await page.viewport(1000, 900)
    fakeApi({
      'GET /api/workspaces/acme': { body: general() },
      'GET /api/workspaces/acme/settings': { body: settings() },
    })
    await renderPage(<WorkspaceGeneralPage />, ROUTE)
    expect(page.getByRole('button', { name: 'Upload picture' }).elements()).toHaveLength(0)
    await openPicture()
    await expect.element(page.getByRole('button', { name: 'Upload picture' })).toBeEnabled()
    expect(page.getByRole('button', { name: 'Remove picture' }).elements()).toHaveLength(0)
    await userEvent.keyboard('{Escape}')
    await expect.element(page.getByRole('button', { name: 'Change picture' })).toHaveFocus()
  })

  // A 1×1 PNG the browser can load (the shared avatar draws the picture only once it has).
  const PICTURE =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

  it('shows the picture, replaces it and removes it', async () => {
    await page.viewport(1000, 900)
    const api = fakeApi({
      'GET /api/workspaces/acme': {
        body: general(true, { picture: PICTURE }),
      },
      'GET /api/workspaces/acme/settings': { body: settings() },
      'PUT /api/workspaces/acme/picture': {
        body: { picture: '/api/workspaces/acme/picture?v=def' },
      },
      'DELETE /api/workspaces/acme/picture': { body: { picture: null } },
    })
    await renderPage(<WorkspaceGeneralPage />, ROUTE)
    await openPicture()
    await expect.element(page.getByRole('button', { name: 'Replace picture' })).toBeVisible()
    // The avatar shows the picture once it has loaded.
    await expect.poll(() => document.querySelector(`img[src="${PICTURE}"]`)).not.toBeNull()

    const input = document.querySelector<HTMLInputElement>('input[type="file"]')
    const file = new File([new Uint8Array([137, 80, 78, 71])], 'logo.png', { type: 'image/png' })
    const transfer = new DataTransfer()
    transfer.items.add(file)
    if (!input) throw new Error('no file input')
    input.files = transfer.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
    await expect.poll(() => api.of('PUT')).toHaveLength(1)

    await page.getByRole('button', { name: 'Remove picture' }).click()
    await expect.poll(() => api.of('DELETE')).toHaveLength(1)
  })

  it('refuses a file of the wrong type or size before sending it', async () => {
    await page.viewport(1000, 900)
    const api = fakeApi({
      'GET /api/workspaces/acme': { body: general() },
      'GET /api/workspaces/acme/settings': { body: settings() },
      'PUT /api/workspaces/acme/picture': { body: { picture: 'x' } },
    })
    await renderPage(<WorkspaceGeneralPage />, ROUTE)
    await openPicture()
    await expect.element(page.getByRole('button', { name: 'Upload picture' })).toBeVisible()
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')
    if (!input) throw new Error('no file input')
    const send = (file: File) => {
      const transfer = new DataTransfer()
      transfer.items.add(file)
      input.files = transfer.files
      input.dispatchEvent(new Event('change', { bubbles: true }))
    }
    send(new File(['<svg/>'], 'logo.svg', { type: 'image/svg+xml' }))
    await expect.element(page.getByText('Use a PNG, JPEG or WebP image')).toBeVisible()
    send(new File([new Uint8Array(1024 * 1024 + 1)], 'big.png', { type: 'image/png' }))
    await expect.element(page.getByText('Use an image of at most 1 MB')).toBeVisible()
    expect(api.of('PUT')).toHaveLength(0)
  })

  it('has one Display Settings section: the picture, the display name and the URL slug on one row', async () => {
    await page.viewport(1000, 900)
    fakeApi({
      'GET /api/workspaces/acme': { body: general() },
      'GET /api/workspaces/acme/settings': { body: settings() },
    })
    await renderPage(<WorkspaceGeneralPage />, ROUTE)
    const section = page.getByRole('region', { name: 'Details' })
    await expect.element(section).toBeVisible()
    await expect.element(section.getByRole('button', { name: 'Change picture' })).toBeVisible()
    await expect.element(section.getByRole('textbox', { name: 'Display name' })).toBeVisible()
    await expect.element(section.getByRole('textbox', { name: 'URL slug' })).toBeVisible()
    // The merge gate defaults are their own sections, not part of this one.
    expect(section.getByRole('checkbox').elements()).toHaveLength(0)
    // The old sections and the Address form are gone.
    expect(page.getByRole('region', { name: 'Name and picture' }).elements()).toHaveLength(0)
    expect(page.getByRole('region', { name: 'Address' }).elements()).toHaveLength(0)
    expect(page.getByRole('form', { name: 'Address' }).elements()).toHaveLength(0)

    const picture = page
      .getByRole('button', { name: 'Change picture' })
      .element()
      .getBoundingClientRect()
    const nameBox = name().element().getBoundingClientRect()
    const slugBox = slug().element().getBoundingClientRect()
    // The picture comes first; the two fields sit side by side, level with each other.
    expect(picture.right).toBeLessThanOrEqual(nameBox.left)
    expect(nameBox.right).toBeLessThanOrEqual(slugBox.left)
    expect(Math.abs(nameBox.top - slugBox.top)).toBeLessThan(2)
    // And the picture is on the fields' row, not above or below it.
    expect(picture.top).toBeLessThan(nameBox.bottom)
    expect(picture.bottom).toBeGreaterThan(nameBox.top)
  })

  it('shows the ✓ on a field only while its text differs from what is saved', async () => {
    await page.viewport(1000, 900)
    fakeApi({
      'GET /api/workspaces/acme': { body: general() },
      'GET /api/workspaces/acme/settings': { body: settings() },
    })
    await renderPage(<WorkspaceGeneralPage />, ROUTE)
    await expect.element(name()).toHaveValue('Acme Inc')
    expect(saveName().elements()).toHaveLength(0)
    expect(saveSlug().elements()).toHaveLength(0)

    await name().fill('Acme Corp')
    await expect.element(saveName()).toBeVisible()
    await expect.element(saveName()).toBeEnabled()
    // Only the field that was edited gets one.
    expect(saveSlug().elements()).toHaveLength(0)

    // Back to the saved text, and the ✓ goes away.
    await name().fill('Acme Inc')
    await expect.element(saveName()).not.toBeInTheDocument()

    // Spaces around the saved text are not a change either.
    await name().fill(' Acme Inc ')
    await expect.element(saveName()).not.toBeInTheDocument()
    await slug().fill('acme-co')
    await expect.element(saveSlug()).toBeVisible()
    expect(saveName().elements()).toHaveLength(0)
  })

  it('shows the name, slug, merge defaults and a danger zone', async () => {
    await page.viewport(1000, 900)
    fakeApi({
      'GET /api/workspaces/acme': { body: general() },
      'GET /api/workspaces/acme/settings': { body: settings() },
    })
    await renderPage(<WorkspaceGeneralPage />, ROUTE)
    await expect.element(name()).toHaveValue('Acme Inc')
    await expect.element(slug()).toHaveValue('acme')
    await expect.element(page.getByRole('navigation', { name: 'Breadcrumb' })).toBeVisible()
    await expect
      .element(page.getByRole('checkbox', { name: /Flaky-only changes block merging/ }))
      .toBeChecked()
    await expect.element(page.getByRole('button', { name: 'Delete workspace' })).toBeEnabled()
    // Nothing to save yet: no ✓ on either field, and the build settings' Save changes is off.
    expect(saveName().elements()).toHaveLength(0)
    expect(saveSlug().elements()).toHaveLength(0)
    await expect.element(save()).toBeDisabled()
    // The merge gate default says who follows it and who sets their own, as project avatars.
    await expect
      .element(page.getByRole('link', { name: "Open Web app's setting" }).first())
      .toBeVisible()
    await expect.element(page.getByText('inherits this').first()).toBeVisible()
    await expect
      .element(page.getByRole('link', { name: "Open marketing-site's setting" }).first())
      .toBeVisible()
    await expect.element(page.getByText('sets its own').first()).toBeVisible()
  })

  describe('projects under the defaults', () => {
    it('shows each inheriting project as an avatar link named after it, with its name in a tooltip', async () => {
      await open([project('web', 'Web app'), project('docs', 'Docs')])
      await expect
        .element(merge().getByRole('link', { name: "Open Web app's setting" }))
        .toBeVisible()
      await expect.element(merge().getByRole('link', { name: "Open Docs's setting" })).toBeVisible()
      await expect.element(merge().getByText('inherit this')).toBeVisible()
      // Named for what they open, 24px or more, and not overlapping.
      await expect.element(merge().getByRole('link', { name: "Open Docs's setting" })).toBeVisible()
      const boxes = merge()
        .getByRole('link')
        .elements()
        .map((el) => el.getBoundingClientRect())
      for (const box of boxes) expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(24)
      for (let i = 1; i < boxes.length; i++) {
        expect(boxes[i]!.left).toBeGreaterThanOrEqual(boxes[i - 1]!.right)
      }
      await merge().getByRole('link', { name: "Open Docs's setting" }).hover()
      await expect.element(page.getByRole('tooltip')).toHaveTextContent('Docs')
    })

    it('goes to the project’s merge gate setting from the merge gate defaults', async () => {
      const { router } = await open([project('web', 'Web app')])
      await merge().getByRole('link', { name: "Open Web app's setting" }).click()
      await expect.poll(() => router.state.location.pathname).toBe('/acme/web/settings/general')
      expect(router.state.location.hash).toBe('merge-gate')
    })

    it('goes to the project’s assign-to-triage setting from the triage defaults', async () => {
      const { router } = await open([project('web', 'Web app')])
      await triage().getByRole('link', { name: "Open Web app's setting" }).click()
      await expect.poll(() => router.state.location.pathname).toBe('/acme/web/settings/reviews')
      expect(router.state.location.hash).toBe('assign-on-call')
    })

    it('puts the setting in the links’ addresses, so a new tab opens at it', async () => {
      await open([project('web', 'Web app')])
      await expect
        .element(merge().getByRole('link', { name: "Open Web app's setting" }))
        .toHaveAttribute('href', '/acme/web/settings/general#merge-gate')
      await expect
        .element(triage().getByRole('link', { name: "Open Web app's setting" }))
        .toHaveAttribute('href', '/acme/web/settings/reviews#assign-on-call')
    })

    it('says "inherits this" for one project', async () => {
      await open([project('web', 'Web app')])
      await expect.element(merge().getByText('inherits this')).toBeVisible()
    })

    it('says no project inherits when every project sets its own', async () => {
      await open([
        project('web', 'Web app', { flakyBlocksMerge: true, assignTriageToOnCall: false }),
        project('docs', 'Docs', { flakyBlocksMerge: false, assignTriageToOnCall: true }),
      ])
      await expect.element(merge().getByText('No project inherits this')).toBeVisible()
      await expect.element(triage().getByText('No project inherits this')).toBeVisible()
      await expect.element(merge().getByText('set their own')).toBeVisible()
    })

    it('shows the first eight avatars and a +N chip whose tooltip lists the rest', async () => {
      await open(inherit(11))
      await expect.element(merge().getByRole('link').first()).toBeVisible()
      expect(merge().getByRole('link').elements()).toHaveLength(8)
      const more = merge().getByText('+3')
      await expect.element(more).toBeVisible()
      // Hovering the stack spreads it, which moves the chip (instantly: the test browser prefers reduced motion).
      await merge().getByRole('link').first().hover()
      await more.hover()
      await expect
        .element(page.getByRole('tooltip'))
        .toHaveTextContent('Project 9, Project 10, Project 11')
    })

    it('shows no chip for eight projects or fewer', async () => {
      await open(inherit(8))
      await expect.element(merge().getByRole('link').first()).toBeVisible()
      expect(merge().getByRole('link').elements()).toHaveLength(8)
      expect(
        merge()
          .getByText(/^\+\d+$/)
          .elements(),
      ).toHaveLength(0)
    })

    it('shows the projects that set their own as avatars with their value in the tooltip', async () => {
      await open([
        project('web', 'Web app'),
        project('marketing', 'marketing-site', { flakyBlocksMerge: false }),
        project('docs', 'Docs', { flakyBlocksMerge: true }),
      ])
      await expect.element(merge().getByText('set their own')).toBeVisible()
      await expect
        .element(merge().getByRole('link', { name: "Open marketing-site's setting" }))
        .toBeVisible()
      await merge().getByRole('link', { name: "Open marketing-site's setting" }).hover()
      await expect.element(page.getByRole('tooltip')).toHaveTextContent('marketing-site: off')
      // Triage has no overrides here, so it has no "set their own".
      expect(
        triage()
          .getByText(/set their own|sets its own/)
          .elements(),
      ).toHaveLength(0)
    })
  })

  it('keeps the danger zone in its own section, after the others', async () => {
    await page.viewport(1000, 900)
    fakeApi({
      'GET /api/workspaces/acme': { body: general() },
      'GET /api/workspaces/acme/settings': { body: settings() },
    })
    await renderPage(<WorkspaceGeneralPage />, ROUTE)
    const danger = page.getByRole('region', { name: 'Danger zone' })
    await expect.element(danger).toBeVisible()
    await expect.element(danger).toHaveAttribute('data-tone', 'danger')
    await expect.element(danger.getByText(/restore it/)).toBeVisible()
    const headings = page.getByRole('heading', { level: 2 }).elements()
    expect(headings.at(-1)?.textContent).toBe('Danger zone')
  })

  it("disables deleting for an admin who isn't an owner", async () => {
    await page.viewport(1000, 900)
    fakeApi({
      'GET /api/workspaces/acme': { body: general(true, { isOwner: false }) },
      'GET /api/workspaces/acme/settings': { body: settings() },
    })
    await renderPage(<WorkspaceGeneralPage />, ROUTE)
    await expect.element(page.getByRole('button', { name: 'Delete workspace' })).toBeDisabled()
  })

  it('deletes only after the slug is typed, then leaves the workspace', async () => {
    await page.viewport(1000, 900)
    const api = fakeApi({
      'GET /api/workspaces/acme': { body: general() },
      'GET /api/workspaces/acme/settings': { body: settings() },
      'DELETE /api/workspaces/acme': { body: { purgeAt: '2030-02-01T00:00:00.000Z' } },
    })
    await renderPage(<WorkspaceGeneralPage />, ROUTE)
    await page.getByRole('button', { name: 'Delete workspace' }).click()
    const dialog = page.getByRole('dialog', { name: 'Delete Acme Inc?' })
    const confirm = dialog.getByRole('button', { name: 'Delete workspace' })
    const field = dialog.getByRole('textbox', { name: 'Type acme to confirm' })
    await expect.element(confirm).toBeDisabled()
    // The display name is not the confirmation: the slug is.
    await field.fill('Acme Inc')
    await expect.element(confirm).toBeDisabled()
    await field.fill('ac')
    await expect.element(confirm).toBeDisabled()
    await field.fill('acme')
    await expect.element(confirm).toBeEnabled()
    await confirm.click()
    await expect.poll(() => api.of('DELETE')).toHaveLength(1)
    expect(api.of('DELETE')[0]?.body).toEqual({ confirm: 'acme' })
  })

  it('replaces the slug description with the warning about links while it is edited', async () => {
    await page.viewport(1000, 900)
    fakeApi({
      'GET /api/workspaces/acme': { body: general() },
      'GET /api/workspaces/acme/settings': { body: settings() },
    })
    await renderPage(<WorkspaceGeneralPage />, ROUTE)
    await expect.element(page.getByText(SLUG_HELP)).toBeVisible()
    expect(page.getByText(/stop working, including bookmarks/).elements()).toHaveLength(0)
    await slug().fill('acme-co')
    const warning = page.getByText(/stop working, including bookmarks/)
    await expect.element(warning).toBeVisible()
    await expect.element(warning).toMatchTextContent('Links with /acme/ in them stop working')
    await expect.element(warning).toMatchTextContent('New builds post the new address.')
    await expect.element(page.getByText(SLUG_HELP)).not.toBeInTheDocument()
    // Back to the saved text: the description is back too.
    await slug().fill('acme')
    await expect.element(page.getByText(SLUG_HELP)).toBeVisible()
    await expect.element(warning).not.toBeInTheDocument()
  })

  it('puts the saved slug back on Escape, and the ✓ and the warning go away', async () => {
    await page.viewport(1000, 900)
    const api = fakeApi({
      'GET /api/workspaces/acme': { body: general() },
      'GET /api/workspaces/acme/settings': { body: settings() },
    })
    await renderPage(<WorkspaceGeneralPage />, ROUTE)
    await slug().fill('acme-co')
    await expect.element(saveSlug()).toBeVisible()
    await expect.element(page.getByText(/stop working, including bookmarks/)).toBeVisible()
    await userEvent.keyboard('{Escape}')
    await expect.element(slug()).toHaveValue('acme')
    await expect.element(saveSlug()).not.toBeInTheDocument()
    await expect
      .element(page.getByText(/stop working, including bookmarks/))
      .not.toBeInTheDocument()
    expect(api.of('PATCH')).toHaveLength(0)
  })

  it('refuses a bad address without asking the server', async () => {
    await page.viewport(1000, 900)
    const api = fakeApi({
      'GET /api/workspaces/acme': { body: general() },
      'GET /api/workspaces/acme/settings': { body: settings() },
    })
    await renderPage(<WorkspaceGeneralPage />, ROUTE)
    await slug().fill('Not Valid')
    await saveSlug().click()
    await expect
      .element(page.getByText(/lowercase letters, digits or single hyphens/))
      .toBeVisible()
    expect(api.of('PATCH')).toHaveLength(0)
  })

  it('saves only the changed field and follows a new address', async () => {
    await page.viewport(1000, 900)
    let current = general()
    const api = fakeApi({
      'GET /api/workspaces/acme': () => ({ body: current }),
      'GET /api/workspaces/acme-co': () => ({ body: current }),
      'GET /api/workspaces/acme/settings': { body: settings() },
      'GET /api/workspaces/acme-co/settings': { body: settings() },
      'PATCH /api/workspaces/acme': () => {
        current = general(true, { slug: 'acme-co' })
        return { body: { name: 'Acme Inc', slug: 'acme-co' } }
      },
    })
    const { router } = await renderPage(<WorkspaceGeneralPage />, ROUTE)
    await slug().fill('acme-co')
    await saveSlug().click()
    await expect
      .poll(() => router.state.location.pathname)
      .toBe('/workspaces/acme-co/settings/general')
    expect(api.of('PATCH')[0]?.body).toEqual({ slug: 'acme-co' })
    await expect.element(slug()).toHaveValue('acme-co')
    await expect.element(toastNamed('URL slug saved')).toBeInTheDocument()
  })

  it('saves the slug on Enter too', async () => {
    await page.viewport(1000, 900)
    const api = fakeApi({
      'GET /api/workspaces/acme': { body: general() },
      'GET /api/workspaces/acme/settings': { body: settings() },
      'PATCH /api/workspaces/acme': { body: { name: 'Acme Inc', slug: 'acme' } },
    })
    await renderPage(<WorkspaceGeneralPage />, ROUTE)
    await slug().fill('acme-co')
    await userEvent.keyboard('{Enter}')
    await expect.poll(() => api.of('PATCH')).toHaveLength(1)
    expect(api.of('PATCH')[0]?.body).toEqual({ slug: 'acme-co' })
  })

  it('shows why a save was refused', async () => {
    await page.viewport(1000, 900)
    fakeApi({
      'GET /api/workspaces/acme': { body: general() },
      'GET /api/workspaces/acme/settings': { body: settings() },
      'PATCH /api/workspaces/acme': { status: 409, body: { error: 'That address is taken' } },
    })
    await renderPage(<WorkspaceGeneralPage />, ROUTE)
    await slug().fill('taken')
    await saveSlug().click()
    await expect.element(page.getByRole('alert')).toHaveTextContent('That address is taken')
  })

  it('saves the name with its ✓, and nothing else, with a Name saved toast', async () => {
    await page.viewport(1000, 900)
    const api = fakeApi({
      'GET /api/workspaces/acme': { body: general() },
      'GET /api/workspaces/acme/settings': { body: settings() },
      'PATCH /api/workspaces/acme': { body: { name: 'Acme Corp', slug: 'acme' } },
    })
    await renderPage(<WorkspaceGeneralPage />, ROUTE)
    await expect.element(name()).toHaveValue('Acme Inc')
    await name().fill('  Acme Corp  ')
    expect(api.of('PATCH')).toHaveLength(0)
    await saveName().click()
    await expect.poll(() => api.of('PATCH')).toHaveLength(1)
    // Only the name, trimmed: the slug is its own field.
    expect(api.of('PATCH')[0]?.body).toEqual({ name: 'Acme Corp' })
    await expect.element(toastNamed('Name saved')).toBeInTheDocument()
  })

  it('saves the name on Enter', async () => {
    await page.viewport(1000, 900)
    const api = fakeApi({
      'GET /api/workspaces/acme': { body: general() },
      'GET /api/workspaces/acme/settings': { body: settings() },
      'PATCH /api/workspaces/acme': { body: { name: 'Acme Corp', slug: 'acme' } },
    })
    await renderPage(<WorkspaceGeneralPage />, ROUTE)
    await name().fill('Acme Corp')
    await userEvent.keyboard('{Enter}')
    await expect.poll(() => api.of('PATCH')).toHaveLength(1)
    expect(api.of('PATCH')[0]?.body).toEqual({ name: 'Acme Corp' })
  })

  it('does nothing when the name field is left: the ✓ stays and nothing is sent', async () => {
    await page.viewport(1000, 900)
    const api = fakeApi({
      'GET /api/workspaces/acme': { body: general() },
      'GET /api/workspaces/acme/settings': { body: settings() },
      'PATCH /api/workspaces/acme': { body: { name: 'Acme Corp', slug: 'acme' } },
    })
    await renderPage(<WorkspaceGeneralPage />, ROUTE)
    await name().fill('Acme Corp')
    await slug().click()
    await expect.element(slug()).toHaveFocus()
    expect(api.of('PATCH')).toHaveLength(0)
    await expect.element(name()).toHaveValue('Acme Corp')
    await expect.element(saveName()).toBeVisible()
  })

  it('puts the saved name back on Escape', async () => {
    await page.viewport(1000, 900)
    const api = fakeApi({
      'GET /api/workspaces/acme': { body: general() },
      'GET /api/workspaces/acme/settings': { body: settings() },
    })
    await renderPage(<WorkspaceGeneralPage />, ROUTE)
    await name().fill('Acme Corp')
    await userEvent.keyboard('{Escape}')
    await expect.element(name()).toHaveValue('Acme Inc')
    await expect.element(saveName()).not.toBeInTheDocument()
    expect(api.of('PATCH')).toHaveLength(0)
  })

  it('keeps an address being typed when the name is saved, and shows a failed name in line', async () => {
    await page.viewport(1000, 900)
    const api = fakeApi({
      'GET /api/workspaces/acme': { body: general() },
      'GET /api/workspaces/acme/settings': { body: settings() },
      'PATCH /api/workspaces/acme': { status: 400, body: { error: 'Name is too long' } },
    })
    await renderPage(<WorkspaceGeneralPage />, ROUTE)
    await slug().fill('acme-co')
    await name().fill('Acme Corp')
    await saveName().click()
    await expect.poll(() => api.of('PATCH')).toHaveLength(1)
    // The failure shows on the name field, in line, and what was typed stays with its ✓.
    await expect.element(page.getByRole('alert')).toHaveTextContent('Name is too long')
    await expect.element(name()).toHaveValue('Acme Corp')
    await expect.element(saveName()).toBeVisible()
    await expect.element(slug()).toHaveValue('acme-co')
    await expect.element(page.getByText(/stop working, including bookmarks/)).toBeVisible()
  })

  it('refuses an empty name on the field without asking the server', async () => {
    await page.viewport(1000, 900)
    const api = fakeApi({
      'GET /api/workspaces/acme': { body: general() },
      'GET /api/workspaces/acme/settings': { body: settings() },
    })
    await renderPage(<WorkspaceGeneralPage />, ROUTE)
    await name().fill('  ')
    await saveName().click()
    await expect.element(page.getByText('Enter a name')).toBeVisible()
    expect(api.of('PATCH')).toHaveLength(0)
  })

  it('sends members to Members instead of showing the settings', async () => {
    await page.viewport(1000, 900)
    fakeApi({
      'GET /api/workspaces/acme': { body: general(false) },
      'GET /api/workspaces/acme/settings': { body: settings(false) },
    })
    const { router } = await renderPage(<WorkspaceGeneralPage />, ROUTE)
    await expect
      .poll(() => router.state.location.pathname)
      .toBe('/workspaces/acme/settings/members')
    expect(name().elements()).toHaveLength(0)
  })

  it("says the workspace doesn't exist for a 404", async () => {
    await page.viewport(1000, 900)
    fakeApi({ 'GET /api/workspaces/acme': { status: 404, body: { error: 'Workspace not found' } } })
    await renderPage(<WorkspaceGeneralPage />, ROUTE)
    await expect.element(page.getByText("This workspace doesn't exist")).toBeVisible()
  })
})

/** The Save buttons that are on screen (a form with nothing to save hides its bar). */
const shownSaves = () =>
  save()
    .elements()
    .filter((el) => el.getBoundingClientRect().height > 0)

describe('WorkspaceGeneralPage on a phone', () => {
  it('pins Save and Discard to the bottom of the window, over the page, with 44px buttons', async () => {
    await page.viewport(390, 520)
    fakeApi({
      'GET /api/workspaces/acme': { body: general() },
      'GET /api/workspaces/acme/settings': { body: settings() },
    })
    await renderPage(<WorkspaceGeneralPage />, ROUTE)
    await flaky().click()
    const footer = save().first().element().parentElement
    expect(footer).not.toBeNull()
    expect(getComputedStyle(footer!).position).toBe('sticky')
    // The page is taller than the window, and the bar still sits on its bottom edge.
    expect(document.documentElement.scrollHeight).toBeGreaterThan(window.innerHeight)
    expect(Math.round(footer!.getBoundingClientRect().bottom)).toBe(window.innerHeight)
    expect(save().first().element().getBoundingClientRect().height).toBeGreaterThanOrEqual(44)
    expect(
      page.getByRole('button', { name: 'Discard' }).first().element().getBoundingClientRect()
        .height,
    ).toBeGreaterThanOrEqual(44)
    expectNoSidewaysScroll()
  })

  it('leaves the buttons in the form on a desktop', async () => {
    await page.viewport(1000, 520)
    fakeApi({
      'GET /api/workspaces/acme': { body: general() },
      'GET /api/workspaces/acme/settings': { body: settings() },
    })
    await renderPage(<WorkspaceGeneralPage />, ROUTE)
    await flaky().click()
    const footer = save().first().element().parentElement
    expect(getComputedStyle(footer!).position).not.toBe('sticky')
  })

  it('shows one Save and Discard, only once the build settings have a change; a field edit brings its ✓ and no bar', async () => {
    await page.viewport(390, 844)
    fakeApi({
      'GET /api/workspaces/acme': { body: general() },
      'GET /api/workspaces/acme/settings': { body: settings() },
    })
    await renderPage(<WorkspaceGeneralPage />, ROUTE)
    await expect.element(slug()).toBeVisible()
    expect(shownSaves()).toHaveLength(0)
    // Editing a field brings its own ✓ (the identity fields have no Save bar).
    await userEvent.type(slug(), '-2')
    await expect.element(saveSlug()).toBeVisible()
    expect(shownSaves()).toHaveLength(0)
    await userEvent.keyboard('{Escape}')
    await expect.element(saveSlug()).not.toBeInTheDocument()
    // A change in the build settings shows the one bar.
    await flaky().click()
    await expect.poll(() => shownSaves().length).toBe(1)
    expect(
      page
        .getByRole('button', { name: 'Discard' })
        .elements()
        .filter((el) => el.getBoundingClientRect().height > 0),
    ).toHaveLength(1)
  })

  it('shows the build settings form with Save changes disabled until it has a change, on a desktop', async () => {
    await page.viewport(1000, 900)
    fakeApi({
      'GET /api/workspaces/acme': { body: general() },
      'GET /api/workspaces/acme/settings': { body: settings() },
    })
    await renderPage(<WorkspaceGeneralPage />, ROUTE)
    await expect.element(slug()).toBeVisible()
    // One form with buttons now (merge gate and triage defaults share it); the identity fields have a ✓ instead.
    await expect.poll(() => save().elements().length).toBe(1)
    expect(save().element().getBoundingClientRect().height).toBeGreaterThan(0)
    await expect.element(save()).toBeDisabled()
    await expect.element(page.getByRole('button', { name: 'Discard' })).toBeDisabled()
    await flaky().click()
    await expect.element(save()).toBeEnabled()
  })
})
