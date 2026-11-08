import type { ReactNode } from 'react'

import { cx } from './cx.ts'
import { CheckCircleIcon, ErrorIcon, InfoIcon, WarningIcon } from './icons.ts'

import styles from './Banner.module.css'

const ICONS = {
  info: InfoIcon,
  success: CheckCircleIcon,
  warning: WarningIcon,
  danger: ErrorIcon,
}

/**
 * Provisional (docs/design-gaps.md §3): a full-width message at the top of a panel or section.
 * `role="alert"` only for `danger` (it interrupts a screen reader); the other tones are polite
 * `role="status"`. The tone is also named by the (hidden) icon's shape, not by colour alone.
 */
export function Banner({ tone = 'info', title, action, className, children }: Banner.Props) {
  const Icon = ICONS[tone]
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      data-tone={tone}
      className={cx(styles.root, className)}
    >
      <Icon className={styles.icon} />
      <div className={styles.body}>
        {title ? <strong className={styles.title}>{title}</strong> : null}
        {children}
      </div>
      {action ? <div className={styles.action}>{action}</div> : null}
    </div>
  )
}

export namespace Banner {
  export interface Props {
    /** `info` (processing), `success` (approved), `warning` (review) or `danger` (rejected). */
    tone?: 'info' | 'success' | 'warning' | 'danger'
    /** A bold lead-in before the message. */
    title?: ReactNode
    /** An optional button or link on the right. */
    action?: ReactNode
    className?: string
    children?: ReactNode
  }
}
