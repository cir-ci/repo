import { Box } from '@mui/material'
import type { ReactNode } from 'react'

/**
 * Primer page layout (https://primer.style/product/getting-started/foundations/layout):
 *
 * - Full page: header + content, centred, at most 1280px wide.
 * - Split page: a pane flush left with its own scroll area, and the content beside it.
 * - Narrow viewports (< 768px) are always one column. A split page shows either the pane or
 *   the content (`narrowShows`), never the pane stacked above a long content area.
 * - Padding: 16px, 24px from 1280px (xlarge) up.
 */
export function PageLayout(props: PageLayout.Props) {
  const padding = { xs: 2, xl: 3 }
  if (!props.pane) {
    return (
      <Box sx={{ maxWidth: 1280, mx: 'auto', px: padding, py: 3 }}>
        {props.header}
        <Box sx={{ mt: 3 }}>{props.children}</Box>
      </Box>
    )
  }
  const shows = props.narrowShows ?? 'content'
  return (
    <Box sx={{ px: padding, py: 3 }}>
      {props.header}
      <Box
        sx={{
          mt: 3,
          display: 'grid',
          alignItems: 'start',
          gap: 3,
          gridTemplateColumns: {
            xs: '1fr',
            md: '296px minmax(0, 1fr)',
            lg: '320px minmax(0, 1fr)',
          },
        }}
      >
        <Box
          component="nav"
          aria-label={props.paneLabel}
          sx={{
            display: { xs: shows === 'pane' ? 'block' : 'none', md: 'block' },
            position: { md: 'sticky' },
            top: { md: 16 },
            maxHeight: { md: 'calc(100vh - 32px)' },
            overflowY: { md: 'auto' },
          }}
        >
          {props.pane}
        </Box>
        <Box
          sx={{ display: { xs: shows === 'content' ? 'block' : 'none', md: 'block' }, minWidth: 0 }}
        >
          {props.children}
        </Box>
      </Box>
    </Box>
  )
}

export namespace PageLayout {
  export interface Props {
    header: ReactNode
    children: ReactNode
    /** Turns this into a split page. */
    pane?: ReactNode
    paneLabel?: string
    /** Narrow viewports only: which half of a split page to show. */
    narrowShows?: 'pane' | 'content'
  }
}
