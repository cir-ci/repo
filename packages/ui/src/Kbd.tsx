import type { ReactNode } from 'react'

import styles from './Kbd.module.css'

/** Key symbols that fonts draw smaller than the letters beside them (⌘ ⇧ ⌥ ⌃ ↵ ⌫ ⇥ ⎋ and arrows). */
const SYMBOLS = /([⌘⇧⌥⌃↵⏎⌫⌦⇥⎋←→↑↓])/u

/**
 * A keyboard key cap, for shortcut hints next to actions and in the command menu. A text hint is
 * split into its keys ("⇧A" is ⇧ and A, "Esc" stays one word), drawn with a small gap between
 * them, and the symbols are sized to match the letters.
 */
export function Kbd(props: Kbd.Props) {
  const { children } = props
  return (
    <kbd className={styles.root}>
      {typeof children === 'string'
        ? children
            .split(SYMBOLS)
            .filter(Boolean)
            .map((part, i) =>
              SYMBOLS.test(part) ? (
                <span key={i} className={styles.symbol}>
                  {part}
                </span>
              ) : (
                <span key={i}>{part}</span>
              ),
            )
        : children}
    </kbd>
  )
}

export namespace Kbd {
  export interface Props {
    children: ReactNode
  }
}
