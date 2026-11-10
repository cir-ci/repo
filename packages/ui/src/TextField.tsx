import { Field } from '@base-ui/react/field'
import { Input } from '@base-ui/react/input'
import type { ReactNode } from 'react'

import { cx } from './cx.ts'
import { visuallyHidden } from './theme.ts'

import styles from './TextField.module.css'

/**
 * Provisional (docs/design-gaps.md §2): label above a 32px control (36px with `size="lg"`), a description under it, and
 * an error that replaces the description. Built on Base UI's `Field`, which wires the label,
 * description and error to the input (`for`, `aria-describedby`, `aria-invalid`).
 *
 * The error is plain text the caller decides on (client or server side); the field is invalid
 * exactly while `error` is set.
 */
export function TextField({
  label,
  hideLabel,
  description,
  error,
  invalid,
  size = 'md',
  labelAction,
  className,
  name,
  disabled,
  ...input
}: TextField.Props) {
  return (
    <Field.Root
      name={name}
      invalid={error || invalid ? true : undefined}
      disabled={disabled}
      className={cx(styles.root, className)}
      data-hide-label={hideLabel ? '' : undefined}
    >
      <div className={styles.labelRow} style={hideLabel ? visuallyHidden : undefined}>
        <Field.Label className={styles.label}>{label}</Field.Label>
        {labelAction}
      </div>
      <Input {...input} className={styles.control} data-size={size} />
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

export namespace TextField {
  export interface Props extends Omit<
    Input.Props,
    'className' | 'render' | 'children' | 'aria-label' | 'aria-labelledby' | 'size'
  > {
    label: ReactNode
    /** Hide the label visually; it still names the control for assistive tech. */
    hideLabel?: boolean
    /** Help under the control; hidden while there is an `error`. */
    description?: ReactNode
    /** Makes the field invalid and replaces the description. */
    error?: ReactNode
    /** Marks the field invalid (red border, `aria-invalid`) without a message of its own. */
    invalid?: boolean
    /** `md` is 32px high (the default); `lg` 36px, for the sign-in and setup pages. */
    size?: 'md' | 'lg'
    /** A control on the label's row, at the right (a link such as "Email me a code"). */
    labelAction?: ReactNode
    /** On the field wrapper, for layout. */
    className?: string
  }
}
