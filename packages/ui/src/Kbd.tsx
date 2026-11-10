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
        ? keysOf(children).map(({ part, at }) =>
            SYMBOLS.test(part) ? (
              <span key={at} className={styles.symbol}>
                {part}
              </span>
            ) : (
              <span key={at}>{part}</span>
            ),
          )
        : children}
    </kbd>
  )
}

/** The hint's keys with where each starts in the text (its key: the text is fixed per cap). */
function keysOf(text: string): { part: string; at: number }[] {
  let at = 0
  return text
    .split(SYMBOLS)
    .filter(Boolean)
    .map((part) => {
      const key = { part, at }
      at += part.length
      return key
    })
}

export namespace Kbd {
  export interface Props {
    children: ReactNode
  }
}
