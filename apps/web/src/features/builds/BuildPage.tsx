import type { Build, DiffStatus } from '@circi/api'
import CollectionsOutlined from '@mui/icons-material/CollectionsOutlined'
import {
  Alert,
  Box,
  CircularProgress,
  Paper,
  Skeleton,
  Slider,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useParams, useSearch } from '@tanstack/react-router'
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'

import {
  BuildMeta,
  BuildStateLabel,
  CountsSummary,
  DIFF_STATUS,
  ErrorState,
  RouterLink,
  useDocumentTitle,
} from '../../components.tsx'
import { Blankslate } from '../../primitives/Blankslate.tsx'
import { Delayed, useAnnounce } from '../../primitives/feedback.tsx'
import { CommitSha, StateLabel, ToneText } from '../../primitives/labels.tsx'
import { NavListGroup, NavListItem, navListItemSx } from '../../primitives/NavList.tsx'
import { PageHeader, ParentLinkContent } from '../../primitives/PageHeader.tsx'
import { PageLayout } from '../../primitives/PageLayout.tsx'
import type { ViewMode } from '../../router.tsx'
import { buildQuery, fileUrl, isActive } from './api.ts'
import { ReviewActions, ReviewNote } from './ReviewActions.tsx'

const ROUTE = '/$org/$project/builds/$number'

/** Review order: what needs a decision first, unchanged last (and collapsed). */
const GROUPS: { key: DiffStatus; title: string; open: boolean }[] = [
  { key: 'changed', title: 'Changed', open: true },
  { key: 'failed', title: 'Failed', open: true },
  { key: 'added', title: 'Added', open: true },
  { key: 'removed', title: 'Removed', open: true },
  { key: 'unchanged', title: 'Unchanged', open: false },
]

export function BuildPage() {
  const params = useParams({ from: ROUTE })
  const number = Number(params.number)
  const { data, error, refetch } = useQuery(buildQuery(params.org, params.project, number))
  useDocumentTitle(`Build #${number}`, params.project)
  useProcessingAnnouncement(data)

  const parentLink = (
    <RouterLink to="/$org/$project" params={{ org: params.org, project: params.project }}>
      <ParentLinkContent>{params.project}</ParentLinkContent>
    </RouterLink>
  )

  if (error) {
    return (
      <PageLayout header={<PageHeader title={`Build #${number}`} parentLink={parentLink} />}>
        <ErrorState
          error={error}
          onRetry={() => void refetch()}
          notFound="This build doesn’t exist"
        />
      </PageLayout>
    )
  }
  if (!data) {
    // The title is known from the URL, so only the rest waits; placeholders keep the layout still.
    return (
      <PageLayout
        header={
          <PageHeader
            title={`Build #${number}`}
            parentLink={parentLink}
            description={
              <Delayed>
                <Skeleton width={320} />
              </Delayed>
            }
          />
        }
        pane={
          <Delayed>
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} height={44} />
            ))}
          </Delayed>
        }
      >
        <Delayed>
          <Skeleton variant="rounded" height={420} />
        </Delayed>
      </PageLayout>
    )
  }
  return <BuildReview data={data} parentLink={parentLink} />
}

/** Tells screen reader users once when a build they're watching finishes processing. */
function useProcessingAnnouncement(data: Build.Detail | undefined) {
  const announce = useAnnounce()
  const wasActive = useRef<boolean | undefined>(undefined)
  useEffect(() => {
    if (!data) return
    const active = isActive(data.build.status)
    if (wasActive.current && !active) {
      const c = data.build.counts
      announce(
        `Build #${data.build.number} processed: ${c.changed} changed, ${c.added} added, ${c.removed} removed.`,
      )
    }
    wasActive.current = active
  }, [data, announce])
}

function BuildReview({ data, parentLink }: { data: Build.Detail; parentLink: ReactNode }) {
  const { build, baseline } = data
  const params = useParams({ from: ROUTE })
  const search = useSearch({ from: ROUTE })
  const navigate = useNavigate({ from: ROUTE })
  const mode: ViewMode = search.mode ?? 'side'

  const ordered = useMemo(
    () => GROUPS.flatMap((g) => data.diffs.filter((d) => d.status === g.key)),
    [data.diffs],
  )
  const fromUrl = search.shot ? ordered.find((d) => d.name === search.shot) : undefined
  // Wide viewports open the first screenshot that needs attention; narrow ones show the list first.
  const selected = fromUrl ?? ordered.find((d) => d.status !== 'unchanged') ?? ordered[0]
  const [open, setOpen] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(GROUPS.map((g) => [g.key, g.open])),
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey || e.altKey) return
      const i = selected ? ordered.indexOf(selected) : -1
      const change: Record<string, { shot?: string; mode?: ViewMode } | undefined> = {
        j: { shot: ordered[Math.min(ordered.length - 1, i + 1)]?.name },
        k: { shot: ordered[Math.max(0, i - 1)]?.name },
        '1': { mode: 'side' },
        '2': { mode: 'overlay' },
        '3': { mode: 'diff' },
      }
      const next = change[e.key]
      if (!next) return
      e.preventDefault()
      void navigate({ search: (prev) => ({ ...prev, ...next }), replace: true })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [ordered, selected, navigate])

  const header = (
    <PageHeader
      title={
        <>
          Build #{build.number}
          {build.name !== 'default' ? (
            <Box component="span" sx={{ fontWeight: 400, color: 'text.secondary' }}>
              {' '}
              · {build.name}
            </Box>
          ) : null}
        </>
      }
      parentLink={parentLink}
      trailingVisual={<BuildStateLabel build={build} />}
      actions={
        build.status === 'complete' && build.conclusion === 'changes_detected' ? (
          <ReviewActions data={data} />
        ) : undefined
      }
      description={
        <Stack spacing={1}>
          <BuildMeta build={build} />
          {isActive(build.status) ? null : <CountsSummary counts={build.counts} />}
        </Stack>
      }
      hasBorder
    >
      <Stack spacing={1}>
        <ReviewNote data={data} />
        <BaselineNote data={data} />
        {build.errorMessage ? <Alert severity="error">{build.errorMessage}</Alert> : null}
        {isActive(build.status) ? (
          <Alert severity="info" icon={<CircularProgress size={16} aria-hidden />}>
            Processing screenshots. This page updates when it’s done.
          </Alert>
        ) : null}
      </Stack>
    </PageHeader>
  )

  if (ordered.length === 0) {
    return (
      <PageLayout header={header}>
        {isActive(build.status) ? null : (
          <Blankslate
            icon={<CollectionsOutlined />}
            heading="No screenshots in this build"
            description="The upload contained no PNG files."
          />
        )}
      </PageLayout>
    )
  }

  return (
    <PageLayout
      header={header}
      paneLabel="Screenshots"
      narrowShows={fromUrl ? 'content' : 'pane'}
      pane={
        <Box component="ul" sx={{ m: 0, p: 0 }}>
          {GROUPS.map((g) => {
            const items = data.diffs.filter((d) => d.status === g.key)
            if (items.length === 0) return null
            return (
              <NavListGroup
                key={g.key}
                title={g.title}
                count={items.length}
                // The selected screenshot's group stays open, so j/k never selects something hidden.
                open={(open[g.key] ?? false) || selected?.status === g.key}
                onToggle={() => setOpen((o) => ({ ...o, [g.key]: !(o[g.key] ?? false) }))}
              >
                {items.map((d) => (
                  <NavListItem key={d.id}>
                    <RouterLink
                      to={ROUTE}
                      params={params}
                      search={(prev) => ({ ...prev, shot: d.name })}
                      // Current only when chosen in the URL. Wide viewports also open a default
                      // screenshot, which gets the same marker there; narrow ones show the list.
                      aria-current={d.id === fromUrl?.id ? 'page' : undefined}
                      data-default={!fromUrl && d.id === selected?.id ? '' : undefined}
                      sx={navListItemSx}
                    >
                      <Thumb diff={d} />
                      <Box sx={{ minWidth: 0, flex: 1 }}>
                        <Typography noWrap title={d.name} sx={{ fontWeight: 'inherit' }}>
                          {d.name}
                        </Typography>
                        {d.status === 'changed' ? (
                          <Typography variant="body2" color="text.secondary">
                            {changeSummary(d)}
                          </Typography>
                        ) : null}
                      </Box>
                    </RouterLink>
                  </NavListItem>
                ))}
              </NavListGroup>
            )
          })}
        </Box>
      }
    >
      {selected ? (
        <Viewer
          diff={selected}
          mode={mode}
          baselineNumber={baseline?.number}
          backLink={
            <RouterLink
              to={ROUTE}
              params={params}
              search={(prev) => ({ ...prev, shot: undefined })}
            >
              <ParentLinkContent>All screenshots</ParentLinkContent>
            </RouterLink>
          }
          onMode={(m) => void navigate({ search: (prev) => ({ ...prev, mode: m }), replace: true })}
        />
      ) : null}
    </PageLayout>
  )
}

/** Where the comparison comes from: plain metadata normally, a warning when it's a fallback. */
function BaselineNote({ data }: { data: Build.Detail }) {
  const { build, baseline } = data
  if (isActive(build.status)) return null
  if (!baseline) {
    return (
      <Alert severity="info">
        First build to compare against: every screenshot is new. Later builds are compared with this
        one once it’s approved.
      </Alert>
    )
  }
  const where = (
    <>
      build #{baseline.number} on {baseline.branch ?? 'an unknown branch'} (
      <CommitSha sha={baseline.commitSha} />)
    </>
  )
  if (build.baselineSource === 'fallback') {
    return (
      <Alert severity="warning">
        Compared with {where}, the latest on the default branch, because this build’s git history
        wasn’t available. Changes merged since this branch was created may show up here. Fetch more
        history in CI (for example <code>fetch-depth: 0</code>) for an exact comparison.
      </Alert>
    )
  }
  return (
    <Typography color="text.secondary">
      Compared with {where}, where this branch started.
    </Typography>
  )
}

function changeSummary(d: Build.DiffItem): string {
  if (d.sizeChanged) return 'Size changed'
  if (d.score === null) return ''
  const pct = d.score * 100
  return `${pct < 0.01 ? '<0.01' : pct.toFixed(pct < 1 ? 2 : 1)}% of pixels`
}

function Thumb({ diff }: { diff: Build.DiffItem }) {
  const src = diff.head?.thumbnail ?? diff.base?.thumbnail
  const sx = {
    width: 48,
    height: 32,
    flexShrink: 0,
    objectFit: 'cover',
    objectPosition: 'top',
    borderRadius: 1,
    border: 1,
    borderColor: 'divider',
    bgcolor: 'action.hover',
  } as const
  return src ? (
    <Box component="img" src={fileUrl(src)} alt="" loading="lazy" sx={sx} />
  ) : (
    <Box component="span" sx={sx} />
  )
}

/** Checkerboard behind screenshots, so transparency and size-change padding are visible. */
const checker = {
  display: 'block',
  maxWidth: '100%',
  height: 'auto',
  backgroundImage: 'repeating-conic-gradient(rgba(127,127,127,0.16) 0% 25%, transparent 0% 50%)',
  backgroundSize: '16px 16px',
} as const

/**
 * The screenshot viewer, shaped like GitHub's file box: a header bar with the name, status and
 * view switch (Primer SegmentedControl: switching views is not navigation), then the images.
 */
function Viewer(props: {
  diff: Build.DiffItem
  mode: ViewMode
  baselineNumber: number | undefined
  backLink: ReactNode
  onMode: (m: ViewMode) => void
}) {
  const { diff } = props
  const [opacity, setOpacity] = useState(0.7)
  const comparable =
    diff.status === 'changed' && diff.head !== null && diff.base !== null && diff.diff !== null
  const mode: ViewMode = comparable ? props.mode : 'side'
  const status = diff.status ? DIFF_STATUS[diff.status] : undefined

  return (
    <>
      <Box sx={{ display: { xs: 'block', md: 'none' }, mb: 2 }}>{props.backLink}</Box>
      <Paper component="section" aria-labelledby="viewer-title" sx={{ overflow: 'hidden' }}>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 1.5,
            px: 2,
            py: 1,
            bgcolor: 'action.hover',
            borderBottom: 1,
            borderColor: 'divider',
          }}
        >
          {status ? (
            <StateLabel tone={status.tone} icon={status.icon} size="small">
              {status.label}
            </StateLabel>
          ) : null}
          <Typography
            id="viewer-title"
            variant="h2"
            component="h2"
            noWrap
            title={diff.name}
            sx={{ minWidth: 0, flex: 1 }}
          >
            {diff.name}
          </Typography>
          {comparable && mode === 'overlay' ? (
            <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', width: 220 }}>
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ flexShrink: 0 }}
                id="opacity-label"
              >
                Diff layer
              </Typography>
              <Slider
                size="small"
                min={0}
                max={1}
                step={0.05}
                value={opacity}
                onChange={(_, v) => setOpacity(Array.isArray(v) ? (v[0] ?? 0) : v)}
                aria-labelledby="opacity-label"
              />
            </Stack>
          ) : null}
          {comparable ? (
            <ToggleButtonGroup
              size="small"
              exclusive
              value={mode}
              onChange={(_, m: ViewMode | null) => m && props.onMode(m)}
              aria-label="View"
            >
              <ToggleButton value="side" title="Side by side (1)">
                Side by side
              </ToggleButton>
              <ToggleButton value="overlay" title="Overlay (2)">
                Overlay
              </ToggleButton>
              <ToggleButton value="diff" title="Changes only (3)">
                Changes only
              </ToggleButton>
            </ToggleButtonGroup>
          ) : null}
        </Box>

        <Box sx={{ p: 2 }}>
          {diff.status === 'failed' ? (
            <Alert severity="error" sx={{ mb: 2 }}>
              {diff.errorMessage ?? 'This screenshot couldn’t be processed.'}
            </Alert>
          ) : null}
          {diff.sizeChanged && diff.base && diff.head ? (
            <ToneText tone="attention" sx={{ mb: 2, typography: 'body1' }}>
              Size changed from {diff.base.width}×{diff.base.height} to {diff.head.width}×
              {diff.head.height}
            </ToneText>
          ) : null}

          {mode === 'side' ? (
            <Box
              sx={{
                display: 'grid',
                gap: 2,
                gridTemplateColumns: { xs: '1fr', lg: diff.base && diff.head ? '1fr 1fr' : '1fr' },
              }}
            >
              {diff.base ? (
                <Figure
                  label={
                    props.baselineNumber ? `Baseline · build #${props.baselineNumber}` : 'Baseline'
                  }
                  sha={diff.base.sha256}
                />
              ) : null}
              {diff.head ? (
                <Figure
                  label={diff.status === 'added' ? 'New in this build' : 'This build'}
                  sha={diff.head.sha256}
                />
              ) : null}
              {!diff.head && diff.base ? (
                <Typography color="text.secondary">
                  This screenshot isn’t in this build any more.
                </Typography>
              ) : null}
            </Box>
          ) : null}

          {mode === 'overlay' && diff.head && diff.diff ? (
            <Box component="figure" sx={{ m: 0 }}>
              <Typography
                component="figcaption"
                variant="body2"
                color="text.secondary"
                sx={{ mb: 0.5 }}
              >
                This build, with changed pixels highlighted
              </Typography>
              <Box
                sx={{
                  position: 'relative',
                  display: 'inline-block',
                  maxWidth: '100%',
                  border: 1,
                  borderColor: 'divider',
                }}
              >
                <Box
                  component="img"
                  src={fileUrl(diff.head.sha256)}
                  alt={`${diff.name} in this build`}
                  sx={checker}
                />
                <Box
                  component="img"
                  src={fileUrl(diff.diff.sha256)}
                  alt=""
                  sx={{
                    position: 'absolute',
                    inset: 0,
                    width: '100%',
                    height: '100%',
                    pointerEvents: 'none',
                    opacity,
                  }}
                />
              </Box>
            </Box>
          ) : null}

          {mode === 'diff' && diff.diff ? (
            <Figure label="Changed pixels in red" sha={diff.diff.sha256} />
          ) : null}
        </Box>
      </Paper>
    </>
  )
}

function Figure({ label, sha }: { label: string; sha: string }) {
  return (
    <Box component="figure" sx={{ m: 0, minWidth: 0 }}>
      <Typography component="figcaption" variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
        {label}
      </Typography>
      <Box
        component="a"
        href={fileUrl(sha)}
        target="_blank"
        rel="noreferrer"
        title="Open full size"
        sx={{ display: 'inline-block', maxWidth: '100%', border: 1, borderColor: 'divider' }}
      >
        <Box component="img" src={fileUrl(sha)} alt={label} sx={checker} />
      </Box>
    </Box>
  )
}
