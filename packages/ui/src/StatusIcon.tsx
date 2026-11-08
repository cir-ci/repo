import { cx } from './cx.ts'

import styles from './StatusIcon.module.css'

export type Status = 'approved' | 'needs-review' | 'processing' | 'rejected' | 'neutral'

export const STATUS_LABEL: Record<Status, string> = {
  approved: 'Approved',
  'needs-review': 'Needs review',
  processing: 'Processing',
  rejected: 'Rejected',
  neutral: 'No changes',
}

/**
 * A build or snapshot's state as a small glyph: a filled check (approved), half-filled ring
 * (needs review), dashed ring (processing), filled cross (rejected) or plain ring (no changes).
 * The shape differs per state, so it never relies on colour alone.
 */
export function StatusIcon(props: StatusIcon.Props) {
  const { status, size = 14, label = STATUS_LABEL[status], decorative = false } = props
  const ink = styles['ink']
  return (
    <svg
      viewBox="0 0 14 14"
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : label}
      aria-hidden={decorative ? true : undefined}
      width={size}
      height={size}
      className={cx(styles['root'], props.className)}
      data-status={status}
    >
      {status === 'approved' && (
        <>
          <circle cx="7" cy="7" r="7" fill="currentColor" />
          <path
            className={ink}
            d="M4 7.3l2 2 4-4.3"
            fill="none"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      )}
      {status === 'needs-review' && (
        <>
          <circle cx="7" cy="7" r="6.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M7 .75a6.25 6.25 0 0 1 0 12.5z" fill="currentColor" />
        </>
      )}
      {status === 'processing' && (
        <circle
          cx="7"
          cy="7"
          r="6.25"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeDasharray="2.4 2.2"
        />
      )}
      {status === 'rejected' && (
        <>
          <circle cx="7" cy="7" r="7" fill="currentColor" />
          <path
            className={ink}
            d="M4.7 4.7l4.6 4.6M9.3 4.7l-4.6 4.6"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </>
      )}
      {status === 'neutral' && (
        <circle cx="7" cy="7" r="6.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
      )}
    </svg>
  )
}

export namespace StatusIcon {
  export interface Props {
    status: Status
    /** Pixel size of the square glyph. */
    size?: number
    /** Accessible name; defaults to the status's label. */
    label?: string
    /** Hide the glyph from assistive tech, when text beside it already says the same. */
    decorative?: boolean
    className?: string
  }
}
