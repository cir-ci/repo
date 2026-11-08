import type { ReactNode } from 'react'

import styles from './Delayed.module.css'

/**
 * Loading feedback per Primer (https://primer.style/product/ui-patterns/loading): under a
 * moment, show nothing, because a flash of placeholders feels slower than none. `Delayed`
 * reserves its content's space at once but only becomes visible after `delayMs` (default 300,
 * docs/design-gaps.md §5). It is hidden from assistive tech: announce loading with `useAnnounce`.
 */
export function Delayed({ children, delayMs = 300 }: Delayed.Props) {
  return (
    <div className={styles['root']} style={{ animationDelay: `${delayMs}ms` }} aria-hidden="true">
      {children}
    </div>
  )
}

export namespace Delayed {
  export interface Props {
    children: ReactNode
    delayMs?: number
  }
}
