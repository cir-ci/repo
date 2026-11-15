import { Slider as BaseSlider } from '@base-ui/react/slider'

import { cx } from './cx.ts'

import styles from './CompareHandle.module.css'

/**
 * The divider of a before / after compare, laid over the images it splits: a line the full height
 * with a grip, a Base UI `Slider` whose control covers the whole image so a drag anywhere moves it.
 * Place it inside a `position: relative` box that is exactly the image; the caller clips the "after"
 * image at `value`%. Arrow keys move by `step`, Home / End jump to the ends, and the grip is a
 * `slider` named by `label`.
 */
export function CompareHandle({
  label,
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
          <BaseSlider.Thumb aria-label={label} className={styles.thumb} />
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
    onValueChange?: (value: number) => void
    className?: string
  }
}
