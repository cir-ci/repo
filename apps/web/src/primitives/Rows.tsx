import { Box, Typography } from '@mui/material'
import type { ReactNode } from 'react'

/** A titled, bordered list of rows: members, sessions, webhooks. */
export function Section(props: { title: string; count?: number; children: ReactNode }) {
  return (
    <Box component="section">
      <Typography variant="h2" component="h2" sx={{ mb: 1.5 }}>
        {props.title}
        {props.count === undefined ? '' : ` (${props.count})`}
      </Typography>
      <Box
        component="ul"
        sx={{ listStyle: 'none', m: 0, p: 0, border: 1, borderColor: 'divider', borderRadius: 1 }}
      >
        {props.children}
      </Box>
    </Box>
  )
}

export function Row(props: { primary: ReactNode; secondary: ReactNode; action?: ReactNode }) {
  return (
    <Box
      component="li"
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        px: 2,
        py: 1.25,
        '&:not(:last-child)': { borderBottom: 1, borderColor: 'divider' },
      }}
    >
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{props.primary}</Typography>
        <Typography variant="body2" color="text.secondary" component="div">
          {props.secondary}
        </Typography>
      </Box>
      {props.action}
    </Box>
  )
}
