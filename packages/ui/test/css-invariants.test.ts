import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * Static invariants over every CSS module of the design system and the dashboard. They are cheap
 * (no browser) and catch the regressions that a visual review misses: a removed focus ring, text
 * too small to read, a radius that is not on the scale. Offenders that exist today are listed in
 * the ALLOW-LISTS below with a reason; the lists may only shrink (a stale entry fails the test).
 */
const ROOT = resolve(import.meta.dirname, '../../..')

function cssModules(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return cssModules(path)
    return entry.name.endsWith('.module.css') ? [path] : []
  })
}

interface Rule {
  file: string
  selector: string
  declarations: Map<string, string>
}

const rules: Rule[] = [
  ...cssModules(join(ROOT, 'packages/ui/src')),
  ...cssModules(join(ROOT, 'apps/web/src')),
].flatMap((path) => {
  const source = readFileSync(path, 'utf8').replaceAll(/\/\*[\s\S]*?\*\//g, '')
  const file = relative(ROOT, path)
  return [...source.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => {
    const declarations = new Map<string, string>()
    for (const part of match[2]!.split(';')) {
      const colon = part.indexOf(':')
      if (colon > 0) declarations.set(part.slice(0, colon).trim(), part.slice(colon + 1).trim())
    }
    return { file, selector: match[1]!.trim().replaceAll(/\s+/g, ' '), declarations }
  })
})

const key = (rule: Rule) => `${rule.file} ${rule.selector}`

/** Offenders that exist today (key: "file selector"), each with the reason it is acceptable. */
const OUTLINE_ALLOWED: Record<string, string> = {
  'packages/ui/src/AppFrame.module.css .main:focus-visible':
    '<main> is focused by the skip link only (tabindex=-1): a ring around the whole page is noise',
  'apps/web/src/features/auth/AuthPage.module.css .column':
    "<main> is focused by the skip link only (tabindex=-1), as the shell's main",
  'packages/ui/src/Select.module.css .positioner': 'a wrapper, never focused itself',
  'packages/ui/src/Select.module.css .popup':
    'the popup container takes focus; its items show focus',
  'packages/ui/src/Select.module.css .list': 'the listbox container; its items show focus',
  'packages/ui/src/Autocomplete.module.css .list':
    'the listbox container; focus stays in the input and the highlighted item shows it',
  'packages/ui/src/Popover.module.css .positioner': 'a wrapper, never focused itself',
  'packages/ui/src/Popover.module.css .popup':
    'the popup container takes focus; content shows its own',
  'packages/ui/src/Menu.module.css .positioner': 'a wrapper, never focused itself',
  'packages/ui/src/Menu.module.css .popup': 'the popup container takes focus; items show focus',
  'packages/ui/src/Dialog.module.css .popup:focus-visible':
    'the dialog container takes focus on open; a ring around the dialog is noise',
  'packages/ui/src/ConfirmDialog.module.css .popup:focus-visible': 'as Dialog',
  'packages/ui/src/CommandDialog.module.css .popup:focus-visible': 'as Dialog',
  'packages/ui/src/Drawer.module.css .popup:focus-visible': 'as Dialog',
  'packages/ui/src/Sheet.module.css .popup:focus-visible': 'as Dialog',
  'apps/web/src/features/regions/RegionLayer.module.css .tool':
    'a non-interactive drawing preview (pointer-events: none)',
  'apps/web/src/features/command/CommandMenu.module.css .input:focus-visible':
    'the palette input is the only control in its dialog; the dialog frames it (candidate to fix: add a border colour)',
}

/** `border-radius` values off the scale (4/6/8/10/12px, 50%, 999px, tokens). */
const RADIUS_ALLOWED: Record<string, string> = {
  'packages/ui/src/Slider.module.css': '2px: half the 4px track, so the ends are round',
  'packages/ui/src/Badge.module.css': '9px: half of the 18px badge height (a pill)',
  'packages/ui/src/Switch.module.css': '9px: half of the 18px track height (a pill)',
  'apps/web/src/features/workspace-settings/Settings.module.css': '2px: half of thin 4px bars',
}

const SCALE = new Set(['0', '4px', '6px', '8px', '10px', '12px', '50%', '999px', '9999px'])
const radiusOk = (value: string) =>
  // Tokens (with or without a fallback) are on the scale by definition.
  value
    .replaceAll(/var\(--circi-radius-[\w-]+(?:,[^)]*)?\)/g, '0')
    .split(/\s+/)
    .filter(Boolean)
    .every((part) => SCALE.has(part))

const unused = (allowed: Record<string, string>, used: Set<string>) =>
  Object.keys(allowed).filter((k) => !used.has(k))

describe('css modules', () => {
  it('knows the stylesheets', () => {
    expect(new Set(rules.map((r) => r.file)).size).toBeGreaterThan(80)
  })

  it('never removes a focus outline without a replacement', () => {
    const used = new Set<string>()
    const offenders: string[] = []
    for (const rule of rules) {
      const outline = rule.declarations.get('outline')
      if (outline === undefined || !/^(none|0)(\s|$)/.test(outline)) continue
      // A replacement: the same rule shows focus another way (border or shadow).
      const replaced = ['border-color', 'box-shadow'].some((p) => rule.declarations.has(p))
      if (replaced) continue
      if (key(rule) in OUTLINE_ALLOWED) used.add(key(rule))
      else offenders.push(key(rule))
    }
    expect(offenders).toEqual([])
    expect(unused(OUTLINE_ALLOWED, used), 'stale allow-list entries').toEqual([])
  })

  it('never sets a font-size under 11px', () => {
    const small = rules.flatMap((rule) => {
      const size = rule.declarations.get('font-size')
      const px = size ? /^(\d+(?:\.\d+)?)px$/.exec(size) : null
      return px && Number(px[1]) < 11 ? [`${key(rule)}: ${size}`] : []
    })
    expect(small).toEqual([])
  })

  it('keeps border-radius on the scale', () => {
    const used = new Set<string>()
    const offenders: string[] = []
    for (const rule of rules) {
      const radius = rule.declarations.get('border-radius')
      if (radius === undefined || radiusOk(radius)) continue
      if (rule.file in RADIUS_ALLOWED) used.add(rule.file)
      else offenders.push(`${key(rule)}: ${radius}`)
    }
    expect(offenders).toEqual([])
    expect(unused(RADIUS_ALLOWED, used), 'stale allow-list entries').toEqual([])
  })
})
