import { useEffect, useRef, useState } from 'react'

import { cx } from './cx.ts'
import { IconButton } from './IconButton.tsx'
import { CheckIcon, CopyIcon } from './icons.ts'

import styles from './Ref.module.css'

const COPIED_MS = 1500

/**
 * Provisional (docs/design-gaps.md §9, §12): mono text for something the reader copies (a SHA, a
 * branch, a token) with a copy button named "Copy <label>". After copying, a "Copied" note
 * shows for a moment (in a polite `role="status"`); if the browser refuses the clipboard
 * nothing changes. `display` shows a shortened form (`value.slice(0, 7)`) while the full
 * `value` is what is copied.
 */
export function Ref({ value, display, label = 'value', className }: Ref.Props) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])

  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
    } catch {
      return
    }
    setCopied(true)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setCopied(false), COPIED_MS)
  }

  return (
    <span className={cx(styles['root'], className)}>
      <code className={styles['value']} title={display === undefined ? undefined : value}>
        {display ?? value}
      </code>
      <IconButton label={`Copy ${label}`} onClick={() => void copy()} className={styles['button']}>
        {copied ? <CheckIcon strokeWidth={2} /> : <CopyIcon />}
      </IconButton>
      <span role="status" className={styles['copied']}>
        {copied ? 'Copied' : ''}
      </span>
    </span>
  )
}

export namespace Ref {
  export interface Props {
    /** The full text that gets copied. */
    value: string
    /** What is shown, if shorter than `value`. */
    display?: string
    /** What it is, for the button's name: "Copy SHA", "Copy branch name". */
    label?: string
    className?: string
  }
}
