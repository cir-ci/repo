import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'

import { IgnoreRegionBaselinePage } from '#features/regions/IgnoreRegionBaselinePage.tsx'
import { TeamSitesSettingsPage } from '#features/team-settings/TeamSitesSettingsPage.tsx'
import { fakeApi } from '#test/support/fetch.ts'
import { renderPage } from '#test/support/render.tsx'

/** Settings is a closed area: what a settings tab needs from the rest of the dashboard it shows itself. */

const API = '/api/teams/acme/web'
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
  return renderPage(<TeamSitesSettingsPage />, {
    route: '/$workspace/$team/settings/sites',
    url: '/acme/web/settings/sites',
    announcer: true,
    otherRoutes: [
      '/$workspace/$team/settings',
      '/$workspace/$team/settings/members',
      '/$workspace/$team/settings/ignore-regions',
      '/$workspace/$team/sites',
    ],
  })
}

describe('team settings, Sites tab', () => {
  it('shows the team’s sites inside the settings frame, and its tab points inside settings', async () => {
    const { router } = await show()
    await expect.element(page.getByRole('heading', { name: 'Storybook' })).toBeVisible()
    const tab = page
      .getByRole('navigation', { name: 'Web App settings' })
      .getByRole('link', { name: 'Sites' })
    await expect.element(tab).toHaveAttribute('href', '/acme/web/settings/sites')
    await expect.element(tab).toHaveAttribute('aria-current', 'page')
    expect(router.state.location.pathname).toBe('/acme/web/settings/sites')
    // No link anywhere on the page leaves settings for the team's own Sites page.
    const hrefs = page
      .getByRole('link')
      .elements()
      .map((el) => el.getAttribute('href'))
    expect(hrefs).not.toContain('/acme/web/sites')
  })

  it('sends a member to the Members tab, not out of settings', async () => {
    const { router } = await show(false)
    await expect.poll(() => router.state.location.pathname).toBe('/acme/web/settings/members')
  })
})

describe('team settings, Ignore regions, one screenshot', () => {
  it('shows the baseline inside settings, with no way out to the builds', async () => {
    const enc = encodeURIComponent(NAME)
    fakeApi({
      [`GET ${API}/settings`]: { body: settings(true) },
      [`GET ${API}/baselines`]: {
        body: {
          team: { slug: 'web', name: 'Web App', defaultBranch: 'main' },
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
      route: '/$workspace/$team/settings/ignore-regions/$',
      url: `/acme/web/settings/ignore-regions/${NAME}`,
      announcer: true,
      otherRoutes: [
        '/$workspace/$team/settings',
        '/$workspace/$team/settings/ignore-regions',
        '/$workspace/$team/builds/$number',
        '/$workspace/$team/baselines/$',
      ],
    })
    await expect.element(page.getByText('Baseline from build #148 on main')).toBeVisible()
    await expect
      .element(
        page.getByRole('navigation', { name: 'Web App settings' }).getByRole('link', {
          name: 'Ignore regions',
        }),
      )
      .toHaveAttribute('aria-current', 'page')
    const hrefs = page
      .getByRole('link')
      .elements()
      .map((el) => el.getAttribute('href') ?? '')
    expect(hrefs.filter((h) => h.includes('/builds/') || h.includes('/baselines'))).toEqual([])
    expect(page.getByRole('link', { name: /Open build/ }).elements()).toHaveLength(0)
  })
})
