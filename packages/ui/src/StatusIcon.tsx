import { cx } from './cx.ts'

import styles from './StatusIcon.module.css'

export type Status =
  | 'approved'
  | 'needs-review'
  | 'processing'
  | 'failed'
  | 'rejected'
  | 'neutral'
  | 'added'
  | 'removed'
  | 'flaky'

export const STATUS_LABEL: Record<Status, string> = {
  approved: 'Approved',
  'needs-review': 'Needs review',
  processing: 'Processing',
  failed: 'Failed',
  rejected: 'Rejected',
  neutral: 'Unchanged',
  added: 'Added',
  removed: 'Removed',
  flaky: 'Flaky',
}

/**
 * The processing ring: eight short arcs around the circle. StatusIcon.module.css swells each one
 * in turn (a little thicker and fully opaque, then back), like a loading circle; still, they are
 * the dashed ring. The radius leaves room for the swell inside the 14px box.
 */
const PROCESSING_ARCS: readonly string[] = Array.from({ length: 8 }, (_, i) => {
  const r = 5.75
  const step = (2 * Math.PI) / 8
  // Each arc is a little over half its slot, the rest is the gap.
  const sweep = step * 0.53
  const start = -Math.PI / 2 + i * step + (step - sweep) / 2
  const point = (a: number) =>
    `${(7 + r * Math.cos(a)).toFixed(3)} ${(7 + r * Math.sin(a)).toFixed(3)}`
  return `M${point(start)}A${r} ${r} 0 0 1 ${point(start + sweep)}`
})

/**
 * A build or snapshot's state as a small glyph: a filled check (approved), half-filled ring
 * (needs review), dashed ring (processing), filled cross in crimson (failed: the build or
 * screenshot broke), filled disc with one diagonal bar in rose (rejected: a person's decision) or
 * plain ring (unchanged), and a ring with a plus (added), minus (removed) or tilde (flaky).
 * The shape differs per state, so it never relies on colour alone.
 */
export function StatusIcon(props: StatusIcon.Props) {
  const { status, size = 14, label = STATUS_LABEL[status], decorative = false } = props
  const ink = styles.ink
  return (
    <svg
      viewBox="0 0 14 14"
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : label}
      aria-hidden={decorative ? true : undefined}
      width={size}
      height={size}
      className={cx(styles.root, props.className)}
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
      {status === 'processing' &&
        PROCESSING_ARCS.map((d) => (
          <path
            key={d}
            d={d}
            className={styles.arc}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          />
        ))}
      {status === 'failed' && (
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
      {status === 'rejected' && (
        <>
          <circle cx="7" cy="7" r="7" fill="currentColor" />
          <path
            className={ink}
            d="M3.9 7h6.2"
            strokeWidth="1.8"
            strokeLinecap="round"
            transform="rotate(-45 7 7)"
          />
        </>
      )}
      {status === 'neutral' && (
        <circle cx="7" cy="7" r="6.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
      )}
      {status === 'added' && (
        <>
          <circle cx="7" cy="7" r="6.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path
            d="M7 4.2v5.6M4.2 7h5.6"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </>
      )}
      {status === 'removed' && (
        <>
          <circle cx="7" cy="7" r="6.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path
            d="M4.2 7h5.6"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </>
      )}
      {status === 'flaky' && (
        <>
          <circle cx="7" cy="7" r="6.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path
            d="M4 7.6c1-1.9 2-1.9 3 0s2 1.9 3 0"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </>
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
