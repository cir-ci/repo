import { Slider as BaseSlider } from '@base-ui/react/slider'

import { cx } from './cx.ts'

import styles from './Slider.module.css'

/**
 * Provisional: a single-thumb slider on Base UI's `Slider`, for the swipe view. Arrow keys move
 * by `step`, Home/End jump to the ends, and the thumb is a `slider` named by `label`.
 */
export function Slider({
  label,
  onValueChange,
  min = 0,
  max = 100,
  step = 1,
  className,
  ...rest
}: Slider.Props) {
  return (
    <BaseSlider.Root
      {...rest}
      onValueChange={(next) => {
        const single = typeof next === 'number' ? next : next[0]
        if (single !== undefined) onValueChange?.(single)
      }}
      min={min}
      max={max}
      step={step}
      className={cx(styles.root, className)}
    >
      <BaseSlider.Control className={styles.control}>
        <BaseSlider.Track className={styles.track}>
          <BaseSlider.Indicator className={styles.indicator} />
          <BaseSlider.Thumb aria-label={label} className={styles.thumb} />
        </BaseSlider.Track>
      </BaseSlider.Control>
    </BaseSlider.Root>
  )
}

export namespace Slider {
  export interface Props
    // Single thumb: `value` and `defaultValue` stay numbers; `onValueChange` is ours (a bare
    // number); `className` is a plain string so it merges via `cx`.
    extends Omit<
      BaseSlider.Root.Props<number>,
      'onValueChange' | 'className' | 'render' | 'children' | 'aria-label' | 'aria-labelledby'
    > {
    /** The accessible name of the thumb ("Swipe position"). */
    label: string
    onValueChange?: (value: number) => void
    className?: string
  }
}
