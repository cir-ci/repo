import { type Build } from '@circi/api'
import {
  Alert,
  Box,
  Paper,
  Slider,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import { useState, type ReactNode } from 'react'

import { DIFF_STATUS } from '../../components.tsx'
import { StateLabel, ToneText } from '../../primitives/labels.tsx'
import { type ViewMode } from '../../router.tsx'
import { fileUrl } from './api.ts'

/**
 * The screenshot viewer, shaped like GitHub's file box: a header bar with the name, status and
 * view switch (Primer SegmentedControl: switching views is not navigation), then the images.
 */
export function Viewer(props: Viewer.Props) {
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

export namespace Viewer {
  export interface Props {
    diff: Build.DiffItem
    mode: ViewMode
    baselineNumber: number | undefined
    backLink: ReactNode
    onMode: (m: ViewMode) => void
  }
}

function Figure({ label, sha }: Figure.Props) {
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

export namespace Figure {
  export interface Props {
    label: string
    sha: string
  }
}

/** Checkerboard behind screenshots, so transparency and size-change padding are visible. */
const checker = {
  display: 'block',
  maxWidth: '100%',
  height: 'auto',
  backgroundImage: 'repeating-conic-gradient(rgba(127,127,127,0.16) 0% 25%, transparent 0% 50%)',
  backgroundSize: '16px 16px',
} as const
