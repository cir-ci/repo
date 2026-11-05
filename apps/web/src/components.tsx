import type { Build, DiffStatus } from '@circi/api'
import AddCircleOutlineOutlined from '@mui/icons-material/AddCircleOutlineOutlined'
import CancelOutlined from '@mui/icons-material/CancelOutlined'
import CheckCircleOutlineOutlined from '@mui/icons-material/CheckCircleOutlineOutlined'
import CloudUploadOutlined from '@mui/icons-material/CloudUploadOutlined'
import DifferenceOutlined from '@mui/icons-material/DifferenceOutlined'
import ErrorOutlineOutlined from '@mui/icons-material/ErrorOutlineOutlined'
import HourglassEmpty from '@mui/icons-material/HourglassEmpty'
import RateReviewOutlined from '@mui/icons-material/RateReviewOutlined'
import Refresh from '@mui/icons-material/Refresh'
import RemoveCircleOutlineOutlined from '@mui/icons-material/RemoveCircleOutlineOutlined'
import ReportProblemOutlined from '@mui/icons-material/ReportProblemOutlined'
import TaskAlt from '@mui/icons-material/TaskAlt'
import { Box, Button, Link as MuiLink, Stack } from '@mui/material'
import { createLink } from '@tanstack/react-router'
import { type ReactNode, useEffect, useState } from 'react'

import { HttpError } from './lib/http.ts'
import { Blankslate } from './primitives/Blankslate.tsx'
import { BranchName, CommitSha, StateLabel, type Tone, ToneText } from './primitives/labels.tsx'

/** CirCI-specific building blocks on top of the Primer-style primitives. */

/** MUI's Link driven by TanStack Router: typed `to`/`params`/`search`, client-side navigation. */
export const RouterLink = createLink(MuiLink)

type BuildStatus = Pick<Build.ListItem, 'status' | 'conclusion' | 'reviewStatus'>

export function buildState(b: BuildStatus): { label: string; tone: Tone; icon: ReactNode } {
  if (b.status === 'uploading' || b.status === 'pending') {
    return { label: 'Uploading', tone: 'neutral', icon: <CloudUploadOutlined /> }
  }
  if (b.status === 'processing')
    return { label: 'Processing', tone: 'neutral', icon: <HourglassEmpty /> }
  if (b.status === 'error')
    return { label: 'Failed', tone: 'danger', icon: <ErrorOutlineOutlined /> }
  if (b.status === 'expired') return { label: 'Expired', tone: 'neutral', icon: <HourglassEmpty /> }
  if (b.reviewStatus === 'rejected')
    return { label: 'Rejected', tone: 'danger', icon: <CancelOutlined /> }
  if (b.conclusion === 'no_changes') {
    return { label: 'No changes', tone: 'success', icon: <CheckCircleOutlineOutlined /> }
  }
  if (b.reviewStatus === 'approved') return { label: 'Approved', tone: 'done', icon: <TaskAlt /> }
  return { label: 'Changes to review', tone: 'attention', icon: <RateReviewOutlined /> }
}

export function BuildStateLabel({
  build,
  size,
}: {
  build: BuildStatus
  size?: 'small' | 'medium'
}) {
  const s = buildState(build)
  return (
    <StateLabel tone={s.tone} icon={s.icon} {...(size ? { size } : {})}>
      {s.label}
    </StateLabel>
  )
}

export const DIFF_STATUS: Record<DiffStatus, { label: string; tone: Tone; icon: ReactNode }> = {
  changed: { label: 'Changed', tone: 'attention', icon: <DifferenceOutlined /> },
  failed: { label: 'Failed', tone: 'danger', icon: <ErrorOutlineOutlined /> },
  added: { label: 'Added', tone: 'success', icon: <AddCircleOutlineOutlined /> },
  removed: { label: 'Removed', tone: 'danger', icon: <RemoveCircleOutlineOutlined /> },
  unchanged: { label: 'Unchanged', tone: 'neutral', icon: <CheckCircleOutlineOutlined /> },
}

/** "2 changed · 1 added …" with an icon per kind; zero counts are left out. */
export function CountsSummary({
  counts,
  includeUnchanged = true,
}: {
  counts: Build.Counts
  includeUnchanged?: boolean
}) {
  const order: DiffStatus[] = ['changed', 'failed', 'added', 'removed']
  if (includeUnchanged) order.push('unchanged')
  if (counts.total === 0) {
    return (
      <Box component="span" sx={{ color: 'text.secondary', typography: 'body2' }}>
        No screenshots
      </Box>
    )
  }
  return (
    <Stack direction="row" spacing={1.5} useFlexGap sx={{ flexWrap: 'wrap', typography: 'body2' }}>
      {order
        .filter((k) => counts[k] > 0)
        .map((k) => (
          <ToneText key={k} tone={DIFF_STATUS[k].tone} icon={DIFF_STATUS[k].icon}>
            {counts[k]} {DIFF_STATUS[k].label.toLowerCase()}
          </ToneText>
        ))}
    </Stack>
  )
}

/** Metadata line for a build: PR, branch, commit, time. */
export function BuildMeta({
  build,
}: {
  build: Pick<Build.ListItem, 'branch' | 'prNumber' | 'commitSha' | 'createdAt'>
}) {
  return (
    <Stack
      direction="row"
      spacing={1}
      useFlexGap
      divider={
        <Box component="span" aria-hidden>
          ·
        </Box>
      }
      sx={{ alignItems: 'center', flexWrap: 'wrap', color: 'text.secondary', typography: 'body2' }}
    >
      {build.prNumber ? <span>PR #{build.prNumber}</span> : null}
      {build.branch ? <BranchName>{build.branch}</BranchName> : null}
      <CommitSha sha={build.commitSha} />
      <RelativeTime iso={build.createdAt} />
    </Stack>
  )
}

/** The current time, refreshed every minute so relative times on an open page stay right. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(timer)
  }, [])
  return now
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

/** Primer RelativeTime: "3 minutes ago", with the exact time on hover. */
export function RelativeTime({ iso }: { iso: string }) {
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

/**
 * Error state per Primer: alert icon, what went wrong in plain words, and the way to recover.
 * A 404 gets a "not found" message; anything else offers to retry.
 */
export function ErrorState(props: { error: Error; onRetry?: () => void; notFound?: string }) {
  if (props.error instanceof HttpError && props.error.status === 404 && props.notFound) {
    return (
      <Blankslate
        icon={<ReportProblemOutlined />}
        heading={props.notFound}
        description="It may have expired, or the link may be wrong."
      />
    )
  }
  return (
    <Blankslate
      icon={<ReportProblemOutlined />}
      heading="This page couldn’t be loaded"
      description={props.error.message}
      primaryAction={
        props.onRetry ? (
          <Button variant="outlined" startIcon={<Refresh />} onClick={props.onRetry}>
            Try again
          </Button>
        ) : undefined
      }
    />
  )
}

/** Sets the browser tab title, most specific first: "Build #2 · web-app · CirCI". */
export function useDocumentTitle(...parts: (string | undefined)[]) {
  const title = [...parts.filter(Boolean), 'CirCI'].join(' · ')
  useEffect(() => {
    document.title = title
  }, [title])
}
