import { Field } from '@base-ui/react/field'
import type { ComponentPropsWithoutRef, ReactNode, Ref } from 'react'

import { cx } from './cx.ts'
import { visuallyHidden } from './theme.ts'

import styles from './TextArea.module.css'

/**
 * A multi-line text field with `TextField`'s label, description and error: Base UI's `Field`
 * wires the label (`for`), the description and the error to the textarea (`aria-describedby`,
 * `aria-invalid`). The error is plain text the caller decides on and is announced when it
 * appears; the field is invalid exactly while `error` is set.
 */
export function TextArea({
  label,
  hideLabel,
  description,
  error,
  invalid,
  className,
  name,
  disabled,
  inputRef,
  ...textarea
}: TextArea.Props) {
  return (
    <Field.Root
      name={name}
      invalid={error || invalid ? true : undefined}
      disabled={disabled}
      className={cx(styles.root, className)}
    >
      <Field.Label className={styles.label} style={hideLabel ? visuallyHidden : undefined}>
        {label}
      </Field.Label>
      <Field.Control
        render={<textarea {...textarea} ref={inputRef} className={styles.control} />}
      />
      {error ? (
        <Field.Error match role="alert" className={styles.error}>
          {error}
        </Field.Error>
      ) : description ? (
        <Field.Description className={styles.description}>{description}</Field.Description>
      ) : null}
    </Field.Root>
  )
}

export namespace TextArea {
  export interface Props extends Omit<
    ComponentPropsWithoutRef<'textarea'>,
    'className' | 'children' | 'aria-label' | 'aria-labelledby'
  > {
    label: ReactNode
    /** Hide the label visually; it still names the field for assistive tech. */
    hideLabel?: boolean
    /** Help under the field; hidden while there is an `error`. */
    description?: ReactNode
    /** Makes the field invalid and replaces the description. */
    error?: ReactNode
    /** Marks the field invalid (red border, `aria-invalid`) without a message of its own. */
    invalid?: boolean
    /** The textarea element, for focus. */
    inputRef?: Ref<HTMLTextAreaElement> | undefined
    /** On the field wrapper, for layout. */
    className?: string
  }
}
