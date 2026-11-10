import { SearchIcon, TextField } from '@circi/ui'
import { type KeyboardEvent, useEffect, useRef } from 'react'

import { isHandledElsewhere } from '#lib/shortcuts.ts'
import { useShortcutStore } from '#lib/stores/shortcut-store.ts'

import styles from './FindField.module.css'

/**
 * The find field of a list page: one look everywhere (a search glyph, "Find …" as the
 * placeholder). `/` focuses it from anywhere on the page that is not typing or in a dialog, and
 * Esc empties it (and, when it is already empty, leaves it). The page keeps the text (see
 * `useFindParam`) and does the filtering.
 */
export function FindField({ noun, value, onChange, className }: FindField.Props) {
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    function onKey(event: globalThis.KeyboardEvent) {
      if (event.key !== '/' || event.defaultPrevented || event.isComposing) return
      if (isHandledElsewhere(event.target, event)) return
      if (useShortcutStore.getState().drafting.size > 0) return
      event.preventDefault()
      input.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Escape') return
    if (value !== '') {
      event.preventDefault()
      event.stopPropagation()
      onChange('')
    } else {
      event.currentTarget.blur()
    }
  }

  const label = `Find ${noun}`
  return (
    <span className={className ? `${styles.root} ${className}` : styles.root}>
      <SearchIcon size={14} className={styles.icon} aria-hidden="true" />
      <TextField
        ref={input}
        label={label}
        hideLabel
        placeholder={label}
        autoComplete="off"
        spellCheck={false}
        aria-keyshortcuts="/"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
      />
    </span>
  )
}

export namespace FindField {
  export interface Props {
    /** What is found, plural and lower case: "baselines". It makes the label and the placeholder, "Find baselines". */
    noun: string
    value: string
    onChange: (next: string) => void
    className?: string
  }
}
