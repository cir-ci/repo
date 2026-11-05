import { Box, type SxProps, type Theme } from '@mui/material'
import type { ReactNode } from 'react'

import { monoFont } from '../theme.ts'

export type Tone = 'success' | 'attention' | 'danger' | 'accent' | 'done' | 'neutral'

const TONE_COLOR: Record<Tone, string> = {
  success: 'success.main',
  attention: 'warning.main',
  danger: 'error.main',
  accent: 'primary.main',
  done: 'secondary.main',
  neutral: 'text.secondary',
}

/**
 * Primer StateLabel: an icon, text and colour together. State is never shown by colour alone,
 * so it reads the same for colour-blind users, in greyscale and to screen readers.
 */
export function StateLabel(props: StateLabel.Props) {
  const small = props.size === 'small'
  return (
    <Box
      component="span"
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.5,
        flexShrink: 0,
        px: small ? 1 : 1.25,
        py: small ? 0.25 : 0.5,
        borderRadius: 999,
        fontSize: small ? '0.75rem' : '0.875rem',
        fontWeight: 500,
        lineHeight: 1.25,
        whiteSpace: 'nowrap',
        color: props.tone === 'neutral' ? 'text.primary' : '#fff',
        bgcolor: props.tone === 'neutral' ? 'action.selected' : TONE_COLOR[props.tone],
        '& svg': { fontSize: small ? 14 : 16 },
      }}
    >
      {props.icon}
      {props.children}
    </Box>
  )
}

export namespace StateLabel {
  export interface Props {
    tone: Tone
    icon: ReactNode
    children: ReactNode
    size?: 'small' | 'medium'
  }
}

/** A small icon + text in a tone's colour, for inline status (counts, list metadata). */
export function ToneText(props: ToneText.Props) {
  return (
    <Box
      component="span"
      sx={[
        {
          display: 'inline-flex',
          alignItems: 'center',
          gap: 0.5,
          color: TONE_COLOR[props.tone],
          whiteSpace: 'nowrap',
          '& svg': { fontSize: 16 },
        },
        ...(Array.isArray(props.sx) ? props.sx : props.sx ? [props.sx] : []),
      ]}
    >
      {props.icon}
      {props.children}
    </Box>
  )
}

export namespace ToneText {
  export interface Props {
    tone: Tone
    icon?: ReactNode
    children: ReactNode
    sx?: SxProps<Theme>
  }
}

/** Primer CounterLabel: a count next to a heading or tab. */
export function CounterLabel({ children, label }: CounterLabel.Props) {
  return (
    <Box
      component="span"
      aria-label={label}
      sx={{
        display: 'inline-block',
        minWidth: 20,
        px: 0.75,
        borderRadius: 999,
        bgcolor: 'action.selected',
        color: 'text.primary',
        fontSize: '0.75rem',
        fontWeight: 500,
        lineHeight: '18px',
        textAlign: 'center',
      }}
    >
      {children}
    </Box>
  )
}

export namespace CounterLabel {
  export interface Props {
    children: number
    label?: string
  }
}

/** Primer BranchName: monospace, truncated with the full name on hover. */
export function BranchName({ children }: BranchName.Props) {
  return (
    <Box
      component="span"
      title={children}
      sx={{
        display: 'inline-block',
        maxWidth: '28ch',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        verticalAlign: 'bottom',
        px: 0.75,
        borderRadius: 1,
        fontFamily: monoFont,
        fontSize: '0.75rem',
        lineHeight: '20px',
        color: 'primary.main',
        bgcolor: 'action.hover',
      }}
    >
      {children}
    </Box>
  )
}

export namespace BranchName {
  export interface Props {
    children: string
  }
}

/** A commit SHA, shortened to 7 characters with the full SHA on hover. */
export function CommitSha({ sha }: CommitSha.Props) {
  return (
    <Box component="code" title={sha} sx={{ fontFamily: monoFont, fontSize: '0.75rem' }}>
      {sha.slice(0, 7)}
    </Box>
  )
}

export namespace CommitSha {
  export interface Props {
    sha: string
  }
}
