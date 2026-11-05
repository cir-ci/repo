import { Box } from '@mui/material'
import type { ReactNode } from 'react'

export type Status = 'approved' | 'needs-review' | 'processing' | 'rejected' | 'neutral'

const COLOR: Record<Status, string> = {
  approved: 'success.main',
  'needs-review': 'warning.main',
  processing: 'info.main',
  rejected: 'error.main',
  neutral: 'text.disabled',
}

const LABEL: Record<Status, string> = {
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
  const { status, size = 14, label = LABEL[status] } = props
  const ink = 'background.default'
  let glyph: ReactNode
  switch (status) {
    case 'approved':
      glyph = (
        <>
          <circle cx="7" cy="7" r="7" fill="currentColor" />
          <path
            d="M4 7.3l2 2 4-4.3"
            fill="none"
            stroke="var(--ink)"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      )
      break
    case 'needs-review':
      glyph = (
        <>
          <circle cx="7" cy="7" r="6.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M7 1.5a5.5 5.5 0 0 1 0 11z" fill="currentColor" />
        </>
      )
      break
    case 'processing':
      glyph = (
        <circle
          cx="7"
          cy="7"
          r="6.25"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeDasharray="2.4 2.2"
        />
      )
      break
    case 'rejected':
      glyph = (
        <>
          <circle cx="7" cy="7" r="7" fill="currentColor" />
          <path
            d="M4.7 4.7l4.6 4.6M9.3 4.7l-4.6 4.6"
            stroke="var(--ink)"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </>
      )
      break
    case 'neutral':
      glyph = <circle cx="7" cy="7" r="6.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
      break
  }
  return (
    <Box
      component="svg"
      viewBox="0 0 14 14"
      role="img"
      aria-label={label}
      sx={{
        width: size,
        height: size,
        flexShrink: 0,
        color: COLOR[status],
        '--ink': (theme) => theme.palette.background.default,
        ...(props.sx ?? {}),
      }}
      data-ink={ink}
    >
      {glyph}
    </Box>
  )
}

export namespace StatusIcon {
  export interface Props {
    status: Status
    /** Pixel size of the square glyph. */
    size?: number
    /** Accessible name; defaults to the status's label. */
    label?: string
    sx?: Record<string, unknown>
  }
}

export { LABEL as STATUS_LABEL }
