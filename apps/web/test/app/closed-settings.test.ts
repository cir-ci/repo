import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

import { describe, expect, it } from 'vitest'

import { buildList } from '#features/command/model.ts'

/**
 * Settings is a closed area (CLAUDE.md, Style): no link or redirect moves someone between settings
 * (account, workspace, project and instance settings) and the rest of the dashboard. This scans every
 * route pattern a source file links, navigates or redirects to, and fails when a settings file
 * targets an app page or an app file targets a settings page. The few allowed crossings are named.
 */

const SRC = join(import.meta.dirname, '../../src')

/** Files that are part of settings, whatever folder they sit in. */
const SETTINGS_FILES: RegExp[] = [
  /^features\/(project-settings|workspace-settings|account|instance|members|integrations|regions)\//,
  /^features\/reviews\/settings\//,
  /^features\/projects\/DeleteProjectSection\.tsx$/,
  // The slug editor on the project's General settings page; it only renders there.
  /^features\/projects\/ProjectIdentity\.tsx$/,
  /^features\/sidebar\/SettingsNav\.tsx$/,
]

/** Entry points into settings (the workspace and account menus, ⌘K, the project page's Settings button, context menus) and shared redirects. */
const ENTRY_POINTS = new Set([
  'features/auth/UserMenu.tsx',
  'features/sidebar/WorkspaceSwitcher.tsx',
  'features/projects/ProjectPage.tsx',
  'features/projects/routes.ts',
  // A project's right-click menu (sidebar entry, Projects page row): Project settings, for those who may manage.
  'features/projects/ProjectContextMenu.tsx',
  'features/command/model.ts',
  // The command menu's settings sections (Settings · Members, All workspaces, ...).
  'features/command/settings.ts',
  // The phone's More sheet: the workspace and account settings entries (built from helpers, not route literals).
  'app/PhoneMore.tsx',
  // The Projects and Settings crumbs, which only settings pages use.
  'lib/crumbs.ts',
])

/** A settings file that holds a way back to the app: the sidebar's "back" link and breadcrumbs. */
const WAY_BACK = new Set([
  'features/sidebar/SettingsNav.tsx',
  'features/members/routes.ts',
  'features/account/routes.ts',
  'features/instance/routes.ts',
])

const SETTINGS_TARGET =
  /^\/(workspaces\/\$workspace\/settings|\$workspace\/\$project\/settings|account|instance)(\/|$)/

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return files(path)
    return /\.(ts|tsx)$/.test(name) ? [path] : []
  })
}

/** The route patterns a file names: string literals like '/$workspace/$project/sites' (never API paths or imports). */
function routeLiterals(source: string): string[] {
  const code = source
    .split('\n')
    .filter((line) => !/^\s*(import|export .* from)\b/.test(line))
    .join('\n')
  return [...code.matchAll(/(['"`])(\/(?:\$[\w/$]*|inbox|workspaces\/\$[\w/$]*)?)\1/g)]
    .map((m) => m[2] ?? '')
    .filter((s) => s.startsWith('/$') || s === '/inbox' || s.startsWith('/workspaces/$'))
}

describe('settings is a closed area', () => {
  const all = files(SRC).map((path) => ({
    rel: relative(SRC, path),
    source: readFileSync(path, 'utf8'),
  }))

  it('no settings file links to an app page', () => {
    const crossings: string[] = []
    for (const { rel, source } of all) {
      if (!SETTINGS_FILES.some((re) => re.test(rel)) || WAY_BACK.has(rel)) continue
      for (const target of routeLiterals(source)) {
        if (!SETTINGS_TARGET.test(target)) crossings.push(`${rel} -> ${target}`)
      }
    }
    expect(crossings).toEqual([])
  })

  it('no app file links into settings, apart from the entry points', () => {
    const crossings: string[] = []
    for (const { rel, source } of all) {
      if (SETTINGS_FILES.some((re) => re.test(rel)) || ENTRY_POINTS.has(rel)) continue
      for (const target of routeLiterals(source)) {
        if (SETTINGS_TARGET.test(target)) crossings.push(`${rel} -> ${target}`)
      }
    }
    expect(crossings).toEqual([])
  })

  it('the All workspaces page is named only by settings files and the entry points into settings', () => {
    const outside = all
      .filter(({ rel }) => !SETTINGS_FILES.some((re) => re.test(rel)) && !ENTRY_POINTS.has(rel))
      .filter(({ source }) => /['"`]\/instance\/workspaces['"`]/.test(source))
      .map(({ rel }) => rel)
    expect(outside).toEqual([])
  })

  it('the settings nav and the hub only point at settings pages, the bare address included', () => {
    const navFiles = [
      'features/sidebar/SettingsNav.tsx',
      'features/workspace-settings/WorkspaceSettingsHubPage.tsx',
      'features/workspace-settings/WorkspaceBackLink.tsx',
      'features/workspace-settings/WorkspaceSettingsEntry.tsx',
      'features/instance/WorkspacesPage.tsx',
    ]
    const found = all.filter(({ rel }) => navFiles.includes(rel))
    expect(found.map(({ rel }) => rel).toSorted()).toEqual(navFiles.toSorted())
    const crossings = found.flatMap(({ rel, source }) =>
      routeLiterals(source)
        .filter((target) => !SETTINGS_TARGET.test(target))
        .map((target) => `${rel} -> ${target}`),
    )
    expect(crossings).toEqual([])
  })

  it("settings pages use the settings crumbs, whose workspace crumb doesn't link out to the Inbox", () => {
    const outward = all
      .filter(({ rel }) => SETTINGS_FILES.some((re) => re.test(rel)))
      .filter(({ source }) =>
        /\b(crumbsFor|workspaceCrumb|projectCrumb|projectBuildsCrumb)\(/.test(source),
      )
      .map(({ rel }) => rel)
    expect(outward).toEqual([])
  })

  it('the command menu offers only settings pages and the way back while you are in settings', () => {
    const base = {
      workspace: 'acme',
      routeWorkspace: undefined,
      projects: [],
      views: [],
      workspaces: [],
      canManage: true,
      instanceAdmin: true,
      inSettings: true,
      needs: { reviews: 3, unread: 2, triageAssigned: 1 },
      recents: [
        { kind: 'build' as const, id: 'b', label: 'Build #1', path: '/acme/web/builds/1', at: 0 },
      ],
      now: 0,
    }
    const typed = {
      chips: [],
      contextCleared: false,
      results: undefined,
      pending: false,
      failed: false,
    }
    for (const pathname of [
      '/account/profile',
      '/workspaces/acme/settings/members',
      '/acme/web/settings/members',
      '/instance/health',
    ]) {
      for (const query of ['', 'a', 'build', '148']) {
        const view = buildList(
          { ...base, pathname, leave: { path: '/acme/web/builds/148', label: 'Build #148' } },
          { ...typed, query },
        )
        const targets = view.groups.flatMap((g) => g.entries.map((e) => e.target))
        expect(targets.filter((t) => t.type !== 'path')).toEqual([])
        const paths = targets.map((t) => (t.type === 'path' ? t.path : ''))
        // Settings pages, or the frame's own way back (the page you came from).
        const outside = paths.filter(
          (p) =>
            p !== '/acme/web/builds/148' &&
            !/^\/(account|instance)(\/|$)|^\/workspaces\/[^/]+\/settings(\/|$)|^\/[^/]+\/[^/]+\/settings(\/|$)/.test(
              p,
            ),
        )
        expect(outside).toEqual([])
      }
    }
  })
})
