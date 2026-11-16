import { Slider as BaseSlider } from '@base-ui/react/slider'

import { cx } from './cx.ts'
import { ChevronLeftIcon, ChevronRightIcon } from './icons.ts'

import styles from './CompareHandle.module.css'

const defaultValueText = (value: number) => `${value}%`

/**
 * The divider of a before / after compare, laid over the images it splits: a line the full height
 * with a grip, a Base UI `Slider`. Only the divider takes the pointer (the line and the grip, a
 * 16px-wide column): everything else on the image stays free for whatever is under it (drawing a
 * region, markers). Place it inside a `position: relative` box that is exactly the image; the caller clips the "after"
 * image at `value`%. Arrow keys move by `step`, Home / End jump to the ends, and the grip is a
 * `slider` named by `label`.
 */
export function CompareHandle({
  label,
  getValueText = defaultValueText,
  onValueChange,
  min = 0,
  max = 100,
  step = 1,
  className,
  ...rest
}: CompareHandle.Props) {
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
      thumbAlignment="center"
      className={cx(styles.root, className)}
    >
      <BaseSlider.Control className={styles.control}>
        <BaseSlider.Track className={styles.track}>
          <BaseSlider.Thumb
            aria-label={label}
            getAriaValueText={(_formatted, value) => getValueText(value)}
            className={styles.thumb}
          >
            <span className={styles.grip} aria-hidden="true">
              <ChevronLeftIcon size={12} strokeWidth={2.25} />
              <ChevronRightIcon size={12} strokeWidth={2.25} />
            </span>
          </BaseSlider.Thumb>
        </BaseSlider.Track>
      </BaseSlider.Control>
    </BaseSlider.Root>
  )
}

export namespace CompareHandle {
  export interface Props extends Omit<
    BaseSlider.Root.Props<number>,
    | 'onValueChange'
    | 'className'
    | 'render'
    | 'children'
    | 'aria-label'
    | 'aria-labelledby'
    | 'thumbAlignment'
    | 'orientation'
  > {
    /** The accessible name of the grip ("Slider position"). */
    label: string
    /** What the position means in words, for assistive tech ("40% baseline, 60% new"); the percentage by default. */
    getValueText?: (value: number) => string
    onValueChange?: (value: number) => void
    className?: string
  }
}
