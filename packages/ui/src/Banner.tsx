import type { ReactNode } from 'react'

import { cx } from './cx.ts'
import { CheckCircleIcon, ErrorIcon, InfoIcon, WarningIcon } from './icons.ts'
import { StatusIcon } from './StatusIcon.tsx'

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
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      data-tone={tone}
      className={cx(styles.root, className)}
    >
      {tone === 'flaky' ? (
        <span className={styles.icon}>
          <StatusIcon status="flaky" size={16} decorative />
        </span>
      ) : (
        <BannerIcon tone={tone} />
      )}
      <div className={styles.body}>
        {title ? <strong className={styles.title}>{title}</strong> : null}
        {children}
      </div>
      {action ? <div className={styles.action}>{action}</div> : null}
    </div>
  )
}

function BannerIcon({ tone }: { tone: keyof typeof ICONS }) {
  const Icon = ICONS[tone]
  return <Icon className={styles.icon} />
}

export namespace Banner {
  export interface Props {
    /**
     * `info` (processing), `success` (approved), `warning` (review), `danger` (rejected) or
     * `flaky` (the flaky colour and its ringed-tilde glyph, as on flaky screenshots).
     */
    tone?: 'info' | 'success' | 'warning' | 'danger' | 'flaky'
    /** A bold lead-in before the message. */
    title?: ReactNode
    /** An optional button or link on the right. */
    action?: ReactNode
    className?: string
    children?: ReactNode
  }
}
