import { type Build, type DiffStatus } from '@circi/api'
import CollectionsOutlined from '@mui/icons-material/CollectionsOutlined'
import { Alert, Box, CircularProgress, Stack, Typography } from '@mui/material'
import { useNavigate, useParams, useSearch } from '@tanstack/react-router'
import { useEffect, useMemo, useState, type ReactNode } from 'react'

import { BuildMeta, BuildStateLabel, CountsSummary, RouterLink } from '../../components.tsx'
import { Blankslate } from '../../primitives/Blankslate.tsx'
import { CommitSha } from '../../primitives/labels.tsx'
import { NavListGroup, NavListItem, navListItemSx } from '../../primitives/NavList.tsx'
import { PageHeader, ParentLinkContent } from '../../primitives/PageHeader.tsx'
import { PageLayout } from '../../primitives/PageLayout.tsx'
import { type ViewMode } from '../../router.tsx'
import { fileUrl, isActive } from './api.ts'
import { Viewer } from './DiffViewer.tsx'
import { ReviewActions, ReviewNote } from './ReviewActions.tsx'
import { ROUTE } from './route.ts'

export function BuildReview({ data, parentLink }: BuildReview.Props) {
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
        '4': { mode: 'swipe' },
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

export namespace BuildReview {
  export interface Props {
    data: Build.Detail
    parentLink: ReactNode
  }
}

/** Where the comparison comes from: plain metadata normally, a warning when it's a fallback. */
function BaselineNote({ data }: BaselineNote.Props) {
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

export namespace BaselineNote {
  export interface Props {
    data: Build.Detail
  }
}

function changeSummary(d: Build.DiffItem): string {
  if (d.sizeChanged) return 'Size changed'
  if (d.score === null) return ''
  const pct = d.score * 100
  return `${pct < 0.01 ? '<0.01' : pct.toFixed(pct < 1 ? 2 : 1)}% of pixels`
}

function Thumb({ diff }: Thumb.Props) {
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

export namespace Thumb {
  export interface Props {
    diff: Build.DiffItem
  }
}

/** Review order: what needs a decision first, unchanged last (and collapsed). */
const GROUPS: { key: DiffStatus; title: string; open: boolean }[] = [
  { key: 'changed', title: 'Changed', open: true },
  { key: 'failed', title: 'Failed', open: true },
  { key: 'added', title: 'Added', open: true },
  { key: 'removed', title: 'Removed', open: true },
  { key: 'unchanged', title: 'Unchanged', open: false },
]
