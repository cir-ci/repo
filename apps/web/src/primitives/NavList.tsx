import ExpandLess from '@mui/icons-material/ExpandLess'
import ExpandMore from '@mui/icons-material/ExpandMore'
import { Box, ButtonBase, Collapse } from '@mui/material'
import { type ReactNode, useId } from 'react'

import { CounterLabel } from './labels.tsx'

/**
 * Primer NavList (https://primer.style/product/ui-patterns/navigation): a vertical list of links
 * for parent-detail navigation. Selecting an item changes the URL; the current one carries
 * `aria-current="page"` and a visible marker, not just a background tint.
 */

export function NavListGroup(props: {
  title: string
  count: number
  open: boolean
  onToggle: () => void
  children: ReactNode
}) {
  const id = useId()
  return (
    <Box component="li" sx={{ listStyle: 'none', '& + &': { mt: 1 } }}>
      <ButtonBase
        onClick={props.onToggle}
        aria-expanded={props.open}
        aria-controls={id}
        sx={{
          width: '100%',
          justifyContent: 'flex-start',
          gap: 1,
          px: 1,
          py: 0.75,
          borderRadius: 1,
          color: 'text.secondary',
          typography: 'body2',
          fontWeight: 600,
          '&:hover': { bgcolor: 'action.hover' },
          '&.Mui-focusVisible': { outline: 2, outlineColor: 'primary.main', outlineStyle: 'solid' },
        }}
      >
        <Box component="span" sx={{ flex: 1, textAlign: 'left' }}>
          {props.title}
        </Box>
        <CounterLabel label={`${props.count} screenshots`}>{props.count}</CounterLabel>
        {props.open ? (
          <ExpandLess sx={{ fontSize: 16 }} aria-hidden />
        ) : (
          <ExpandMore sx={{ fontSize: 16 }} aria-hidden />
        )}
      </ButtonBase>
      <Collapse in={props.open} id={id}>
        <Box component="ul" sx={{ p: 0, m: 0 }}>
          {props.children}
        </Box>
      </Collapse>
    </Box>
  )
}

/** The current item: tinted, bold, and Primer's marker bar on the leading edge. */
const currentItem = {
  bgcolor: 'action.selected',
  fontWeight: 600,
  '&::before': {
    content: '""',
    position: 'absolute',
    left: -8,
    top: 'calc(50% - 12px)',
    width: 4,
    height: 24,
    borderRadius: 1,
    bgcolor: 'primary.main',
  },
} as const

/**
 * Styles for an item's link; pass the router link as `children` so it stays a real link.
 * `aria-current="page"` marks the current item; `data-default` marks an item shown by default,
 * which only counts as current where the content is visible beside the list (768px and up).
 */
export const navListItemSx = {
  position: 'relative',
  display: 'flex',
  alignItems: 'center',
  gap: 1.5,
  px: 1,
  py: 0.75,
  borderRadius: 1,
  color: 'text.primary',
  textDecoration: 'none',
  '&:hover': { bgcolor: 'action.hover', textDecoration: 'none' },
  '&[aria-current="page"]': currentItem,
  '@media (min-width: 768px)': { '&[data-default]': currentItem },
  '&:focus-visible': { outline: 2, outlineStyle: 'solid', outlineColor: 'primary.main' },
} as const

export function NavListItem({ children }: { children: ReactNode }) {
  return (
    <Box component="li" sx={{ listStyle: 'none', pl: 1 }}>
      {children}
    </Box>
  )
}
