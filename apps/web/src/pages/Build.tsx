import ExpandLess from '@mui/icons-material/ExpandLess'
import ExpandMore from '@mui/icons-material/ExpandMore'
import {
  Alert,
  Box,
  Breadcrumbs,
  Chip,
  Collapse,
  List,
  ListItemButton,
  ListItemText,
  ListSubheader,
  Paper,
  Slider,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import { useQuery } from '@tanstack/react-query'
import { useParams } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'

import {
  type BuildDetail,
  buildQuery,
  type DiffItem,
  type DiffStatus,
  fileUrl,
  isActive,
} from '../api.ts'
import {
  CountsLine,
  ErrorAlert,
  Loading,
  RefLine,
  RouterLink,
  StatusChip,
  TimeAgo,
} from '../components.tsx'

const GROUPS: { key: DiffStatus; label: string; open: boolean }[] = [
  { key: 'changed', label: 'Changed', open: true },
  { key: 'failed', label: 'Failed', open: true },
  { key: 'added', label: 'Added', open: true },
  { key: 'removed', label: 'Removed', open: true },
  { key: 'unchanged', label: 'Unchanged', open: false },
]

type Mode = 'side' | 'overlay' | 'diff'

export function BuildPage() {
  const params = useParams({ from: '/$org/$project/builds/$number' })
  const number = Number(params.number)
  const { data, error } = useQuery(buildQuery(params.org, params.project, number))
  if (error) return <ErrorAlert error={error} />
  if (!data) return <Loading />
  return <BuildView data={data} />
}

function BuildView({ data }: { data: BuildDetail }) {
  const { build, baseline, project } = data

  // Review order: what needs attention first, unchanged last.
  const ordered = useMemo(
    () => GROUPS.flatMap((g) => data.diffs.filter((d) => d.status === g.key)),
    [data.diffs],
  )
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined)
  const selected =
    ordered.find((d) => d.id === selectedId) ??
    ordered.find((d) => d.status !== 'unchanged') ??
    ordered[0]
  const [mode, setMode] = useState<Mode>('side')
  const [opacity, setOpacity] = useState(0.7)
  const [open, setOpen] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(GROUPS.map((g) => [g.key, g.open])),
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey || e.altKey) return
      const i = selected ? ordered.indexOf(selected) : -1
      if (e.key === 'j') setSelectedId(ordered[Math.min(ordered.length - 1, i + 1)]?.id)
      else if (e.key === 'k') setSelectedId(ordered[Math.max(0, i - 1)]?.id)
      else if (e.key === '1') setMode('side')
      else if (e.key === '2') setMode('overlay')
      else if (e.key === '3') setMode('diff')
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [ordered, selected])

  return (
    <>
      <Breadcrumbs sx={{ mb: 1 }}>
        <RouterLink to="/" underline="hover" color="inherit">
          Projects
        </RouterLink>
        <RouterLink
          to="/$org/$project"
          params={{ org: project.orgSlug, project: project.slug }}
          underline="hover"
          color="inherit"
        >
          {project.name}
        </RouterLink>
        <Typography color="text.primary">#{build.number}</Typography>
      </Breadcrumbs>

      <Stack spacing={1} sx={{ mb: 2 }}>
        <Typography variant="h1">
          Build #{build.number}
          {build.name !== 'default' ? (
            <Chip label={build.name} variant="outlined" sx={{ ml: 1 }} />
          ) : null}
        </Typography>
        <Stack
          direction="row"
          spacing={2}
          useFlexGap
          sx={{ alignItems: 'center', flexWrap: 'wrap' }}
        >
          <StatusChip build={build} />
          <RefLine build={build} />
          <Typography variant="body2" color="text.secondary">
            <TimeAgo iso={build.createdAt} />
          </Typography>
          <CountsLine counts={build.counts} />
        </Stack>
        <Typography variant="body2" color="text.secondary">
          {baselineText(data)}
        </Typography>
        {build.errorMessage ? <Alert severity="error">{build.errorMessage}</Alert> : null}
        {isActive(build.status) ? (
          <Alert severity="info">Processing… this page updates by itself.</Alert>
        ) : null}
      </Stack>

      {ordered.length === 0 ? null : (
        <Box
          sx={{
            display: 'grid',
            gap: 2,
            alignItems: 'start',
            gridTemplateColumns: { xs: '1fr', md: '300px minmax(0, 1fr)' },
          }}
        >
          <Paper
            component="nav"
            aria-label="Screenshots"
            sx={{
              position: { md: 'sticky' },
              top: { md: 64 },
              maxHeight: { xs: '40vh', md: 'calc(100vh - 88px)' },
              overflowY: 'auto',
            }}
          >
            {GROUPS.map((g) => {
              const items = data.diffs.filter((d) => d.status === g.key)
              if (items.length === 0) return null
              // The selected screenshot's group stays open, so j/k never selects something hidden.
              const isOpen = (open[g.key] ?? false) || selected?.status === g.key
              return (
                <List
                  key={g.key}
                  dense
                  disablePadding
                  subheader={
                    <ListSubheader
                      component="button"
                      onClick={() => setOpen((o) => ({ ...o, [g.key]: !isOpen }))}
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        width: '100%',
                        border: 0,
                        cursor: 'pointer',
                        font: 'inherit',
                      }}
                    >
                      <Box component="span" sx={{ flex: 1, textAlign: 'left' }}>
                        {g.label} · {items.length}
                      </Box>
                      {isOpen ? <ExpandLess fontSize="small" /> : <ExpandMore fontSize="small" />}
                    </ListSubheader>
                  }
                >
                  <Collapse in={isOpen} unmountOnExit>
                    {items.map((d) => (
                      <ListItemButton
                        key={d.id}
                        selected={d.id === selected?.id}
                        onClick={() => setSelectedId(d.id)}
                      >
                        <Thumb diff={d} />
                        <ListItemText
                          primary={d.name}
                          secondary={d.status === 'changed' ? scoreText(d) : null}
                          slotProps={{ primary: { noWrap: true, title: d.name } }}
                          sx={{ ml: 1.5, minWidth: 0 }}
                        />
                      </ListItemButton>
                    ))}
                  </Collapse>
                </List>
              )
            })}
          </Paper>
          {selected ? (
            <Viewer
              diff={selected}
              mode={mode}
              onMode={setMode}
              opacity={opacity}
              onOpacity={setOpacity}
              baselineNumber={baseline?.number}
            />
          ) : null}
        </Box>
      )}
    </>
  )
}

function baselineText({ build, baseline }: BuildDetail): string {
  if (isActive(build.status)) return 'Picking a baseline…'
  if (!baseline)
    return 'No baseline: this is the first build to compare against, so every screenshot is new.'
  const where = `build #${baseline.number} (${baseline.branch ?? 'unknown branch'} @ ${baseline.commitSha.slice(0, 7)})`
  if (build.baselineSource === 'fallback') {
    return `Compared with ${where}, the latest on the default branch. This build's git history wasn't available, so the comparison may include unrelated changes.`
  }
  return `Compared with ${where}.`
}

function scoreText(d: DiffItem): string {
  if (d.sizeChanged) return 'Size changed'
  if (d.score === null) return ''
  const pct = d.score * 100
  return `${pct < 0.01 ? '<0.01' : pct.toFixed(pct < 1 ? 2 : 1)}% of pixels`
}

function Thumb({ diff }: { diff: DiffItem }) {
  const src = diff.head?.thumbnail ?? diff.base?.thumbnail
  return (
    <Box
      component={src ? 'img' : 'span'}
      {...(src ? { src: fileUrl(src), alt: '', loading: 'lazy' as const } : {})}
      sx={{
        width: 48,
        height: 36,
        flexShrink: 0,
        objectFit: 'cover',
        objectPosition: 'top',
        borderRadius: 0.5,
        border: 1,
        borderColor: 'divider',
        bgcolor: 'action.hover',
      }}
    />
  )
}

/** Checkerboard behind screenshots, so transparency and size-change padding are visible. */
const checker = {
  border: 1,
  borderColor: 'divider',
  borderRadius: 1,
  backgroundImage: 'repeating-conic-gradient(rgba(127,127,127,0.18) 0% 25%, transparent 0% 50%)',
  backgroundSize: '16px 16px',
} as const

function Viewer(props: {
  diff: DiffItem
  mode: Mode
  onMode: (m: Mode) => void
  opacity: number
  onOpacity: (n: number) => void
  baselineNumber: number | undefined
}) {
  const { diff } = props
  const comparable = diff.status === 'changed' && diff.head !== null && diff.base !== null
  const mode: Mode = comparable ? props.mode : 'side'

  return (
    <Paper sx={{ p: 2, minWidth: 0 }}>
      <Stack
        direction="row"
        spacing={2}
        useFlexGap
        sx={{ alignItems: 'center', flexWrap: 'wrap', mb: 2 }}
      >
        <Typography variant="h2" noWrap title={diff.name} sx={{ mr: 'auto', minWidth: 0 }}>
          {diff.name}
        </Typography>
        {comparable ? (
          <ToggleButtonGroup
            size="small"
            exclusive
            value={mode}
            onChange={(_, m: Mode | null) => m && props.onMode(m)}
            aria-label="View mode"
          >
            <ToggleButton value="side" title="Side by side (1)">
              Side by side
            </ToggleButton>
            <ToggleButton value="overlay" title="Overlay (2)">
              Overlay
            </ToggleButton>
            <ToggleButton value="diff" title="Diff (3)">
              Diff
            </ToggleButton>
          </ToggleButtonGroup>
        ) : null}
        {comparable && mode === 'overlay' ? (
          <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', width: 200 }}>
            <Typography variant="body2" color="text.secondary" noWrap>
              Diff layer
            </Typography>
            <Slider
              size="small"
              min={0}
              max={1}
              step={0.05}
              value={props.opacity}
              onChange={(_, v) => props.onOpacity(Array.isArray(v) ? (v[0] ?? 0) : v)}
              aria-label="Diff layer opacity"
            />
          </Stack>
        ) : null}
      </Stack>

      {diff.status === 'failed' ? (
        <Alert severity="error" sx={{ mb: 2 }}>
          {diff.errorMessage ?? 'This screenshot could not be processed.'}
        </Alert>
      ) : null}
      {diff.sizeChanged && diff.base && diff.head ? (
        <Alert severity="warning" sx={{ mb: 2 }}>
          Size changed: {diff.base.width}×{diff.base.height} → {diff.head.width}×{diff.head.height}
        </Alert>
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
            <Pane
              label={props.baselineNumber ? `Baseline (#${props.baselineNumber})` : 'Baseline'}
              sha={diff.base.sha256}
            />
          ) : null}
          {diff.head ? (
            <Pane label={diff.status === 'added' ? 'New' : 'This build'} sha={diff.head.sha256} />
          ) : null}
          {!diff.head && diff.base ? (
            <Typography color="text.secondary">Removed in this build.</Typography>
          ) : null}
        </Box>
      ) : null}

      {mode === 'overlay' && diff.head && diff.diff ? (
        <Box component="figure" sx={{ m: 0 }}>
          <Typography component="figcaption" variant="caption" color="text.secondary">
            This build, with changes highlighted
          </Typography>
          <Box sx={{ position: 'relative', display: 'inline-block', maxWidth: '100%' }}>
            <Box
              component="img"
              src={fileUrl(diff.head.sha256)}
              alt={`${diff.name} in this build`}
              sx={{ display: 'block', maxWidth: '100%', ...checker }}
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
                opacity: props.opacity,
              }}
            />
          </Box>
        </Box>
      ) : null}

      {mode === 'diff' && diff.diff ? (
        <Pane label="Changed pixels in red" sha={diff.diff.sha256} />
      ) : null}
    </Paper>
  )
}

function Pane({ label, sha }: { label: string; sha: string }) {
  return (
    <Box component="figure" sx={{ m: 0, minWidth: 0 }}>
      <Typography component="figcaption" variant="caption" color="text.secondary">
        {label}
      </Typography>
      <a href={fileUrl(sha)} target="_blank" rel="noreferrer" title="Open full size">
        <Box
          component="img"
          src={fileUrl(sha)}
          alt={label}
          sx={{ display: 'block', maxWidth: '100%', height: 'auto', ...checker }}
        />
      </a>
    </Box>
  )
}
