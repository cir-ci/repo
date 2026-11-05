import { Box, Typography } from '@mui/material'
import type { ReactNode } from 'react'

import { monoFont } from '../theme.ts'

/**
 * Primer Blankslate (https://primer.style/product/ui-patterns/empty-states): what this space is
 * for and what to do next. One icon, one heading, an optional short description, at most one
 * primary action and one secondary link. `code` shows setup commands, as Primer recommends for
 * empty states whose next step is running something.
 */
export function Blankslate(props: Blankslate.Props) {
  return (
    <Box
      sx={{
        textAlign: 'center',
        px: 3,
        py: 6,
        maxWidth: 640,
        mx: 'auto',
        ...(props.border
          ? { border: 1, borderColor: 'divider', borderRadius: 1, maxWidth: 'none' }
          : {}),
      }}
    >
      <Box sx={{ color: 'text.secondary', '& svg': { fontSize: 32 } }} aria-hidden>
        {props.icon}
      </Box>
      <Typography variant="h2" component="h2" sx={{ mt: 2, fontSize: '1.25rem' }}>
        {props.heading}
      </Typography>
      {props.description ? (
        <Typography color="text.secondary" sx={{ mt: 1 }}>
          {props.description}
        </Typography>
      ) : null}
      {props.code ? (
        <Box
          component="pre"
          sx={{
            mt: 2,
            mb: 0,
            p: 2,
            textAlign: 'left',
            fontFamily: monoFont,
            fontSize: '0.75rem',
            bgcolor: 'action.hover',
            borderRadius: 1,
            overflowX: 'auto',
          }}
        >
          {props.code}
        </Box>
      ) : null}
      {props.primaryAction ? <Box sx={{ mt: 3 }}>{props.primaryAction}</Box> : null}
      {props.secondaryAction ? <Box sx={{ mt: 2 }}>{props.secondaryAction}</Box> : null}
    </Box>
  )
}

export namespace Blankslate {
  export interface Props {
    icon: ReactNode
    heading: string
    description?: ReactNode
    code?: string
    primaryAction?: ReactNode
    secondaryAction?: ReactNode
    border?: boolean
  }
}
