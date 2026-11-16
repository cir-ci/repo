import { Slider, Text, useAnnounce } from '@circi/ui'
import { useEffect, useState } from 'react'

import { isEditable, useShortcutHandlers } from '#lib/shortcuts.ts'

import styles from './DiffLayerPill.module.css'

const clamp = (value: number) => Math.min(100, Math.max(0, value))

/** How long Alt is held alone before the peek starts: Alt that types a character (`[`) never peeks. */
const PEEK_DELAY_MS = 150

/**
 * The Diff mode's keys, live while `active`: `[` and `]` step how much of this build shows under the
 * changed pixels by 10% (through `onChange`, announced as "This build 80%"), and holding Alt /
 * Option on its own shows the build in full to peek at it. Pressing another key with Alt (a layout that types `[` with
 * Option) is not a peek. Returns whether the peek is on; letting go (or leaving the window) ends it.
 */
export function useDiffLayerKeys(
  active: boolean,
  value: number,
  onChange: (value: number) => void,
) {
  const [held, setHeld] = useState(false)
  const announce = useAnnounce()
  useShortcutHandlers({
    diffLayer: (action) => {
      if (!active) return false
      const next = clamp(value + action.delta)
      onChange(next)
      announce(`This build ${next}%`)
      return undefined
    },
  })
  useEffect(() => {
    if (!active) return undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    const end = () => {
      clearTimeout(timer)
      timer = undefined
      setHeld(false)
    }
    const onDown = (e: KeyboardEvent) => {
      if (e.key !== 'Alt') {
        // Alt with a key is a chord, not a peek.
        if (e.altKey) end()
        return
      }
      if (e.repeat || timer !== undefined || (e.target instanceof Element && isEditable(e.target)))
        return
      timer = setTimeout(() => setHeld(true), PEEK_DELAY_MS)
    }
    const onUp = (e: KeyboardEvent) => {
      if (e.key === 'Alt') end()
    }
    window.addEventListener('keydown', onDown)
    window.addEventListener('keyup', onUp)
    window.addEventListener('blur', end)
    return () => {
      window.removeEventListener('keydown', onDown)
      window.removeEventListener('keyup', onUp)
      window.removeEventListener('blur', end)
      end()
    }
  }, [active])
  return active && held
}

/**
 * How much of this build shows under the changed pixels in Diff, as a small pill over the bottom-right
 * corner of the image: 0% is the changed pixels alone. A name, a short slider and the percentage. It shows while the pointer is over the image (its frame), while
 * it has focus and while dragged, and otherwise rests slightly faded (still readable) (no fade under reduced
 * motion); on a touch screen it is always fully shown, and `touch` makes it 44px tall.
 */
export function DiffLayerPill({ value, onValueChange, touch = false }: DiffLayerPill.Props) {
  return (
    <div
      className={styles.pill}
      data-touch={touch ? '' : undefined}
      // A press here is the slider's: it never starts a region on the image under it.
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <Text variant="small" tone="secondary" className={styles.name}>
        This build
      </Text>
      <Slider
        label="This build"
        min={0}
        max={100}
        step={5}
        value={value}
        onValueChange={onValueChange}
        className={styles.slider}
      />
      <span className={styles.value} aria-hidden="true">
        {value}%
      </span>
    </div>
  )
}

export namespace DiffLayerPill {
  export interface Props {
    /** Percent, 0 to 100. */
    value: number
    onValueChange: (value: number) => void
    /** A phone: a 44px touch height. */
    touch?: boolean
  }
}
