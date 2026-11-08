import { Tooltip as BaseTooltip } from '@base-ui/react/tooltip'
import type { ReactElement, ReactNode } from 'react'

import styles from './Tooltip.module.css'

/**
 * Provisional (docs/design-gaps.md §4): a small label that opens on hover or keyboard focus of
 * its child after 500ms (focus: at once) and closes on Escape or when the pointer leaves. Only
 * for icon buttons and truncated text: it is never the only place information lives (touch and
 * screen readers don't get it; an `IconButton` has its own accessible name).
 */
export function Tooltip({ content, children, delay = 500, side = 'top', ...rest }: Tooltip.Props) {
  return (
    <BaseTooltip.Root {...rest}>
      <BaseTooltip.Trigger delay={delay} render={children} />
      <BaseTooltip.Portal>
        <BaseTooltip.Positioner className={styles.positioner} side={side} sideOffset={6}>
          <BaseTooltip.Popup className={styles.popup}>{content}</BaseTooltip.Popup>
        </BaseTooltip.Positioner>
      </BaseTooltip.Portal>
    </BaseTooltip.Root>
  )
}

export namespace Tooltip {
  export interface Props extends Omit<BaseTooltip.Root.Props, 'children'> {
    content: ReactNode
    /** The one element the tooltip belongs to; it must accept a ref and DOM props. */
    children: ReactElement<Record<string, unknown>>
    /** Hover delay in ms. */
    delay?: number
    side?: 'top' | 'bottom' | 'left' | 'right'
  }
}
