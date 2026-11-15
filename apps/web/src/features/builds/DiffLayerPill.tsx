import { Slider } from '@circi/ui'
import { useEffect, useState } from 'react'

import { isEditable, useShortcutHandlers } from '#lib/shortcuts.ts'

import styles from './DiffLayerPill.module.css'

const clamp = (value: number) => Math.min(100, Math.max(0, value))

/**
 * The Overlay mode's keys, live while `active`: `[` and `]` step the diff layer's opacity by 10%
 * (through `onChange`), and holding Alt / Option shows it at 0% to peek at the image under it.
 * Returns whether the peek is on; letting go (or leaving the window) ends it.
 */
export function useDiffLayerKeys(
  active: boolean,
  onChange: (update: (n: number) => number) => void,
) {
  const [held, setHeld] = useState(false)
  useShortcutHandlers({
    diffLayer: (action) => {
      if (!active) return false
      onChange((n) => clamp(n + action.delta))
      return undefined
    },
  })
  useEffect(() => {
    if (!active) return undefined
    const onDown = (e: KeyboardEvent) => {
      if (e.key !== 'Alt' || (e.target instanceof Element && isEditable(e.target))) return
      setHeld(true)
    }
    const end = () => setHeld(false)
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
 * The diff layer's opacity, as a small pill over the bottom-right corner of the overlay image: a
 * short slider and the percentage. It shows while the pointer is over the image (its frame), while
 * it has focus and while dragged, and otherwise rests at low opacity (no fade under reduced
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
      <Slider
        label="Diff layer"
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
