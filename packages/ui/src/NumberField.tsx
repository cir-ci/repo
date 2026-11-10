import { Field } from '@base-ui/react/field'
import { NumberField as BaseNumberField } from '@base-ui/react/number-field'
import type { ReactNode } from 'react'

import { cx } from './cx.ts'
import { MinusIcon, PlusIcon } from './icons.ts'

import styles from './NumberField.module.css'

/** Plain digits, no grouping, as many decimals as were typed: a threshold of 0.0001 stays 0.0001. */
const DEFAULT_FORMAT: Intl.NumberFormatOptions = { useGrouping: false, maximumFractionDigits: 20 }

/**
 * Provisional: a number input on Base UI's `NumberField` in TextField's look (label above, a 32px
 * control, a description or the error under it). The arrow keys and the − / + buttons step by
 * `step`, a typed value is clamped to `min` / `max` when the field is left, and a `name` puts the
 * value in a form's `FormData`. An optional `unit` ("hours", "%") sits inside the field.
 *
 * Like TextField, it is invalid exactly while `error` is set (or `invalid` says so).
 */
export function NumberField({
  label,
  hideLabel,
  description,
  error,
  invalid,
  unit,
  size = 'md',
  className,
  name,
  disabled,
  format = DEFAULT_FORMAT,
  inputProps,
  ...root
}: NumberField.Props) {
  return (
    <Field.Root
      name={name}
      invalid={error || invalid ? true : undefined}
      disabled={disabled}
      className={cx(styles.root, className)}
    >
      <BaseNumberField.Root {...root} name={name} disabled={disabled} format={format}>
        <Field.Label className={hideLabel ? styles.hiddenLabel : styles.label}>{label}</Field.Label>
        <BaseNumberField.Group className={styles.group} data-size={size}>
          <BaseNumberField.Input {...inputProps} className={styles.input} />
          {unit ? (
            <span className={styles.unit} aria-hidden="true">
              {unit}
            </span>
          ) : null}
          <BaseNumberField.Decrement className={styles.step} aria-label="Decrease">
            <MinusIcon size={14} />
          </BaseNumberField.Decrement>
          <BaseNumberField.Increment className={styles.step} aria-label="Increase">
            <PlusIcon size={14} />
          </BaseNumberField.Increment>
        </BaseNumberField.Group>
      </BaseNumberField.Root>
      {error ? (
        <Field.Error match className={styles.error}>
          {error}
        </Field.Error>
      ) : description ? (
        <Field.Description className={styles.description}>{description}</Field.Description>
      ) : null}
    </Field.Root>
  )
}

export namespace NumberField {
  export interface Props extends Omit<
    BaseNumberField.Root.Props,
    'className' | 'render' | 'children'
  > {
    label: ReactNode
    /** Hide the label visually; it still names the control for assistive tech. */
    hideLabel?: boolean
    /** One line of help under the field; the error replaces it. */
    description?: ReactNode
    /** Why the value can't be used; the field is invalid exactly while it is set. */
    error?: ReactNode
    /** Invalid without a message of its own (the message is shown elsewhere). */
    invalid?: boolean
    /** A short unit shown inside the field, after the number ("hours", "days", "%"). */
    unit?: ReactNode
    /** `lg` is 36px high, like TextField's. */
    size?: 'md' | 'lg'
    className?: string
    /** Props for the `<input>` itself (`placeholder`, `inputMode`, `aria-describedby`, …). */
    inputProps?: Omit<BaseNumberField.Input.Props, 'className' | 'render'>
  }
}
