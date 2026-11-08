import { Field } from '@base-ui/react/field'
import { Input } from '@base-ui/react/input'
import type { ReactNode } from 'react'

import { cx } from './cx.ts'

import styles from './TextField.module.css'

/**
 * Provisional (docs/design-gaps.md §2): label above a 32px control, a description under it, and
 * an error that replaces the description. Built on Base UI's `Field`, which wires the label,
 * description and error to the input (`for`, `aria-describedby`, `aria-invalid`).
 *
 * The error is plain text the caller decides on (client or server side); the field is invalid
 * exactly while `error` is set.
 */
export function TextField({
  label,
  description,
  error,
  className,
  name,
  disabled,
  ...input
}: TextField.Props) {
  return (
    <Field.Root
      name={name}
      invalid={error ? true : undefined}
      disabled={disabled}
      className={cx(styles['root'], className)}
    >
      <Field.Label className={styles['label']}>{label}</Field.Label>
      <Input {...input} className={styles['control']} />
      {error ? (
        <Field.Error match className={styles['error']}>
          {error}
        </Field.Error>
      ) : description ? (
        <Field.Description className={styles['description']}>{description}</Field.Description>
      ) : null}
    </Field.Root>
  )
}

export namespace TextField {
  export interface Props extends Omit<
    Input.Props,
    'className' | 'render' | 'children' | 'aria-label' | 'aria-labelledby'
  > {
    label: ReactNode
    /** Help under the control; hidden while there is an `error`. */
    description?: ReactNode
    /** Makes the field invalid and replaces the description. */
    error?: ReactNode
    /** On the field wrapper, for layout. */
    className?: string
  }
}
