import { type ComponentPropsWithRef, type ReactNode } from 'react'

import { cx } from './cx.ts'

import styles from './SettingsRow.module.css'

/**
 * A row in a `SettingsSection`: a label with optional detail (and an `env` variable name in mono)
 * on the left; on the right a `value` (mono), a `status` (a `Badge`) and/or `children` (a control).
 * `leading` is for a step number. It wraps, so the right side drops under the label when narrow.
 * A row with no label (`children` only) is a full-width form row.
 */
export function SettingsRow({
  label,
  detail,
  env,
  leading,
  value,
  status,
  className,
  children,
  ...rest
}: SettingsRow.Props) {
  const hasText = label || detail || env
  return (
    <div {...rest} className={cx(styles.root, className)}>
      {leading ? <span className={styles.leading}>{leading}</span> : null}
      {hasText ? (
        <div className={styles.text}>
          {label ? <span className={styles.label}>{label}</span> : null}
          {detail ? <span className={styles.detail}>{detail}</span> : null}
          {env ? <span className={styles.env}>{env}</span> : null}
        </div>
      ) : null}
      {value ? <span className={styles.value}>{value}</span> : null}
      {children ? <div className={styles.control}>{children}</div> : null}
      {status ? <span className={styles.status}>{status}</span> : null}
    </div>
  )
}

export namespace SettingsRow {
  export interface Props extends Omit<ComponentPropsWithRef<'div'>, 'title'> {
    label?: ReactNode
    /** Smaller secondary text under the label. */
    detail?: ReactNode
    /** The environment variable behind a read-only setting, in mono, tertiary. */
    env?: ReactNode
    /** Before the text: a step number. */
    leading?: ReactNode
    /** A mono value, right-aligned. */
    value?: ReactNode
    /** A status `Badge` at the far right. */
    status?: ReactNode
    /** The control (switch, button, input) on the right; with no label it takes the full width. */
    children?: ReactNode
  }
}
