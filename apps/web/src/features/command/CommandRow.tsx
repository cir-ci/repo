import { CheckIcon, ChevronRightIcon, Kbd } from '@circi/ui'
import type { ReactNode } from 'react'

import { keyCaps } from '#lib/shortcuts.ts'

import { CommandIcon } from './CommandIcon.tsx'
import type { Entry } from './entry.ts'

import styles from './CommandMenu.module.css'

/** The words a row is read as: its kind first (`Build #148 Add payment form, feat/checkout`). */
export function accessibleName(entry: Entry): string {
  const lead =
    entry.kindLabel && !entry.label.startsWith(entry.kindLabel) ? `${entry.kindLabel} ` : ''
  const tail = [entry.detail, entry.time].filter(Boolean)
  return `${lead}${entry.label}${tail.length > 0 ? `, ${tail.join(', ')}` : ''}`
}

/** The label with the characters that match the typed words in bold (no highlight fill). */
export function highlight(label: string, words: readonly string[]): ReactNode {
  if (words.length === 0) return label
  const lower = label.toLowerCase()
  const marked = Array.from({ length: label.length }, () => false)
  for (const word of words) {
    const at = lower.indexOf(word)
    if (at >= 0) for (let i = at; i < at + word.length; i += 1) marked[i] = true
  }
  const parts: ReactNode[] = []
  let start = 0
  for (let i = 1; i <= label.length; i += 1) {
    if (i === label.length || marked[i] !== marked[start]) {
      const text = label.slice(start, i)
      parts.push(marked[start] ? <b key={start}>{text}</b> : text)
      start = i
    }
  }
  return parts
}

/**
 * One row, 36px: the leading mark, the label, a grey line, then at the end the kind label (places
 * and items) or the key caps (actions), the time of a recent visit, a check for the current
 * choice and a chevron when it opens a list.
 */
export function CommandRow({ entry, id, selected, words, onHover, onChoose }: CommandRow.Props) {
  return (
    // Keyboard use goes through the field (aria-activedescendant); the click is for the pointer.
    // oxlint-disable-next-line jsx-a11y/click-events-have-key-events
    <div
      id={id}
      role="option"
      aria-selected={selected}
      aria-label={accessibleName(entry)}
      className={styles.option}
      // The field keeps focus: a click or a hover never takes it.
      onMouseDown={(e) => e.preventDefault()}
      onMouseMove={onHover}
      onClick={onChoose}
    >
      <CommandIcon entry={entry} />
      <span className={styles.label} aria-hidden="true">
        {highlight(entry.label, words)}
      </span>
      {entry.detail ? (
        <span className={styles.detail} aria-hidden="true">
          {entry.detail}
        </span>
      ) : (
        <span className={styles.spacer} />
      )}
      {entry.kindLabel ? (
        <span className={styles.kind} aria-hidden="true">
          {entry.kindLabel}
        </span>
      ) : null}
      {entry.time ? (
        <span className={styles.time} aria-hidden="true">
          {entry.time}
        </span>
      ) : null}
      {entry.checked ? <CheckIcon size={14} aria-hidden="true" className={styles.check} /> : null}
      {entry.hint ? (
        <span className={styles.caps} aria-hidden="true">
          {keyCaps(entry.hint).map((cap) => (
            <Kbd key={cap}>{cap}</Kbd>
          ))}
        </span>
      ) : null}
      {entry.chevron ? (
        <ChevronRightIcon size={14} aria-hidden="true" className={styles.chevron} />
      ) : null}
    </div>
  )
}

export namespace CommandRow {
  export interface Props {
    entry: Entry
    id: string
    selected: boolean
    /** The typed words, for the bold match. */
    words: readonly string[]
    onHover: () => void
    onChoose: () => void
  }
}
