import { createContext, type ReactNode, use } from 'react'

import { type ColorSchemeState, useColorSchemeManager } from './color-scheme.ts'

const ColorSchemeContext = createContext<ColorSchemeState | undefined>(undefined)

/**
 * The viewer's colour scheme: `mode` (their choice), `resolvedScheme` (what is in force) and
 * `setMode`. Must be used inside `CirciTheme`.
 */
export function useColorScheme(): ColorSchemeState {
  const state = use(ColorSchemeContext)
  if (!state) throw new Error('useColorScheme must be used inside CirciTheme')
  return state
}

/**
 * Wrap the whole app (or a preview) in this: it owns the colour scheme and marks `<html>` with it
 * (`data-circi-color-scheme`), which picks the token variables and `color-scheme` defined in
 * `global.css`.
 *
 * The scheme follows the system and remembers the viewer's choice (`ColorSchemeControl`). Pass
 * `mode` to pin it (previews, tests): a pinned scheme is never stored.
 */
export function CirciTheme(props: CirciTheme.Props) {
  const state = useColorSchemeManager(props.mode)
  return <ColorSchemeContext value={state}>{props.children}</ColorSchemeContext>
}

export namespace CirciTheme {
  export interface Props {
    children: ReactNode
    /** Pin the colour scheme instead of following the system and the viewer's choice. */
    mode?: 'light' | 'dark'
  }
}
