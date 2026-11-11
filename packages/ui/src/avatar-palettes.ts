import { useState, useSyncExternalStore } from 'react'

import type { TeamColor } from './team-icons.ts'
import { COLOR_SCHEME_ATTRIBUTE, type ColorScheme, palettes } from './theme.ts'

/*
 * Colours for the generated avatars (`boring-avatars` wants hex strings, not CSS variables), read
 * from the design tokens' TS source in `theme.ts`: one palette per colour scheme, picked at render
 * from the scheme in force.
 */

/** The scheme in force now: `<html data-circi-color-scheme>`, else the system's preference. */
function currentScheme(): ColorScheme {
  const attr = document.documentElement.getAttribute(COLOR_SCHEME_ATTRIBUTE)
  if (attr === 'light' || attr === 'dark') return attr
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: light)').matches
    ? 'light'
    : 'dark'
}

function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange)
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: [COLOR_SCHEME_ATTRIBUTE],
  })
  return () => observer.disconnect()
}

/**
 * The colour scheme in force for an avatar: the nearest ancestor of `ref` that pins one with
 * `data-circi-color-scheme` (the previews show both schemes side by side), else `<html>`'s, which
 * is followed live. Put `ref` on the avatar's own element. Works without `CirciTheme`.
 */
export function useAvatarScheme(): { scheme: ColorScheme; ref: (el: Element | null) => void } {
  const root = useSyncExternalStore<ColorScheme>(subscribe, currentScheme, () => 'dark')
  const [element, ref] = useState<Element | null>(null)
  const pinned = element
    ?.closest(`[${COLOR_SCHEME_ATTRIBUTE}]`)
    ?.getAttribute(COLOR_SCHEME_ATTRIBUTE)
  if (pinned === 'light' || pinned === 'dark') return { scheme: pinned, ref }
  return { scheme: root, ref }
}

/** Mix `hex` toward white (`amount` > 0) or black (`amount` < 0). */
function shade(hex: string, amount: number): string {
  const target = amount < 0 ? 0 : 255
  const t = Math.abs(amount)
  const channels = [1, 3, 5].map((i) => {
    const value = Number.parseInt(hex.slice(i, i + 2), 16)
    return Math.round(value + (target - value) * t)
      .toString(16)
      .padStart(2, '0')
  })
  return `#${channels.join('')}`
}

/** People's avatars: the team hues and two brand tones, so a list of people reads varied but on-brand. */
export function peoplePalette(scheme: ColorScheme): string[] {
  const { team, brand } = palettes[scheme]
  return [team.slate, team.olive, team.plum, team.moss, team.mauve, brand.terracotta, brand.blush]
}

/**
 * Five shades of a team's chosen colour. `tile-text` sits on top (near black in dark, white in
 * light), so the shades lean the other way: lighter in dark, darker in light.
 */
export function teamPalette(color: TeamColor, scheme: ColorScheme): string[] {
  // A team from an older server may lack a colour: slate, as the sidebar does.
  const base = palettes[scheme].team[color] ?? palettes[scheme].team.slate
  const steps = scheme === 'dark' ? [-0.1, 0, 0.1, 0.2, 0.3] : [-0.3, -0.2, -0.1, 0, 0.1]
  return steps.map((step) => shade(base, step))
}

/** Workspaces' avatars: the brand's maroon and blush tones with the scheme's neutrals. */
export function workspacePalette(scheme: ColorScheme): string[] {
  const { brand, surface } = palettes[scheme]
  return [brand.maroon, brand.blush, brand.rosewood, brand.terracotta, surface.highest]
}

/**
 * The instance's avatar: a cool slate-and-graphite range, set apart from the workspaces' warm brand
 * tones, so the server itself never reads as one of its workspaces.
 */
export function instancePalette(scheme: ColorScheme): string[] {
  const { team, surface } = palettes[scheme]
  return [
    shade(team.slate, -0.25),
    team.slate,
    shade(team.slate, 0.3),
    team.graphite,
    surface.highest,
  ]
}
