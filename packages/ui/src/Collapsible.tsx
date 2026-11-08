import { Collapsible as BaseCollapsible } from '@base-ui/react/collapsible'
import type { ReactNode } from 'react'

import { cx } from './cx.ts'
import { ChevronRightIcon } from './icons.ts'

import styles from './Collapsible.module.css'

/**
 * Provisional: a disclosure on Base UI's `Collapsible`: a trigger button (`aria-expanded`) with a
 * chevron, a title and an optional count, over a panel that slides open. Used for the collapsed
 * "Unchanged (14)" group in the build review list.
 */
export function Collapsible({ title, count, className, children, ...rest }: Collapsible.Props) {
  return (
    <BaseCollapsible.Root {...rest} className={cx(styles.root, className)}>
      <BaseCollapsible.Trigger className={styles.trigger}>
        <ChevronRightIcon size={14} strokeWidth={2} className={styles.chevron} />
        <span className={styles.title}>{title}</span>
        {count === undefined ? null : <span className={styles.count}>{count}</span>}
      </BaseCollapsible.Trigger>
      <BaseCollapsible.Panel className={styles.panel}>{children}</BaseCollapsible.Panel>
    </BaseCollapsible.Root>
  )
}

export namespace Collapsible {
  export interface Props
    // `className` merges via `cx`, `render` would replace our structure, `title` is our heading.
    extends Omit<BaseCollapsible.Root.Props, 'className' | 'render' | 'children' | 'title'> {
    title: ReactNode
    /** A count shown after the title. */
    count?: number
    className?: string
    children?: ReactNode
  }
}
