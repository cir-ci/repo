import { useCallback, useEffect, useState } from 'react'

import { COLOR_SCHEME_ATTRIBUTE, type ColorScheme, MODE_STORAGE_KEY } from './theme.ts'

/** What the viewer chose: a scheme, or `system` to follow the operating system. */
export type ColorMode = ColorScheme | 'system'

const LIGHT_QUERY = '(prefers-color-scheme: light)'

export const isColorMode = (v: unknown): v is ColorMode =>
  v === 'light' || v === 'dark' || v === 'system'

function readStored(): ColorMode {
  try {
    const v = localStorage.getItem(MODE_STORAGE_KEY)
    if (isColorMode(v)) return v
  } catch {
    // Storage blocked: follow the system.
  }
  return 'system'
}

function store(mode: ColorMode) {
  try {
    localStorage.setItem(MODE_STORAGE_KEY, mode)
  } catch {
    // Storage blocked: the choice lasts until the page closes.
  }
}

const systemQuery = () => (typeof matchMedia === 'function' ? matchMedia(LIGHT_QUERY) : undefined)
const systemScheme = (): ColorScheme => (systemQuery()?.matches ? 'light' : 'dark')

const apply = (scheme: ColorScheme) =>
  document.documentElement.setAttribute(COLOR_SCHEME_ATTRIBUTE, scheme)

export interface ColorSchemeState {
  /** The viewer's choice (`system` until they pick). */
  mode: ColorMode
  /** The scheme actually in force. */
  resolvedScheme: ColorScheme
  /** Choose a scheme, or `system`; stored unless the theme is pinned. */
  setMode: (mode: ColorMode) => void
}

/**
 * Own the colour scheme: the choice (stored in localStorage under `MODE_STORAGE_KEY`), the system
 * preference (followed live) and the attribute on `<html>`. With `pinned` the scheme is fixed,
 * never stored and `setMode` does nothing. Used once, by `CirciTheme`.
 */
export function useColorSchemeManager(pinned?: ColorScheme): ColorSchemeState {
  const [mode, setModeState] = useState<ColorMode>(() => pinned ?? readStored())
  const [system, setSystem] = useState<ColorScheme>(systemScheme)

  useEffect(() => {
    const query = systemQuery()
    if (!query) return undefined
    const onChange = () => setSystem(query.matches ? 'light' : 'dark')
    onChange()
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  const effective = pinned ?? mode
  const resolvedScheme = effective === 'system' ? system : effective

  useEffect(() => {
    apply(resolvedScheme)
  }, [resolvedScheme])

  // Another tab changed the choice.
  useEffect(() => {
    if (pinned) return undefined
    const onStorage = (e: StorageEvent) => {
      if (e.key === MODE_STORAGE_KEY) setModeState(readStored())
    }
    addEventListener('storage', onStorage)
    return () => removeEventListener('storage', onStorage)
  }, [pinned])

  const setMode = useCallback(
    (next: ColorMode) => {
      if (pinned) return
      setModeState(next)
      store(next)
    },
    [pinned],
  )

  return { mode: effective, resolvedScheme, setMode }
}
