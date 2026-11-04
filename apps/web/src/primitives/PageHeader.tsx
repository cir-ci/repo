import ArrowBack from '@mui/icons-material/ArrowBack'
import { Box, Stack, Typography } from '@mui/material'
import type { ReactNode } from 'react'

/**
 * Primer PageHeader (https://primer.style/product/components/page-header): the page's single h1
 * with its context. Slots, top to bottom:
 *
 * - parent link: an up-link, shown on narrow viewports only (wider ones have the app header's
 *   context region for orientation);
 * - title area: leading visual, title, trailing visual; actions on the right;
 * - description: metadata about the page's subject;
 * - children: anything else that belongs to the header (banners about the whole page).
 */
export function PageHeader(props: {
  title: ReactNode
  parentLink?: ReactNode
  leadingVisual?: ReactNode
  trailingVisual?: ReactNode
  actions?: ReactNode
  description?: ReactNode
  children?: ReactNode
  hasBorder?: boolean
}) {
  return (
    <Box
      component="header"
      sx={props.hasBorder ? { pb: 2, borderBottom: 1, borderColor: 'divider' } : undefined}
    >
      {props.parentLink ? (
        <Box sx={{ display: { xs: 'block', md: 'none' }, mb: 1 }}>{props.parentLink}</Box>
      ) : null}
      <Stack
        direction="row"
        spacing={1.5}
        useFlexGap
        sx={{ alignItems: 'center', flexWrap: 'wrap' }}
      >
        {props.leadingVisual}
        <Typography variant="h1" component="h1" sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>
          {props.title}
        </Typography>
        {props.trailingVisual}
        {props.actions ? (
          <Stack direction="row" spacing={1} sx={{ ml: 'auto' }}>
            {props.actions}
          </Stack>
        ) : null}
      </Stack>
      {props.description ? (
        <Box sx={{ mt: 1, color: 'text.secondary', typography: 'body1' }}>{props.description}</Box>
      ) : null}
      {props.children ? <Box sx={{ mt: 2 }}>{props.children}</Box> : null}
    </Box>
  )
}

/** The narrow-viewport up-link: an arrow and the parent's name. */
export function ParentLinkContent({ children }: { children: ReactNode }) {
  return (
    <Box
      component="span"
      sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, typography: 'body1' }}
    >
      <ArrowBack sx={{ fontSize: 16 }} aria-hidden />
      {children}
    </Box>
  )
}
