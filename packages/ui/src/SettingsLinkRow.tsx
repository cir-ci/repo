import { type ComponentPropsWithRef, type ReactNode } from 'react'

import { cx } from './cx.ts'
import { ChevronRightIcon } from './icons.ts'

import styles from './SettingsLinkRow.module.css'

/**
 * A row of a `SettingsSection` that opens another settings page (a team's settings hub): an icon,
 * the page's name with a one-line description, a short summary `value` ("4 members", "None") and a
 * chevron. It is an `<a>`: pass `href` and `onClick` (a client-side router link) as for any link.
 * At least 56px tall, so it is a comfortable target on a phone.
 */
export function SettingsLinkRow({
  icon,
  label,
  detail,
  value,
  className,
  ...rest
}: SettingsLinkRow.Props) {
  return (
    <a {...rest} className={cx(styles.root, className)}>
      {icon ? <span className={styles.icon}>{icon}</span> : null}
      <span className={styles.text}>
        <span className={styles.label}>{label}</span>
        {detail ? <span className={styles.detail}>{detail}</span> : null}
      </span>
      {value ? <span className={styles.value}>{value}</span> : null}
      <ChevronRightIcon size={14} className={styles.chevron} />
    </a>
  )
}

export namespace SettingsLinkRow {
  export interface Props extends Omit<ComponentPropsWithRef<'a'>, 'children'> {
    /** Before the text: a glyph for the page. */
    icon?: ReactNode
    /** The page's name. */
    label: ReactNode
    /** One line saying what the page is for. */
    detail?: ReactNode
    /** A short summary on the right ("4 members"). */
    value?: ReactNode
  }
}
