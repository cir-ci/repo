import { Radio as BaseRadio } from '@base-ui/react/radio'
import { RadioGroup as BaseRadioGroup } from '@base-ui/react/radio-group'

import { cx } from './cx.ts'

import styles from './Radio.module.css'

/**
 * A single choice among a few, on Base UI's `RadioGroup`: one radio is in the Tab order, the
 * arrow keys move to the next and choose it (wrapping), and Space chooses the focused one.
 * `label` names the group. The choices are `Radio`s, whose content the caller draws (a card, a
 * swatch).
 */
export function RadioGroup<Value extends string>({
  label,
  className,
  ...rest
}: RadioGroup.Props<Value>) {
  return <BaseRadioGroup {...rest} aria-label={label} className={cx(styles.group, className)} />
}

export namespace RadioGroup {
  export interface Props<Value extends string> extends Omit<
    BaseRadioGroup.Props<Value>,
    'className' | 'render' | 'aria-label' | 'aria-labelledby'
  > {
    /** The group's accessible name. */
    label: string
    className?: string
  }
}

/**
 * One choice of a `RadioGroup`, drawn by its children and `className` (Base UI's `Radio.Root`: a
 * `role="radio"` element, plus a hidden input for forms). It has no look of its own beyond a focus
 * ring: style it by `[data-checked]`. With no visible text (a colour swatch), give it an
 * `aria-label`.
 */
export function Radio<Value extends string>({ className, ...rest }: Radio.Props<Value>) {
  return <BaseRadio.Root {...rest} className={cx(styles.radio, className)} />
}

export namespace Radio {
  export interface Props<Value extends string> extends Omit<
    BaseRadio.Root.Props<Value>,
    'className' | 'render' | 'nativeButton'
  > {
    className?: string
  }
}
