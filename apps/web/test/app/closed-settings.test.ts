import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * Settings is a closed area (CLAUDE.md, Style): no link or redirect moves someone between settings
 * (account, workspace, team and instance settings) and the rest of the dashboard. This scans every
 * route pattern a source file links, navigates or redirects to, and fails when a settings file
 * targets an app page or an app file targets a settings page. The few allowed crossings are named.
 */

const SRC = join(import.meta.dirname, '../../src')

/** Files that are part of settings, whatever folder they sit in. */
const SETTINGS_FILES: RegExp[] = [
  /^features\/(team-settings|workspace-settings|account|instance|members|integrations|regions)\//,
  /^features\/reviews\/settings\//,
  /^features\/teams\/DeleteTeamSection\.tsx$/,
  /^features\/sidebar\/SettingsNav\.tsx$/,
]

/** Entry points into settings (the workspace and account menus, ⌘K, the team page's Settings button) and shared redirects. */
const ENTRY_POINTS = new Set([
  'features/auth/UserMenu.tsx',
  'features/sidebar/WorkspaceSwitcher.tsx',
  'features/teams/TeamPage.tsx',
  'features/teams/routes.ts',
  'features/command/model.ts',
  // The Teams and Settings crumbs, which only settings pages use.
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
  /^\/(workspaces\/\$workspace\/settings|\$workspace\/\$team\/settings|account|instance)(\/|$)/

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return files(path)
    return /\.(ts|tsx)$/.test(name) ? [path] : []
  })
}

/** The route patterns a file names: string literals like '/$workspace/$team/sites' (never API paths or imports). */
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

  it("settings pages use the settings crumbs, whose workspace crumb doesn't link out to the Inbox", () => {
    const outward = all
      .filter(({ rel }) => SETTINGS_FILES.some((re) => re.test(rel)))
      .filter(({ source }) =>
        /\b(crumbsFor|workspaceCrumb|teamCrumb|teamBuildsCrumb)\(/.test(source),
      )
      .map(({ rel }) => rel)
    expect(outward).toEqual([])
  })
})
