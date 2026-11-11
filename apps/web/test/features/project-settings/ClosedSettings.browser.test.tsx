import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'

import { ProjectSitesSettingsPage } from '#features/project-settings/ProjectSitesSettingsPage.tsx'
import { IgnoreRegionBaselinePage } from '#features/regions/IgnoreRegionBaselinePage.tsx'
import { fakeApi } from '#test/support/fetch.ts'
import { renderPage } from '#test/support/render.tsx'

/** Settings is a closed area: what a settings tab needs from the rest of the dashboard it shows itself. */

const API = '/api/projects/acme/web'
const NAME = 'checkout/payment-form'
const NOW = new Date(Date.now() - 3_600_000).toISOString()

const settings = (canManage: boolean) => ({
  canManage,
  settings: { name: 'Web App', defaultBranch: 'main' },
  appearance: { color: 'slate', icon: null },
  workspace: { flakyBlocksMerge: true },
  webhooks: [],
  webhookEvents: [],
  github: { configured: false, webhookUrl: '', link: null },
  sitesConfigured: true,
})

const SITE = {
  slug: 'storybook',
  customDomain: null,
  name: 'Storybook',
  kindLabel: 'Storybook',
  branches: [],
  versions: [
    { commitSha: 'abcdef1234567', address: null, branch: 'main', totalBytes: 1024, createdAt: NOW },
  ],
}

const show = (canManage = true) => {
  fakeApi({
    [`GET ${API}/settings`]: { body: settings(canManage) },
    [`GET ${API}/sites`]: {
      body: { configured: true, dnsTarget: 'custom.sites.test', canManage, sites: [SITE] },
    },
  })
  return renderPage(<ProjectSitesSettingsPage />, {
    route: '/$workspace/$project/settings/sites',
    url: '/acme/web/settings/sites',
    announcer: true,
    otherRoutes: [
      '/$workspace/$project/settings',
      '/$workspace/$project/settings/ignore-regions',
      '/$workspace/$project/sites',
    ],
  })
}

describe('project settings, Sites page', () => {
  it('shows the project’s sites inside the settings frame, with its way back inside settings', async () => {
    const { router } = await show()
    await expect.element(page.getByRole('heading', { name: 'Storybook' })).toBeVisible()
    await expect
      .element(page.getByRole('link', { name: 'Web App' }).last())
      .toHaveAttribute('href', '/acme/web/settings')
    expect(router.state.location.pathname).toBe('/acme/web/settings/sites')
    // No link anywhere on the page leaves settings for the project's own Sites page.
    const hrefs = page
      .getByRole('link')
      .elements()
      .map((el) => el.getAttribute('href'))
    expect(hrefs).not.toContain('/acme/web/sites')
  })

  it("sends a member to the project's settings hub, not out of settings", async () => {
    const { router } = await show(false)
    await expect.poll(() => router.state.location.pathname).toBe('/acme/web/settings')
  })
})

describe('project settings, Ignore regions, one screenshot', () => {
  it('shows the baseline inside settings, with no way out to the builds', async () => {
    const enc = encodeURIComponent(NAME)
    fakeApi({
      [`GET ${API}/settings`]: { body: settings(true) },
      [`GET ${API}/baselines`]: {
        body: {
          project: { slug: 'web', name: 'Web App', defaultBranch: 'main' },
          baselines: [
            {
              name: NAME,
              buildName: 'default',
              width: 1000,
              height: 500,
              sizeBytes: 2048,
              fileSha256: 'sha-baseline',
              thumbnailSha256: null,
              buildNumber: 148,
              commitSha: 'abcdef1',
              approvedAt: NOW,
              approvedBy: { id: 'u1', name: 'Maya Levi' },
            },
          ],
        },
      },
      [`GET ${API}/flaky`]: { body: { builds: 10, flaky: [] } },
      [`GET ${API}/ignore-regions`]: { body: { regions: [], snapshots: [] } },
      [`GET ${API}/snapshots/${enc}/history`]: {
        body: {
          defaultBranch: 'main',
          default: [
            {
              build: {
                number: 148,
                branch: 'main',
                status: 'complete',
                reviewStatus: 'approved',
                createdAt: NOW,
              },
              status: 'changed',
              approvedBy: { id: 'u1', name: 'Maya Levi' },
              image: { sha256: 'sha-148', thumbnail: null, width: 1000, height: 500 },
            },
          ],
          branch: null,
        },
      },
    })
    await renderPage(<IgnoreRegionBaselinePage />, {
      route: '/$workspace/$project/settings/ignore-regions/$',
      url: `/acme/web/settings/ignore-regions/${NAME}`,
      announcer: true,
      otherRoutes: [
        '/$workspace/$project/settings',
        '/$workspace/$project/settings/ignore-regions',
        '/$workspace/$project/builds/$number',
        '/$workspace/$project/baselines/$',
      ],
    })
    await expect.element(page.getByText('Baseline from build #148 on main')).toBeVisible()
    // Its way back is the Ignore regions overview, still inside settings.
    await expect
      .element(page.getByRole('link', { name: 'Ignore regions' }).last())
      .toHaveAttribute('href', '/acme/web/settings/ignore-regions')
    const hrefs = page
      .getByRole('link')
      .elements()
      .map((el) => el.getAttribute('href') ?? '')
    expect(hrefs.filter((h) => h.includes('/builds/') || h.includes('/baselines'))).toEqual([])
    expect(page.getByRole('link', { name: /Open build/ }).elements()).toHaveLength(0)
  })
})
