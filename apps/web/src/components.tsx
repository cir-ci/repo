import {
  Alert,
  Box,
  Chip,
  type ChipProps,
  CircularProgress,
  Link as MuiLink,
  Stack,
  Typography,
} from '@mui/material'
import { createLink } from '@tanstack/react-router'
import { useEffect, useState } from 'react'

import type { BuildListItem, Counts } from './api.ts'

/** MUI's Link driven by TanStack Router: typed `to`/`params`, client-side navigation. */
export const RouterLink = createLink(MuiLink)

type Status = Pick<BuildListItem, 'status' | 'conclusion' | 'reviewStatus'>

export function buildState(b: Status): { label: string; color: ChipProps['color'] } {
  if (b.status === 'uploading' || b.status === 'pending')
    return { label: 'Uploading', color: 'default' }
  if (b.status === 'processing') return { label: 'Processing', color: 'default' }
  if (b.status === 'error') return { label: 'Error', color: 'error' }
  if (b.status === 'expired') return { label: 'Expired', color: 'default' }
  if (b.reviewStatus === 'rejected') return { label: 'Rejected', color: 'error' }
  if (b.conclusion === 'no_changes') return { label: 'No changes', color: 'success' }
  if (b.reviewStatus === 'approved') return { label: 'Approved', color: 'info' }
  return { label: 'Changes to review', color: 'warning' }
}

export function StatusChip({ build }: { build: Status }) {
  const { label, color } = buildState(build)
  return <Chip label={label} color={color} variant={color === 'default' ? 'outlined' : 'filled'} />
}

const COUNT_STYLES: [keyof Counts, string, string][] = [
  ['changed', 'changed', 'warning.main'],
  ['added', 'added', 'info.main'],
  ['removed', 'removed', 'info.main'],
  ['failed', 'failed', 'error.main'],
  ['unchanged', 'unchanged', 'text.secondary'],
]

export function CountsLine({ counts }: { counts: Counts }) {
  const shown = COUNT_STYLES.filter(([key]) => counts[key] > 0)
  if (shown.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        No screenshots yet
      </Typography>
    )
  }
  return (
    <Stack direction="row" spacing={1.5} useFlexGap sx={{ flexWrap: 'wrap' }}>
      {shown.map(([key, label, color]) => (
        <Typography key={key} variant="body2" sx={{ color }}>
          {counts[key]} {label}
        </Typography>
      ))}
    </Stack>
  )
}

export function RefLine({
  build,
}: {
  build: Pick<BuildListItem, 'branch' | 'prNumber' | 'commitSha'>
}) {
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', minWidth: 0 }}>
      {build.prNumber ? <Chip label={`PR #${build.prNumber}`} variant="outlined" /> : null}
      {build.branch ? (
        <Typography variant="body2" noWrap sx={{ maxWidth: '22ch' }} title={build.branch}>
          {build.branch}
        </Typography>
      ) : null}
      <Typography variant="body2" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
        {build.commitSha.slice(0, 7)}
      </Typography>
    </Stack>
  )
}

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
]
const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })

/** The current time, refreshed every minute so relative times on an open page stay right. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(timer)
  }, [])
  return now
}

export function TimeAgo({ iso }: { iso: string }) {
  const now = useNow()
  const seconds = (new Date(iso).getTime() - now) / 1000
  const unit = UNITS.find(([, s]) => Math.abs(seconds) >= s)
  const text = unit ? rtf.format(Math.round(seconds / unit[1]), unit[0]) : 'just now'
  return (
    <time dateTime={iso} title={new Date(iso).toLocaleString()}>
      {text}
    </time>
  )
}

export function Loading() {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', mt: 8 }}>
      <CircularProgress aria-label="Loading" />
    </Box>
  )
}

export function ErrorAlert({ error }: { error: Error }) {
  return (
    <Alert severity="error" sx={{ my: 2 }}>
      Couldn’t load this page. {error.message}
    </Alert>
  )
}

export function Code({ children }: { children: string }) {
  return (
    <Box
      component="pre"
      sx={{
        bgcolor: 'action.hover',
        border: 1,
        borderColor: 'divider',
        borderRadius: 1,
        px: 2,
        py: 1.5,
        overflowX: 'auto',
        fontSize: '0.85rem',
      }}
    >
      {children}
    </Box>
  )
}
