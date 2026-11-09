import { type ComponentPropsWithRef, type ReactNode } from 'react'

import { cx } from './cx.ts'

import styles from './SettingsSummary.module.css'

/**
 * A row of counts in a box (Health's summary, the background jobs): each item is a small label, a
 * big number, and an optional `Badge` or note under it. It is a description list, so a screen
 * reader hears "Passing: 4". Put it in a `SettingsSection`.
 */
export function SettingsSummary({ items, className, ...rest }: SettingsSummary.Props) {
  return (
    <dl {...rest} className={cx(styles.root, className)}>
      {items.map((item) => (
        <div key={item.label} className={styles.item}>
          <dt className={styles.label}>{item.label}</dt>
          <dd className={styles.value}>{item.value}</dd>
          {item.extra ? <dd className={styles.extra}>{item.extra}</dd> : null}
        </div>
      ))}
    </dl>
  )
}

export namespace SettingsSummary {
  export interface Item {
    label: string
    value: ReactNode
    /** A `Badge` or a short note under the number. */
    extra?: ReactNode
  }
  export interface Props extends ComponentPropsWithRef<'dl'> {
    items: readonly Item[]
  }
}
