import { useEffect, useRef, useState } from 'react'

import { Button } from './Button.tsx'
import { cx } from './cx.ts'
import { CheckIcon, CopyIcon } from './icons.ts'

import styles from './CommandBlock.module.css'

const COPIED_MS = 1500

/**
 * A command to run, as the action of a first-run empty state: mono 12 text that wraps (never
 * scrolls sideways), full width up to 360px, and a Copy button below it. After copying the
 * button says "Copied" for a moment; if the browser refuses the clipboard nothing changes.
 */
export function CommandBlock({ command, label = 'command', className }: CommandBlock.Props) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])

  async function copy() {
    try {
      await navigator.clipboard.writeText(command)
    } catch {
      return
    }
    setCopied(true)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setCopied(false), COPIED_MS)
  }

  return (
    <div className={cx(styles.root, className)}>
      <code className={styles.command}>{command}</code>
      <Button
        size="sm"
        leading={copied ? <CheckIcon /> : <CopyIcon />}
        aria-label={`Copy ${label}`}
        onClick={() => void copy()}
      >
        {copied ? 'Copied' : 'Copy'}
      </Button>
    </div>
  )
}

export namespace CommandBlock {
  export interface Props {
    /** The text that is shown and copied. */
    command: string
    /** What it is, for the button's name: "Copy command". */
    label?: string
    className?: string
  }
}
