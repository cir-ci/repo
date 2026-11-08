import { afterEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'

import { AddIntegrationDialog } from '#features/integrations/AddIntegrationDialog.tsx'
import { FigmaIntegrationPage } from '#features/integrations/FigmaIntegrationPage.tsx'
import { IntegrationsPage } from '#features/integrations/IntegrationsPage.tsx'
import { fakeApi, restoreFetch } from '#test/features/fetch-routes.ts'
import { renderPage } from '#test/support/render.tsx'

import { entry, item } from './fixtures.ts'

afterEach(() => restoreFetch())

const catalog = [
  entry({ kind: 'github', name: 'GitHub' }),
  entry({ kind: 'figma', name: 'Figma', group: 'design' }),
]

describe('Add Figma', () => {
  it('connects with a token, sending it trimmed, and shows the server’s refusal', async () => {
    await page.viewport(1000, 800)
    const fake = fakeApi({
      'POST /api/orgs/acme/integrations/figma': {
        status: 400,
        body: { error: 'Figma rejected the token' },
      },
    })
    await renderPage(
      <AddIntegrationDialog org="acme" open onOpenChange={() => {}} catalog={catalog} added={[]} />,
    )
    await page.getByRole('button', { name: 'Add Figma' }).click()
    await expect.element(page.getByRole('dialog', { name: 'Connect Figma' })).toBeVisible()
    const submit = page.getByRole('button', { name: 'Connect Figma' })
    await expect.element(submit).toBeDisabled()
    await page.getByLabelText('Figma access token').fill('  figd_abcdefgh ')
    await expect.element(submit).toBeEnabled()
    await submit.click()
    await expect.element(page.getByText('Figma rejected the token')).toBeVisible()
    expect(fake.of('POST')[0]?.body).toEqual({ token: 'figd_abcdefgh' })
  })

  it('the integrations list links a connected Figma to its page', async () => {
    await page.viewport(1000, 800)
    fakeApi({
      'GET /api/orgs/acme/integrations': {
        body: {
          canManage: true,
          integrations: [item({ kind: 'figma', group: 'design', name: 'michael' })],
          catalog,
        },
      },
    })
    await renderPage(<IntegrationsPage />, {
      route: '/organizations/$org/settings/integrations',
      url: '/organizations/acme/settings/integrations',
    })
    await expect
      .element(page.getByRole('link', { name: 'Configure Figma (michael)' }))
      .toHaveAttribute('href', '/organizations/acme/settings/integrations/figma')
  })
})

const FIGMA = '/api/orgs/acme/integrations/figma'
const pageData = (over: { canManage?: boolean; connected?: boolean } = {}) => ({
  body: {
    canManage: over.canManage ?? true,
    configured: true,
    account:
      over.connected === false
        ? null
        : {
            id: 'i1',
            name: 'michael',
            needsAttention: false,
            attentionReason: null,
            createdAt: '2026-11-02T00:00:00.000Z',
          },
    projects: [
      {
        slug: 'web',
        name: 'Web',
        fileKey: 'FileKey12345',
        fileName: 'Checkout v3',
        fileUrl: 'https://www.figma.com/design/FileKey12345',
        frameCount: 47,
        linked: 2,
      },
      {
        slug: 'docs',
        name: 'Docs',
        fileKey: null,
        fileName: null,
        fileUrl: null,
        frameCount: null,
        linked: 0,
      },
    ],
  },
})
const links = {
  body: {
    links: [
      {
        id: 'l1',
        snapshotPattern: 'checkout/cart',
        fileKey: 'FileKey12345',
        nodeId: '1:2',
        frameName: 'Cart',
        url: 'https://www.figma.com/design/FileKey12345?node-id=1-2',
        source: 'auto',
        createdAt: '2026-11-03T00:00:00.000Z',
      },
      {
        id: 'l2',
        snapshotPattern: 'home*',
        fileKey: 'FileKey12345',
        nodeId: '1:1',
        frameName: null,
        url: 'https://www.figma.com/design/FileKey12345?node-id=1-1',
        source: 'manual',
        createdAt: '2026-11-03T00:00:00.000Z',
      },
    ],
  },
}
const show = () =>
  renderPage(<FigmaIntegrationPage />, {
    route: '/organizations/$org/settings/integrations/figma',
    url: '/organizations/acme/settings/integrations/figma',
  })

describe('FigmaIntegrationPage', () => {
  it('shows the account, each project’s file, and the links with auto and manual badges', async () => {
    await page.viewport(1000, 900)
    fakeApi({
      [`GET ${FIGMA}`]: pageData(),
      [`GET ${FIGMA}/projects/web/links`]: links,
    })
    await show()
    await expect.element(page.getByText('michael')).toBeVisible()
    await expect.element(page.getByText('Connected', { exact: true })).toBeVisible()
    const web = page.getByRole('group', { name: 'Web' })
    await expect.element(web.getByRole('link', { name: 'Checkout v3' })).toBeVisible()
    await expect.element(web.getByText(/2 of 47 frames linked/)).toBeVisible()
    await expect.element(page.getByText('No file: this project doesn’t use Figma.')).toBeVisible()
    const table = page.getByRole('table', { name: 'Web frame links' })
    await expect
      .element(table.getByRole('link', { name: 'Cart' }))
      .toHaveAttribute('href', 'https://www.figma.com/design/FileKey12345?node-id=1-2')
    await expect.element(table.getByText('Auto')).toBeVisible()
    await expect.element(table.getByText('Manual')).toBeVisible()
    // A frame CirCI has not seen by name shows its node id.
    await expect.element(table.getByRole('link', { name: '1:1' })).toBeVisible()
  })

  it('chooses a file, with the address checked before it is sent', async () => {
    await page.viewport(1000, 900)
    const fake = fakeApi({
      [`GET ${FIGMA}`]: pageData(),
      [`GET ${FIGMA}/projects/web/links`]: links,
      [`PUT ${FIGMA}/projects/docs`]: { body: {} },
    })
    await show()
    await page
      .getByRole('group', { name: 'Docs' })
      .getByRole('button', { name: 'Choose file' })
      .click()
    const form = page.getByRole('form', { name: 'Figma file of Docs' })
    const save = form.getByRole('button', { name: 'Save file' })
    await expect.element(save).toBeDisabled()
    await form.getByRole('textbox').fill('nonsense')
    await expect.element(page.getByText('That is not a Figma file address')).toBeVisible()
    await form.getByRole('textbox').fill(' https://www.figma.com/design/AbC123xyz9Q/Docs ')
    await save.click()
    await expect.poll(() => fake.of('PUT')).toHaveLength(1)
    expect(fake.of('PUT')[0]?.body).toEqual({
      file: 'https://www.figma.com/design/AbC123xyz9Q/Docs',
    })
  })

  it('adds a link from a pasted frame address, and removes one', async () => {
    await page.viewport(1000, 900)
    const fake = fakeApi({
      [`GET ${FIGMA}`]: pageData(),
      [`GET ${FIGMA}/projects/web/links`]: links,
      [`POST ${FIGMA}/projects/web/links`]: { status: 201, body: {} },
      [`DELETE ${FIGMA}/projects/web/links/l1`]: { status: 204 },
    })
    await show()
    const form = page.getByRole('form', { name: 'Add a frame link to Web' })
    const add = form.getByRole('button', { name: 'Add link' })
    await form.getByRole('textbox', { name: 'Web snapshot name' }).fill(' pricing ')
    await form
      .getByRole('textbox', { name: 'Web frame address' })
      .fill('https://www.figma.com/design/FileKey12345/x')
    await expect
      .element(page.getByText('Paste the address of a frame, with its node-id'))
      .toBeVisible()
    await expect.element(add).toBeDisabled()
    await form
      .getByRole('textbox', { name: 'Web frame address' })
      .fill('https://www.figma.com/design/FileKey12345/x?node-id=5-6')
    await add.click()
    await expect.poll(() => fake.of('POST')).toHaveLength(1)
    expect(fake.of('POST')[0]?.body).toEqual({
      pattern: 'pricing',
      url: 'https://www.figma.com/design/FileKey12345/x?node-id=5-6',
    })
    await page.getByRole('button', { name: 'Remove link checkout/cart' }).click()
    await expect.poll(() => fake.of('DELETE')).toHaveLength(1)
  })

  it('links automatically and says what happened', async () => {
    await page.viewport(1000, 900)
    const fake = fakeApi({
      [`GET ${FIGMA}`]: pageData(),
      [`GET ${FIGMA}/projects/web/links`]: links,
      [`POST ${FIGMA}/projects/web/auto-link`]: {
        body: { created: 3, unlinked: 1, frames: 47 },
      },
    })
    await show()
    await page.getByRole('button', { name: 'Link Web automatically' }).click()
    await expect.poll(() => fake.of('POST')).toHaveLength(1)
    await expect
      .element(
        page.getByText(
          'Linked 3 snapshots to frames; 1 snapshot has no frame with a matching name.',
        ),
      )
      .toBeVisible()
  })

  it('is read-only for members', async () => {
    await page.viewport(1000, 900)
    fakeApi({
      [`GET ${FIGMA}`]: pageData({ canManage: false }),
      [`GET ${FIGMA}/projects/web/links`]: links,
    })
    await show()
    await expect.element(page.getByRole('table', { name: 'Web frame links' })).toBeVisible()
    expect(page.getByRole('button').elements()).toHaveLength(0)
    expect(page.getByRole('textbox').elements()).toHaveLength(0)
  })

  it('points to Integrations when Figma is not connected', async () => {
    await page.viewport(1000, 900)
    fakeApi({ [`GET ${FIGMA}`]: pageData({ connected: false }) })
    await show()
    await expect.element(page.getByText('Figma isn’t connected')).toBeVisible()
  })

  it('removes the connection after confirming', async () => {
    await page.viewport(1000, 900)
    const fake = fakeApi({
      [`GET ${FIGMA}`]: pageData(),
      [`GET ${FIGMA}/projects/web/links`]: links,
      'DELETE /api/orgs/acme/integrations/integration/i1': { status: 204 },
    })
    await show()
    await page.getByRole('button', { name: 'Remove', exact: true }).first().click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Remove' }).click()
    await expect.poll(() => fake.of('DELETE')).toHaveLength(1)
  })
})
